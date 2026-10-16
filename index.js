/**
 * dsh-agnes-image — host half.
 *
 * Owns everything privileged: the Agnes API calls, on-disk persistence, the
 * `agnes_generate_image` / `agnes_generate_video` agent tools, and the
 * `/api/agnes-image/*` routes the browser panel talks to. The browser half
 * (client.js) never sees the key.
 *
 * Images are synchronous (POST returns URLs). Videos are asynchronous: create a
 * task on POST /v1/videos, then poll the ROOT-LEVEL /agnesapi endpoint until
 * status is completed and the top-level `url` appears.
 *
 * Registered as a bundle row (id `agnes-image`) via cordis.patch.yml, so the
 * validated Config below arrives as the second argument of `apply`.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, resolve as resolvePath } from 'node:path'
import { homedir } from 'node:os'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
// The `dsh` optimizer backend runs one auxiliary call through the harness' own
// LLM service, exactly like dsh-session-title-llm does.
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
// Double-clicking a card opens the file the way the desktop does: on Windows the
// helper hands the file's URI to explorer.exe, i.e. the same resolution a
// double-click in a folder window uses.
import { canOpenNativePath, openNativeAssociatedPath, revealNativePath } from '@deepseek-ai/dsh-native-command'

export const name = 'agnes-image'

/**
 * `tools` for the agent tool. `connection` is what registers the panel's HTTP
 * routes with the harness trust fence + cookie auth — without it the routes
 * (not the tool) are unavailable, which is why it is declared here rather than
 * fetched defensively: a profile without the web app simply keeps this plugin
 * pending instead of half-loading it.
 */
export const inject = ['tools', 'connection']

const API_URL = 'https://api.agnes-ai.cn/v1/images/generations'
const ROUTE = '/api/agnes-image'
const SIZES = ['1K', '2K', '3K', '4K']
const RATIOS = ['1:1', '3:4', '4:3', '16:9', '9:16', '2:3', '3:2', '21:9']
const MAX_COUNT = 4
const IMAGE_DIR = 'agnes-images'
const EXT_BY_TYPE = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/webp': '.webp',
  'image/gif': '.gif',
}

// --------------------------------------------------------------- video API --
// Create lives under /v1, but the polling endpoint is at the SITE ROOT
// (/agnesapi, no /v1) — getting that wrong is a 404, not a 400.
const VIDEO_CREATE_URL = 'https://api.agnes-ai.cn/v1/videos'
const VIDEO_QUERY_URL = 'https://api.agnes-ai.cn/agnesapi'
const VIDEO_DIR = 'agnes-videos'
const VIDEO_MODES = ['text', 'keyframe', 'reference']
const VIDEO_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']
const FLASH_SIZES = ['720P']
const FULL_SIZES = ['720P', '1080P', '1K', '2K']
const FLASH_MAX_IMAGES = 5
const FLASH_MAX_AUDIOS = 3
const MAX_MEDIA_BYTES = 15 * 1024 * 1024
/** Poster frames are browser-captured PNGs; a 160x90..1280x720 still stays far below this. */
const MAX_COVER_BYTES = 6 * 1024 * 1024
const MEDIA_MIME = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.ogg': 'audio/ogg',
}

// --------------------------------------------------------- prompt optimizer --
// Both prompt boxes share one rewriter. `agnes` posts the text to the free
// Agnes text model (agnes-3.0-flash) over Chat Completions; `dsh` runs the same
// request through whatever model this profile is configured to use, so it costs
// nothing extra and needs no extra key.
const CHAT_URL = 'https://api.agnes-ai.cn/v1/chat/completions'
const OPTIMIZE_BACKENDS = ['agnes', 'dsh']
const OPTIMIZE_MAX_CHARS = 1200
const OPTIMIZE_MAX_INPUT = 4000

const OPTIMIZE_SYSTEM = {
  image: [
    'You rewrite a rough idea into one ready-to-use prompt for a text-to-image model.',
    'Keep the subject and the intent exactly as given; never swap the subject, and never add people, on-screen text, watermarks, logos or signatures that were not asked for.',
    'Add concrete visual detail: composition and viewpoint, lighting and time of day, colour palette, materials and textures, atmosphere, and one fitting style.',
    'Reply with the finished prompt alone: plain text, no quotes, no label, no explanation, no markdown, no line breaks.',
    'Length: one to three sentences, at most 90 words (or about 120 CJK characters).',
    'Write in the same language as the input.',
  ].join('\n'),
  video: [
    'You rewrite a rough idea into one ready-to-use prompt for a text-to-video model rendering a single continuous shot.',
    'Keep the subject and the intent exactly as given; never swap the subject, and never add on-screen text, watermarks or logos.',
    'Make the action explicit and physically plausible: what moves, in what order, over the clip.',
    'Name the camera: movement (slow push-in, pull-out, orbit, follow, pan, handheld, locked-off) and framing.',
    'State the pacing for the requested clip length, plus lighting, colour, atmosphere and visual style.',
    'One shot only: no cuts, no montage and no scene list.',
    'Reply with the finished prompt alone: plain text, no quotes, no label, no explanation, no markdown, no line breaks.',
    'Length: two to four sentences, at most 110 words (or about 150 CJK characters).',
    'Write in the same language as the input.',
  ].join('\n'),
}

/**
 * Every field is also persisted by the panel through this plugin's own
 * settings file, which is why the schema stays flat and string-first.
 *
 * There is deliberately no `apiKey`/`apiKeyEnv` field: the plugin ships without
 * any credential, and the only source is the panel Settings tab, which writes
 * the key into `%DSH_HOME%/agnes-image/settings.json`.
 */
export const Config = z.object({
  model: z.string().default('agnes-image-2.5-flash'),
  size: z.string().default('2K'),
  ratio: z.string().default('1:1'),
  timeoutMs: z.number().default(300000),
  outputDir: z.string().default(''),
  historyLimit: z.number().default(200),
  // Video: `flash` is currently free and capped at 720P; `agnes-video-2.5`
  // adds 1080P/1K/2K at ¥0.15–¥0.35 per output second.
  videoModel: z.string().default('agnes-video-2.5-flash'),
  videoSize: z.string().default('720P'),
  videoAspect: z.string().default('16:9'),
  videoSeconds: z.string().default('5'),
  /** Whole-task budget: create + retries + queue wait + render + download. */
  videoTimeoutMs: z.number().default(900000),
  videoPollMs: z.number().default(3000),
  videoQueueRetries: z.number().default(6),
  // Prompt optimizer: which backend, and which model the `agnes` backend asks.
  optimizeBackend: z.string().default('agnes'),
  optimizeModel: z.string().default('agnes-3.0-flash'),
  optimizeMaxTokens: z.number().default(900),
  optimizeTimeoutMs: z.number().default(120000),
})

const pad = (n) => String(n).padStart(2, '0')
const dateFolder = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
const clock = (d) => `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`

function slugify(text) {
  const cleaned = String(text ?? '')
    // eslint-disable-next-line no-control-regex -- stripping control characters is the point
    .replace(/[\\/:*?"<>|\u0000-\u001f\s]+/g, '-')
    .replace(/^[-.]+/, '')
    .replace(/[-.]+$/, '')
  // Keeps CJK prompts readable; ASCII-only prompts fall back to 'image'.
  return cleaned.slice(0, 32) || 'image'
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '?'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** `agnes-video-2.5-flash` is capped at 720P, 5 reference images, 3 audios. */
const isFlashModel = (model) => String(model ?? '').toLowerCase().endsWith('-flash')

export function apply(ctx, config) {
  const warn = (...args) => console.warn('[agnes-image]', ...args)

  const home = () =>
    ctx.get('profileContext')?.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh')
  const dataDir = () => join(home(), 'agnes-image')
  const settingsFile = () => join(dataDir(), 'settings.json')
  const historyFile = () => join(dataDir(), 'history.json')

  async function readJson(file, fallback) {
    try {
      const parsed = JSON.parse(await readFile(file, 'utf8'))
      return parsed ?? fallback
    } catch {
      return fallback
    }
  }

  async function writeJson(file, value) {
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp-${process.pid}-${Date.now()}`
    await writeFile(tmp, JSON.stringify(value, null, 2), 'utf8')
    await rename(tmp, file)
  }

  const readSettings = async () => {
    const raw = await readJson(settingsFile(), {})
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}
  }

  /** Panel value wins, then Config; an empty string means "not set". */
  const pick = (settings, key) => {
    const value = settings[key]
    return value === undefined || value === null || value === '' ? config[key] : value
  }

  function effective(settings) {
    return {
      model: String(pick(settings, 'model') || 'agnes-image-2.5-flash'),
      size: String(pick(settings, 'size') || '2K'),
      ratio: String(pick(settings, 'ratio') || '1:1'),
      timeoutMs: Number(pick(settings, 'timeoutMs')) || 300000,
      outputDir: String(pick(settings, 'outputDir') ?? ''),
      historyLimit: Number(pick(settings, 'historyLimit')) || 200,
      videoModel: String(pick(settings, 'videoModel') || 'agnes-video-2.5-flash'),
      videoSize: String(pick(settings, 'videoSize') || '720P'),
      videoAspect: String(pick(settings, 'videoAspect') || '16:9'),
      videoSeconds: String(pick(settings, 'videoSeconds') || '5'),
      videoTimeoutMs: Number(pick(settings, 'videoTimeoutMs')) || 900000,
      videoPollMs: Math.max(1000, Number(pick(settings, 'videoPollMs')) || 3000),
      videoQueueRetries: Math.max(1, Number(pick(settings, 'videoQueueRetries')) || 6),
      optimizeBackend: String(pick(settings, 'optimizeBackend') || 'agnes'),
      optimizeModel: String(pick(settings, 'optimizeModel') || 'agnes-3.0-flash'),
      optimizeMaxTokens: Math.max(64, Number(pick(settings, 'optimizeMaxTokens')) || 900),
      optimizeTimeoutMs: Number(pick(settings, 'optimizeTimeoutMs')) || 120000,
    }
  }

  function resolveKey(settings) {
    // Panel-only on purpose: the plugin ships with no credential at all, so
    // nothing works until the user saves a key in the Settings tab.
    const panelKey = typeof settings.apiKey === 'string' ? settings.apiKey.trim() : ''
    return panelKey !== '' ? { value: panelKey, source: 'panel' } : { value: '', source: 'none' }
  }

  async function status() {
    const settings = await readSettings()
    const eff = effective(settings)
    const key = resolveKey(settings)
    return {
      ok: true,
      hasKey: key.value !== '',
      keySource: key.source,
      keyHint: key.value === '' ? '' : `${key.value.slice(0, 6)}…${key.value.slice(-4)}`,
      model: eff.model,
      size: eff.size,
      ratio: eff.ratio,
      outputDir: eff.outputDir,
      historyLimit: eff.historyLimit,
      sizes: SIZES,
      ratios: RATIOS,
      videoModel: eff.videoModel,
      videoSize: eff.videoSize,
      videoAspect: eff.videoAspect,
      videoSeconds: eff.videoSeconds,
      videoTimeoutMs: eff.videoTimeoutMs,
      videoPollMs: eff.videoPollMs,
      videoQueueRetries: eff.videoQueueRetries,
      videoModes: VIDEO_MODES,
      videoRatios: VIDEO_RATIOS,
      videoSizes: isFlashModel(eff.videoModel) ? FLASH_SIZES : FULL_SIZES,
      videoMaxImages: isFlashModel(eff.videoModel) ? FLASH_MAX_IMAGES : 8,
      videoMaxAudios: isFlashModel(eff.videoModel) ? FLASH_MAX_AUDIOS : 3,
      videoDir: VIDEO_DIR,
      optimizeBackend: eff.optimizeBackend,
      optimizeModel: eff.optimizeModel,
      optimizeBackends: OPTIMIZE_BACKENDS,
      optimizeMaxChars: OPTIMIZE_MAX_CHARS,
      // The `dsh` backend needs the harness LLM service plus a configured
      // default model; reporting both lets the panel disable the option
      // instead of failing after the click.
      llmAvailable: llmService() !== undefined,
      llmRoute: llmSelection(),
      dataDir: dataDir(),
      version: '1.4.0',
    }
  }

  async function updateSettings(body) {
    const settings = await readSettings()
    const next = { ...settings }
    if (body?.clearApiKey === true) {
      delete next.apiKey
    } else if (typeof body?.apiKey === 'string' && body.apiKey.trim() !== '') {
      next.apiKey = body.apiKey.trim()
    }
    for (const key of [
      'model',
      'size',
      'ratio',
      'outputDir',
      'videoModel',
      'videoSize',
      'videoAspect',
      'videoSeconds',
      'optimizeBackend',
      'optimizeModel',
    ]) {
      const value = body?.[key]
      if (typeof value === 'string') next[key] = value.trim()
    }
    for (const key of [
      'videoTimeoutMs',
      'videoPollMs',
      'videoQueueRetries',
      'optimizeMaxTokens',
      'optimizeTimeoutMs',
    ]) {
      const value = Number(body?.[key])
      if (Number.isFinite(value) && value > 0) next[key] = value
    }
    await writeJson(settingsFile(), next)
    return next
  }

  /** header cwd (authoritative, live session) -> panel-supplied cwd -> process cwd. */
  function sessionCwd(sessionId, clientCwd) {
    if (typeof sessionId === 'string' && sessionId !== '') {
      try {
        const cwd = ctx.get('sessions')?.get?.(sessionId)?.header?.cwd
        if (typeof cwd === 'string' && cwd !== '') return cwd
      } catch (error) {
        warn('session lookup failed:', error?.message ?? error)
      }
    }
    if (typeof clientCwd === 'string' && clientCwd !== '' && isAbsolute(clientCwd)) return clientCwd
    return process.cwd()
  }

  const resolveBaseDir = (outputDir, cwd) => {
    if (outputDir === '') return cwd
    return isAbsolute(outputDir) ? outputDir : resolvePath(cwd, outputDir)
  }

  const normalizeSize = (value) => {
    const size = String(value ?? '').trim().toUpperCase()
    return size === '' ? '2K' : size
  }
  const normalizeRatio = (value) => {
    const ratio = String(value ?? '').trim()
    return ratio === '' ? '1:1' : ratio
  }
  const normalizeImages = (value) => {
    if (!Array.isArray(value)) return []
    return value
      .filter((entry) => typeof entry === 'string' && entry.trim() !== '')
      .map((entry) => entry.trim())
      .slice(0, 8)
  }

  async function callAgnes({ key, eff, prompt, size, ratio, images, signal }) {
    const body = {
      model: eff.model,
      prompt,
      size,
      ratio,
      // response_format MUST live under extra_body, never at the top level.
      extra_body: { response_format: 'url' },
    }
    if (images.length > 0) body.extra_body.image = images

    const timeout = AbortSignal.timeout(Math.max(1000, eff.timeoutMs))
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response
    try {
      response = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(body),
        signal: composed,
      })
    } catch (error) {
      const name = error?.name
      if (name === 'TimeoutError' || name === 'AbortError') {
        throw new Error(
          `Agnes request aborted after ${Math.round(eff.timeoutMs / 1000)}s (timeout or cancellation)`,
        )
      }
      throw new Error(`Agnes request failed: ${error?.message ?? String(error)}`)
    }

    const text = await response.text()
    let json
    try {
      json = JSON.parse(text)
    } catch {
      throw new Error(`Agnes returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`)
    }
    if (!response.ok) {
      const detail = json?.error?.message ?? json?.message ?? text.slice(0, 300)
      throw new Error(`Agnes HTTP ${response.status}: ${detail}`)
    }
    const items = Array.isArray(json?.data)
      ? json.data.filter((item) => item && (item.url || item.b64_json))
      : []
    if (items.length === 0) {
      throw new Error(`Agnes returned no image data: ${text.slice(0, 300)}`)
    }
    return { items, taskId: json?.task_id }
  }

  async function fetchBytes(url, eff, signal) {
    const timeout = AbortSignal.timeout(Math.max(1000, eff.timeoutMs))
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetch(url, { signal: composed })
    if (!response.ok) throw new Error(`image download failed HTTP ${response.status}`)
    const type = (response.headers.get('content-type') ?? 'image/png').split(';')[0].trim().toLowerCase()
    return { bytes: Buffer.from(await response.arrayBuffer()), type }
  }

  async function exists(path) {
    try {
      await stat(path)
      return true
    } catch {
      return false
    }
  }

  async function saveImage({ baseDir, bytes, type, prompt }) {
    const now = new Date()
    const dir = join(baseDir, IMAGE_DIR, dateFolder(now))
    await mkdir(dir, { recursive: true })
    const ext = EXT_BY_TYPE[type] ?? '.png'
    const stem = `${clock(now)}-${slugify(prompt)}`
    let file = join(dir, `${stem}${ext}`)
    for (let i = 2; i < 100; i += 1) {
      if (!(await exists(file))) break
      file = join(dir, `${stem}-${i}${ext}`)
    }
    await writeFile(file, bytes)
    return file
  }

  const readHistory = async () => {
    const raw = await readJson(historyFile(), [])
    return Array.isArray(raw) ? raw : []
  }

  async function appendHistory(records, limit) {
    const existing = await readHistory()
    const next = [...records, ...existing].slice(0, Math.max(10, limit))
    await writeJson(historyFile(), next)
    return next
  }

  /**
   * The single generation path shared by the agent tool and the panel route,
   * so both produce identical files, history rows and errors.
   */
  async function generate({ prompt, size, ratio, count, images, sessionId, cwd, signal, origin }) {
    if (typeof prompt !== 'string' || prompt.trim() === '') {
      throw new Error('prompt is required')
    }
    const settings = await readSettings()
    const eff = effective(settings)
    const key = resolveKey(settings)
    if (key.value === '') {
      throw new Error(
        'No Agnes API key configured: open the panel Settings tab and save one first (the plugin ships without a key).',
      )
    }

    const sizeValue = normalizeSize(size ?? eff.size)
    const ratioValue = normalizeRatio(ratio ?? eff.ratio)
    const wanted = Math.min(Math.max(1, Math.round(Number(count) || 1)), MAX_COUNT)
    const references = normalizeImages(images)
    const baseDir = resolveBaseDir(eff.outputDir, sessionCwd(sessionId, cwd))

    const created = []
    let attempts = 0
    while (created.length < wanted && attempts < wanted + 2) {
      attempts += 1
      const { items, taskId } = await callAgnes({
        key: key.value,
        eff,
        prompt: prompt.trim(),
        size: sizeValue,
        ratio: ratioValue,
        images: references,
        signal,
      })
      for (const item of items) {
        if (created.length >= wanted) break
        let bytes
        let type
        if (typeof item.b64_json === 'string' && item.b64_json !== '') {
          bytes = Buffer.from(item.b64_json, 'base64')
          type = 'image/png'
        } else {
          const fetched = await fetchBytes(item.url, eff, signal)
          bytes = fetched.bytes
          type = fetched.type
        }
        const file = await saveImage({ baseDir, bytes, type, prompt: prompt.trim() })
        created.push({
          file,
          name: basename(file),
          bytes: bytes.length,
          contentType: type,
          prompt: prompt.trim(),
          revisedPrompt: typeof item.revised_prompt === 'string' ? item.revised_prompt : '',
          model: eff.model,
          size: sizeValue,
          ratio: ratioValue,
          taskId: taskId ?? '',
          keySource: key.source,
          origin,
          sessionId: typeof sessionId === 'string' ? sessionId : '',
          createdAt: new Date().toISOString(),
        })
      }
    }

    await appendHistory(created, eff.historyLimit)
    return { images: created, baseDir }
  }

  // ------------------------------------------------------------ video half --
  // Images are one HTTP round-trip; videos are an async job: create, then poll
  // until `status` is completed and the top-level `url` is present.
  const videoHistoryFile = () => join(dataDir(), 'video-history.json')
  const videoTasksFile = () => join(dataDir(), 'video-tasks.json')

  const readVideoHistory = async () => {
    const raw = await readJson(videoHistoryFile(), [])
    return Array.isArray(raw) ? raw : []
  }

  async function appendVideoHistory(records, limit) {
    const existing = await readVideoHistory()
    const next = [...records, ...existing].slice(0, Math.max(10, limit))
    await writeJson(videoHistoryFile(), next)
    return next
  }

  /**
   * Unfinished video jobs, keyed by videoId. The panel creates a job and then
   * polls it, so the record is what tells a later poll where to save the file,
   * what to name it, and which prompt it came from — none of which the browser
   * has to resend.
   */
  async function readVideoTasks() {
    const raw = await readJson(videoTasksFile(), [])
    return Array.isArray(raw) ? raw : []
  }

  async function upsertVideoTask(patch) {
    const tasks = await readVideoTasks()
    const rest = tasks.filter((entry) => entry?.videoId !== patch.videoId)
    const merged = [patch, ...rest].slice(0, 100)
    await writeJson(videoTasksFile(), merged)
    return patch
  }

  const findVideoTask = async (videoId) =>
    (await readVideoTasks()).find((entry) => entry?.videoId === videoId) ?? null

  /**
   * Agnes fetches media URLs server-side, so a workspace path can never be sent
   * as-is — local files travel inline as data: URLs instead. The API does decode
   * them (it answered a 1x1 probe with a *dimension* error, not a scheme error);
   * its own limits — 256–5760 px per side, <15 MB per file — still apply.
   */
  async function inlineMedia(entry, cwd, kind) {
    const value = String(entry ?? '').trim()
    if (value === '') return ''
    if (/^(?:https?:|data:)/i.test(value)) return value
    const abs = isAbsolute(value) ? value : resolvePath(cwd, value)
    const info = await stat(abs).catch(() => null)
    if (!info || !info.isFile()) throw new Error(`reference ${kind} not found: ${value}`)
    if (info.size > MAX_MEDIA_BYTES) {
      throw new Error(
        `reference ${kind} is ${formatBytes(info.size)}; the API limit is 15 MB per file`,
      )
    }
    const mime = MEDIA_MIME[extname(abs).toLowerCase()] ?? 'application/octet-stream'
    const bytes = await readFile(abs)
    return `data:${mime};base64,${bytes.toString('base64')}`
  }

  async function inlineMediaList(values, cwd, kind, max) {
    if (!Array.isArray(values)) return []
    const kept = values
      .map((value) => String(value ?? '').trim())
      .filter((value) => value !== '')
      .slice(0, max)
    const out = []
    for (const entry of kept) out.push(await inlineMedia(entry, cwd, kind))
    return out
  }

  const clampSeconds = (value) => {
    const seconds = Math.round(Number(value))
    if (!Number.isFinite(seconds)) return '5'
    return String(Math.min(12, Math.max(4, seconds)))
  }

  const normalizeVideoSize = (value, model) => {
    // Flash validates `size must be 720P` before it does anything else, so
    // silently pin it rather than spending a round-trip on a guaranteed 400.
    if (isFlashModel(model)) return '720P'
    const size = String(value ?? '').trim().toUpperCase()
    return FULL_SIZES.includes(size) ? size : '720P'
  }

  const normalizeVideoAspect = (value) => {
    const aspect = String(value ?? '').trim()
    return VIDEO_RATIOS.includes(aspect) ? aspect : '16:9'
  }

  async function buildVideoPayload({
    eff,
    prompt,
    mode,
    seconds,
    size,
    aspect,
    firstFrame,
    lastFrame,
    images,
    audios,
    seed,
    cwd,
  }) {
    const text = String(prompt ?? '').trim()
    if (text === '') throw new Error('prompt is required')
    const modeValue = VIDEO_MODES.includes(String(mode ?? '')) ? String(mode) : 'text'
    const payload = {
      model: eff.videoModel,
      prompt: text,
      mode: modeValue,
      seconds: clampSeconds(seconds ?? eff.videoSeconds),
      size: normalizeVideoSize(size ?? eff.videoSize, eff.videoModel),
      aspect_ratio: normalizeVideoAspect(aspect ?? eff.videoAspect),
      n: 1,
    }
    const seedValue = Number(seed)
    if (Number.isFinite(seedValue) && seedValue !== 0) payload.seed = Math.trunc(seedValue)

    // The API rejects media fields that do not belong to the mode, so each
    // branch sends only what its mode allows.
    if (modeValue === 'text') return { payload, prompt: text }

    if (modeValue === 'keyframe') {
      const first = await inlineMedia(firstFrame, cwd, 'first frame')
      const last = await inlineMedia(lastFrame, cwd, 'last frame')
      if (first === '' && last === '') {
        throw new Error('keyframe mode needs first_frame and/or last_frame')
      }
      if (first !== '') payload.first_frame = first
      if (last !== '') payload.last_frame = last
      return { payload, prompt: text }
    }

    const maxImages = isFlashModel(eff.videoModel) ? FLASH_MAX_IMAGES : 8
    const maxAudios = isFlashModel(eff.videoModel) ? FLASH_MAX_AUDIOS : 3
    const imageList = await inlineMediaList(images, cwd, 'image', maxImages)
    const audioList = await inlineMediaList(audios, cwd, 'audio', maxAudios)
    if (imageList.length === 0 && audioList.length === 0) {
      throw new Error('reference mode needs at least one reference image or audio')
    }
    if (imageList.length > 0) payload.images = imageList
    if (audioList.length > 0) payload.audios = audioList
    return { payload, prompt: text }
  }

  /**
   * The video API mixes three error envelopes — {detail}, {code,message,data}
   * and {error:{message}} — so all of them have to be read.
   */
  function videoErrorText(json, fallback) {
    const candidates = [json?.detail, json?.error?.message, json?.message, json?.error]
    for (const candidate of candidates) {
      if (typeof candidate === 'string' && candidate.trim() !== '') return candidate.trim()
    }
    const raw = String(fallback ?? '').trim()
    return raw === '' ? 'no response body' : raw.slice(0, 300)
  }

  // 503 video_queue_full / video_queue_unavailable and 429 free-tier rate limits
  // are transient: they mean "ask again shortly", not "your request is wrong".
  const RETRIABLE_STATUS = new Set([429, 500, 502, 503, 504])

  function sleep(ms, signal) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup()
        resolve()
      }, ms)
      const onAbort = () => {
        cleanup()
        reject(new Error('Agnes video request aborted (cancelled)'))
      }
      const cleanup = () => {
        clearTimeout(timer)
        signal?.removeEventListener?.('abort', onAbort)
      }
      if (signal?.aborted) {
        cleanup()
        reject(new Error('Agnes video request aborted (cancelled)'))
        return
      }
      signal?.addEventListener?.('abort', onAbort)
    })
  }

  async function callVideoCreate({ key, eff, payload, signal, onNote }) {
    const attempts = eff.videoQueueRetries
    let last = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const timeout = AbortSignal.timeout(Math.max(1000, eff.timeoutMs))
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
      let response
      try {
        response = await fetch(VIDEO_CREATE_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify(payload),
          signal: composed,
        })
      } catch (error) {
        throw new Error(`Agnes video request failed: ${error?.message ?? String(error)}`)
      }
      const text = await response.text()
      let json = null
      try {
        json = JSON.parse(text)
      } catch {
        json = null
      }
      if (response.ok) {
        if (json === null) {
          throw new Error(`Agnes video returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`)
        }
        return { task: json, attempts: attempt }
      }
      last = { status: response.status, json, text }
      if (!RETRIABLE_STATUS.has(response.status) || attempt === attempts) break
      const waitMs = Math.min(30000, 5000 * attempt)
      const note = `Agnes video queue busy (HTTP ${response.status}: ${videoErrorText(json, text)}); retry ${attempt + 1}/${attempts} in ${Math.round(waitMs / 1000)}s`
      if (onNote) onNote(note)
      else warn(note)
      await sleep(waitMs, signal)
    }
    const detail = videoErrorText(last?.json, last?.text)
    const hint = RETRIABLE_STATUS.has(last?.status)
      ? ` — the free video queue was busy or rate-limited after ${attempts} attempts; retry in a minute`
      : ''
    throw new Error(`Agnes video HTTP ${last?.status}: ${detail}${hint}`)
  }

  async function queryVideo({ key, model, videoId, signal }) {
    const target = new URL(VIDEO_QUERY_URL)
    target.searchParams.set('video_id', videoId)
    // Required for keyframe/reference jobs; accepted for text jobs too.
    target.searchParams.set('model_name', model)
    const timeout = AbortSignal.timeout(60000)
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
    let response
    try {
      response = await fetch(target, {
        headers: { authorization: `Bearer ${key}` },
        signal: composed,
      })
    } catch (error) {
      if (signal?.aborted) throw new Error('Agnes video request aborted (cancelled)')
      const wrapped = new Error(`Agnes video query failed: ${error?.message ?? String(error)}`)
      wrapped.retriable = true
      throw wrapped
    }
    const text = await response.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {
      json = null
    }
    if (!response.ok) {
      // Polling gets its own share of 429s, so a transient failure here must be
      // marked retriable rather than aborting a job that is still rendering.
      const error = new Error(`Agnes video query HTTP ${response.status}: ${videoErrorText(json, text)}`)
      error.retriable = RETRIABLE_STATUS.has(response.status)
      throw error
    }
    if (json === null) {
      throw new Error(`Agnes video query returned non-JSON (HTTP ${response.status}): ${text.slice(0, 300)}`)
    }
    return json
  }

  async function waitForVideo({ key, eff, videoId, signal, onProgress }) {
    const deadline = Date.now() + eff.videoTimeoutMs
    let snapshot = null
    while (Date.now() < deadline) {
      await sleep(eff.videoPollMs, signal)
      try {
        snapshot = await queryVideo({ key, model: eff.videoModel, videoId, signal })
      } catch (error) {
        // A busy/rate-limited poll is not a failed render: keep waiting.
        if (error?.retriable && Date.now() < deadline) {
          if (onProgress) onProgress({ status: 'pending', progress: 0, note: error.message })
          continue
        }
        throw error
      }
      if (onProgress) onProgress(snapshot)
      if (snapshot?.status === 'completed') return snapshot
      if (snapshot?.status === 'failed') {
        throw new Error(`Agnes video failed: ${videoErrorText(snapshot?.error, 'generation failed')}`)
      }
    }
    throw new Error(
      `Agnes video timed out after ${Math.round(eff.videoTimeoutMs / 1000)}s (task ${videoId} still ${snapshot?.status ?? 'unknown'})`,
    )
  }

  async function downloadVideo(url, eff, signal) {
    const timeout = AbortSignal.timeout(Math.max(60000, eff.timeoutMs))
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
    const response = await fetch(url, { signal: composed })
    if (!response.ok) throw new Error(`video download failed HTTP ${response.status}`)
    return Buffer.from(await response.arrayBuffer())
  }

  async function saveVideo({ baseDir, bytes, prompt }) {
    const now = new Date()
    const dir = join(baseDir, VIDEO_DIR, dateFolder(now))
    await mkdir(dir, { recursive: true })
    const stem = `${clock(now)}-${slugify(prompt)}`
    let file = join(dir, `${stem}.mp4`)
    for (let i = 2; i < 100; i += 1) {
      if (!(await exists(file))) break
      file = join(dir, `${stem}-${i}.mp4`)
    }
    await writeFile(file, bytes)
    return file
  }

  /**
   * Poster frame for a finished video. The browser captures frame 0..1 s onto a
   * canvas and posts it here as a PNG data URL; the file is written next to the
   * MP4 as `<stem>-cover.png` and recorded in both the history row and the task
   * row so the library can show a still cover instead of loading the video.
   *
   * Only videos this plugin recorded are accepted — same fence as `openLocalFile`.
   */
  async function saveVideoCover(file, dataUrl) {
    if (typeof file !== 'string' || file.trim() === '') throw new Error('file is required')
    const known = (await readVideoHistory()).find((record) => record?.file === file)
    if (!known) {
      const error = new Error('no history record for that file')
      error.statusCode = 404
      throw error
    }
    const prefix = 'data:image/png;base64,'
    if (typeof dataUrl !== 'string' || !dataUrl.startsWith(prefix)) {
      throw new Error('dataUrl must be a base64 PNG data URL (data:image/png;base64,...)')
    }
    const bytes = Buffer.from(dataUrl.slice(prefix.length), 'base64')
    if (bytes.length === 0) throw new Error('cover image is empty')
    if (bytes.length > MAX_COVER_BYTES) {
      throw new Error(`cover image is too large (${formatBytes(bytes.length)} > ${formatBytes(MAX_COVER_BYTES)})`)
    }
    if (!(await exists(file))) throw new Error('the recorded video file is gone from disk')

    const cover = join(dirname(file), `${basename(file).replace(/\.[^.]+$/, '')}-cover.png`)
    await writeFile(cover, bytes)
    const history = await readVideoHistory()
    await writeJson(
      videoHistoryFile(),
      history.map((record) => (record?.file === file ? { ...record, cover } : record)),
    )
    const tasks = await readVideoTasks()
    const touched = tasks.find((entry) => entry?.file === file)
    if (touched) {
      await writeJson(
        videoTasksFile(),
        tasks.map((entry) => (entry?.file === file ? { ...entry, cover } : entry)),
      )
    }
    return { cover }
  }

  async function resolveKeyOrThrow(settings) {
    const key = resolveKey(settings)
    if (key.value === '') {
      throw new Error(
        'No Agnes API key configured: open the panel Settings tab and save one first (the plugin ships without a key).',
      )
    }
    return key
  }

  // ------------------------------------------------------------- optimizer --

  /**
   * `ctx.llm` when this host exposes it. Resolved defensively rather than
   * declared as an injection: the image and video paths must keep working on a
   * host without the LLM service, only the `dsh` optimizer option goes dark.
   */
  const llmService = () => {
    try {
      return ctx.get('llm') ?? ctx.llm
    } catch (error) {
      warn('llm lookup failed:', error?.message ?? error)
      return undefined
    }
  }

  /**
   * The model this profile is set to use, which is what the panel labels
   * "DSH 当前模型". `null` means the option has to be offered as unavailable.
   */
  function llmSelection() {
    try {
      const selected = ctx.get('agentDefaultModel')?.currentSelection?.()
      const provider = typeof selected?.provider === 'string' ? selected.provider : ''
      const model = typeof selected?.model === 'string' ? selected.model : ''
      return provider === '' || model === '' ? null : { provider, model }
    } catch (error) {
      warn('default model lookup failed:', error?.message ?? error)
      return null
    }
  }

  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

  const QUOTE_PAIRS = { '"': '"', "'": "'", '“': '”', '「': '」', '『': '』' }

  /**
   * Models like to hand back fences, labels and quotes even when told not to;
   * the prompt box accepts any of it, but the generated prompt should not carry
   * it. Also collapses to a single line and enforces the length cap.
   */
  function cleanOptimized(text) {
    let out = String(text ?? '')
      .replace(/\r\n?/g, '\n')
      .trim()
    const fence = /^```[a-zA-Z]*\n([\s\S]*?)\n?```$/.exec(out)
    if (fence) out = fence[1].trim()
    out = out
      .replace(/^(?:optimized|improved|prompt|提示词|优化后(?:的)?提示词|优化结果)\s*[:：]\s*/i, '')
      .trim()
    for (let i = 0; i < 2; i += 1) {
      const first = out[0]
      if (out.length > 1 && first !== undefined && QUOTE_PAIRS[first] === out[out.length - 1]) {
        out = out.slice(1, -1).trim()
      }
    }
    out = out.replace(/[ \t]*\n[ \t]*/g, ' ').replace(/\s{2,}/g, ' ').trim()
    if (out.length > OPTIMIZE_MAX_CHARS) out = `${out.slice(0, OPTIMIZE_MAX_CHARS).trimEnd()}…`
    return out
  }

  const optimizeSystem = (kind, seconds) =>
    kind === 'video' ? `${OPTIMIZE_SYSTEM.video}\nThe clip is ${seconds} seconds long.` : OPTIMIZE_SYSTEM.image

  /**
   * The `agnes` backend: one Chat Completions call on the shared key. 429/5xx
   * are the same free-tier conditions the video endpoints hit, so retry briefly
   * instead of failing the click.
   */
  async function optimizeWithAgnes({ key, eff, prompt, kind, seconds, signal, onNote }) {
    const attempts = 3
    let last = null
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const timeout = AbortSignal.timeout(Math.max(1000, eff.optimizeTimeoutMs))
      const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
      let response
      try {
        response = await fetch(CHAT_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
          body: JSON.stringify({
            model: eff.optimizeModel,
            messages: [
              { role: 'system', content: optimizeSystem(kind, seconds) },
              { role: 'user', content: prompt },
            ],
            temperature: 0.7,
            max_tokens: eff.optimizeMaxTokens,
          }),
          signal: composed,
        })
      } catch (error) {
        throw new Error(`Agnes optimize request failed: ${error?.message ?? String(error)}`)
      }
      const raw = await response.text()
      let body = null
      try {
        body = raw === '' ? null : JSON.parse(raw)
      } catch {
        body = null
      }
      if (response.ok) {
        const content = body?.choices?.[0]?.message?.content
        const plain = Array.isArray(content)
          ? content.map((part) => (typeof part === 'string' ? part : (part?.text ?? ''))).join(' ')
          : content
        const cleaned = cleanOptimized(plain)
        if (cleaned === '') {
          throw new Error(`Agnes optimize returned no text: ${raw.slice(0, 200) || 'empty response'}`)
        }
        return { text: cleaned, usage: body?.usage ?? null }
      }
      last = { status: response.status, detail: videoErrorText(body, raw) }
      if (!RETRIABLE_STATUS.has(response.status) || attempt === attempts) break
      const waitMs = 2000 * attempt
      onNote?.(
        `Agnes optimize busy (HTTP ${last.status}: ${last.detail}); retry ${attempt + 1}/${attempts} in ${Math.round(waitMs / 1000)}s`,
      )
      await wait(waitMs)
    }
    throw new Error(`Agnes optimize HTTP ${last?.status ?? '?'}: ${last?.detail ?? 'no response body'}`)
  }

  /**
   * The `dsh` backend: one auxiliary model call through the harness LLM
   * service, on the profile's own selection — no second key, no extra billing
   * path. Mirrors dsh-session-title-llm's call shape (stream + BlockAssembler).
   */
  async function optimizeWithDsh({ eff, prompt, kind, seconds, sessionId, signal }) {
    const llm = llmService()
    if (typeof llm?.stream !== 'function') {
      throw new Error(
        'The DSH model backend is unavailable in this host; switch the optimizer to the Agnes backend',
      )
    }
    const route = llmSelection()
    if (route === null) {
      throw new Error(
        'No DSH model is configured for this profile, so the DSH backend cannot run; switch the optimizer to the Agnes backend',
      )
    }
    const timeout = AbortSignal.timeout(Math.max(1000, eff.optimizeTimeoutMs))
    const composed = signal ? AbortSignal.any([signal, timeout]) : timeout
    const messages = [
      createUserMessage({
        content: [{ type: 'text', text: prompt }],
        source: { kind: 'dsh-agnes-image' },
      }),
    ]
    const assembler = new BlockAssembler()
    const stream = llm.stream({
      provider: route.provider,
      model: route.model,
      messages,
      system: optimizeSystem(kind, seconds),
      maxTokens: eff.optimizeMaxTokens,
      ...(typeof sessionId === 'string' && sessionId !== '' ? { sessionId } : {}),
      purpose: 'agnes-prompt-optimize',
      signal: composed,
    })
    for await (const chunk of stream) assembler.push(chunk)
    const finish = assembler.finish
    if (finish?.kind !== 'stop') {
      throw new Error(
        `DSH optimize failed: ${finish?.failure?.message ?? `the model finished with "${String(finish?.kind)}"`}`,
      )
    }
    const blocks = assembler.blocks?.() ?? []
    if (blocks.some((block) => block.type === 'tool-call')) {
      throw new Error('DSH optimize failed: the model tried to call a tool instead of rewriting the prompt')
    }
    const cleaned = cleanOptimized(
      blocks
        .filter((block) => block.type === 'text')
        .map((block) => block.text)
        .join(' '),
    )
    if (cleaned === '') throw new Error('DSH optimize returned no text')
    return { text: cleaned, usage: null, route }
  }

  /**
   * Shared by the panel route; the agent side has no optimizer tool because the
   * agent can already write its own prompt.
   */
  async function optimizePrompt({ prompt, kind, backend, seconds, sessionId, signal, onNote }) {
    const text = typeof prompt === 'string' ? prompt.trim() : ''
    if (text === '') throw new Error('prompt is required')
    if (text.length > OPTIMIZE_MAX_INPUT) {
      throw new Error(`prompt is too long to optimize (${OPTIMIZE_MAX_INPUT} characters max)`)
    }
    const mode = kind === 'video' ? 'video' : 'image'
    const settings = await readSettings()
    const eff = effective(settings)
    const requested = typeof backend === 'string' ? backend.trim() : ''
    const which = OPTIMIZE_BACKENDS.includes(requested)
      ? requested
      : OPTIMIZE_BACKENDS.includes(eff.optimizeBackend)
        ? eff.optimizeBackend
        : 'agnes'
    const clipSeconds = String(seconds ?? eff.videoSeconds ?? '5')
    if (which === 'dsh') {
      const result = await optimizeWithDsh({ eff, prompt: text, kind: mode, seconds: clipSeconds, sessionId, signal })
      return {
        original: text,
        prompt: result.text,
        backend: 'dsh',
        model: `${result.route.provider}/${result.route.model}`,
      }
    }
    const key = await resolveKeyOrThrow(settings)
    const result = await optimizeWithAgnes({
      key: key.value,
      eff,
      prompt: text,
      kind: mode,
      seconds: clipSeconds,
      signal,
      onNote,
    })
    return { original: text, prompt: result.text, backend: 'agnes', model: eff.optimizeModel }
  }

  /**
   * Blocking video path, shared by the agent tool: create, poll, download, save.
   * Takes minutes; the panel uses the create/poll split below instead.
   */
  async function generateVideo(args) {
    const settings = await readSettings()
    const eff = effective(settings)
    const key = await resolveKeyOrThrow(settings)
    const cwd = sessionCwd(args.sessionId, args.cwd)
    const baseDir = resolveBaseDir(eff.outputDir, cwd)
    const { payload } = await buildVideoPayload({ eff, ...args, cwd })
    const created = await callVideoCreate({ key: key.value, eff, payload, signal: args.signal })
    const videoId = String(created.task?.video_id ?? created.task?.id ?? '')
    if (videoId === '') {
      throw new Error(`Agnes video create returned no video_id: ${JSON.stringify(created.task).slice(0, 300)}`)
    }
    const final = await waitForVideo({ key: key.value, eff, videoId, signal: args.signal })
    const url = typeof final?.url === 'string' ? final.url : ''
    if (url === '') {
      throw new Error(`Agnes video completed without a url: ${JSON.stringify(final).slice(0, 300)}`)
    }
    const bytes = await downloadVideo(url, eff, args.signal)
    const file = await saveVideo({ baseDir, bytes, prompt: payload.prompt })
    const record = {
      file,
      name: basename(file),
      bytes: bytes.length,
      contentType: 'video/mp4',
      cover: '',
      prompt: payload.prompt,
      model: eff.videoModel,
      mode: payload.mode,
      seconds: String(final?.seconds ?? payload.seconds),
      size: String(final?.size ?? payload.size),
      aspectRatio: payload.aspect_ratio,
      videoId,
      taskId: String(created.task?.task_id ?? created.task?.id ?? ''),
      keySource: key.source,
      origin: args.origin,
      sessionId: typeof args.sessionId === 'string' ? args.sessionId : '',
      createdAt: new Date().toISOString(),
    }
    await appendVideoHistory([record], eff.historyLimit)
    return { video: record, baseDir, attempts: created.attempts }
  }

  /** Panel step 1: create the job and hand the browser a videoId to poll. */
  async function createVideoTask(body) {
    const settings = await readSettings()
    const eff = effective(settings)
    const key = await resolveKeyOrThrow(settings)
    const cwd = sessionCwd(body?.sessionId, body?.cwd)
    const baseDir = resolveBaseDir(eff.outputDir, cwd)
    const { payload } = await buildVideoPayload({
      eff,
      prompt: body?.prompt,
      mode: body?.mode,
      seconds: body?.seconds,
      size: body?.size,
      aspect: body?.aspect ?? body?.aspectRatio,
      firstFrame: body?.firstFrame,
      lastFrame: body?.lastFrame,
      images: body?.images,
      audios: body?.audios,
      seed: body?.seed,
      cwd,
    })
    const created = await callVideoCreate({ key: key.value, eff, payload })
    const videoId = String(created.task?.video_id ?? created.task?.id ?? '')
    if (videoId === '') {
      throw new Error(`Agnes video create returned no video_id: ${JSON.stringify(created.task).slice(0, 300)}`)
    }
    return upsertVideoTask({
      videoId,
      model: eff.videoModel,
      prompt: payload.prompt,
      mode: payload.mode,
      seconds: payload.seconds,
      size: payload.size,
      aspectRatio: payload.aspect_ratio,
      baseDir,
      sessionId: typeof body?.sessionId === 'string' ? body.sessionId : '',
      status: String(created.task?.status ?? 'queued'),
      progress: Number(created.task?.progress) || 0,
      keySource: key.source,
      origin: 'panel',
      createdAt: new Date().toISOString(),
      file: '',
      name: '',
      bytes: 0,
      error: '',
    })
  }

  /**
   * Panel step 2: refresh one job. The download+save happens exactly once —
   * once `file` is set the record short-circuits, so repeated polls are cheap.
   */
  async function refreshVideoTask(videoId) {
    const task = await findVideoTask(videoId)
    if (!task) throw new Error(`unknown video task: ${videoId}`)
    if (task.file) return task
    const settings = await readSettings()
    const eff = effective(settings)
    const key = await resolveKeyOrThrow(settings)
    let snapshot
    try {
      snapshot = await queryVideo({
        key: key.value,
        model: task.model || eff.videoModel,
        videoId,
      })
    } catch (error) {
      // Keep the job alive across a rate-limited poll; the panel just polls again.
      if (!error?.retriable) throw error
      return upsertVideoTask({ ...task, note: error.message })
    }
    const status = String(snapshot?.status ?? task.status)
    const progress = Number(snapshot?.progress) || 0
    if (status === 'failed') {
      return upsertVideoTask({
        ...task,
        status,
        progress: 100,
        error: videoErrorText(snapshot?.error, 'generation failed'),
      })
    }
    if (status !== 'completed') return upsertVideoTask({ ...task, status, progress, note: '' })
    const url = typeof snapshot?.url === 'string' ? snapshot.url : ''
    if (url === '') throw new Error('Agnes reported the video as completed without a url')
    const bytes = await downloadVideo(url, eff)
    const file = await saveVideo({ baseDir: task.baseDir, bytes, prompt: task.prompt })
    const record = {
      ...task,
      status,
      progress: 100,
      file,
      name: basename(file),
      bytes: bytes.length,
      contentType: 'video/mp4',
      cover: task.cover ?? '',
      seconds: String(snapshot?.seconds ?? task.seconds),
      size: String(snapshot?.size ?? task.size),
      taskId: String(snapshot?.id ?? task.taskId ?? ''),
      finishedAt: new Date().toISOString(),
      error: '',
    }
    await upsertVideoTask(record)
    await appendVideoHistory([record], eff.historyLimit)
    return record
  }

  function describeVideoResult(result) {
    const video = result.video
    return [
      `Agnes generated a ${video.seconds}s ${video.size} video (${video.model}, mode ${video.mode}, ratio ${video.aspectRatio}).`,
      `Saved to disk — absolute path:\n  ${video.file}  (${formatBytes(video.bytes)})`,
      `Task ${video.videoId}. Videos take a minute or two; the queue can be busy, in which case retrying later is the fix.`,
    ].join('\n')
  }

  function describeResult(result) {
    const first = result.images[0]
    const lines = [
      `Agnes generated ${result.images.length} image${result.images.length === 1 ? '' : 's'} (${first.model}, ${first.size} ${first.ratio}).`,
      'Saved to disk — absolute paths:',
    ]
    for (const image of result.images) {
      lines.push(`  ${image.file}  (${formatBytes(image.bytes)})`)
    }
    if (first.revisedPrompt) lines.push(`Revised prompt: ${first.revisedPrompt}`)
    return lines.join('\n')
  }

  ctx.tools.register(
    defineTool({
      name: 'agnes_generate_image',
      description:
        'Generate one or more images from a text prompt with the Agnes image model (agnes-image-2.5-flash) and save them into the workspace. Returns the absolute local paths of the saved PNG/JPEG files. Also supports image-to-image and multi-image composition by passing reference images as public HTTPS URLs or as data:image/...;base64 strings.',
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description: 'What to draw. Use the user\'s own wording; Chinese prompts are supported.',
        },
        size: {
          type: 'string',
          enum: [...SIZES],
          description:
            'Output resolution bucket: 1K, 2K (default), 3K or 4K. An exact WxH string is also accepted.',
        },
        ratio: {
          type: 'string',
          enum: [...RATIOS],
          description: 'Aspect ratio (default 1:1). 16:9 and 9:16 suit wallpapers and phone screens.',
        },
        reference_images: {
          type: 'array',
          items: { type: 'string' },
          description:
            'Optional reference images for image-to-image or composition: public HTTPS URLs or data:image/...;base64 strings. Do not also ask for the img2img tag; the model infers it.',
        },
        count: {
          type: 'number',
          description: 'How many images to generate, 1 (default) to 4.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        const cwd = exec?.agent?.session?.header?.cwd
        const result = await generate({
          prompt: args.prompt,
          size: args.size,
          ratio: args.ratio,
          count: args.count,
          images: args.reference_images,
          cwd,
          signal: exec?.signal,
          origin: 'tool',
        })
        return describeResult(result)
      },
    }),
  )

  ctx.tools.register(
    defineTool({
      name: 'agnes_generate_video',
      description:
        'Generate a short video with the Agnes video model (agnes-video-2.5-flash, 4–12 s, 720P) and save it into the workspace as an MP4; returns the absolute local path. Modes: "text" (prompt only), "keyframe" (first_frame and/or last_frame), "reference" (images and/or audios). Reference media may be a public HTTPS URL, a data: URL, or a path to a local file — local files are read and inlined automatically. This is an async job and takes roughly one to three minutes; the shared free queue is sometimes full, in which case the call is retried a few times before failing with a message telling you to try again later.',
      timeoutMs: 900000,
      parameters: {
        prompt: {
          type: 'string',
          required: true,
          description:
            'What happens in the video. Describe subject and scene, then action, camera movement, style and sound. Chinese is supported.',
        },
        mode: {
          type: 'string',
          enum: [...VIDEO_MODES],
          description:
            'text (default, prompt only), keyframe (uses first_frame/last_frame), or reference (uses images/audios).',
        },
        seconds: {
          type: 'string',
          description: 'Clip length as a string from "4" to "12"; default "5".',
        },
        size: {
          type: 'string',
          enum: [...FULL_SIZES],
          description:
            'Resolution bucket. agnes-video-2.5-flash accepts only 720P (anything else is pinned to 720P); agnes-video-2.5 also accepts 1080P, 1K and 2K.',
        },
        aspect_ratio: {
          type: 'string',
          enum: [...VIDEO_RATIOS],
          description: 'Frame shape; default 16:9.',
        },
        first_frame: {
          type: 'string',
          description: 'keyframe mode: first-frame image. Public HTTPS URL, data: URL, or a local file path.',
        },
        last_frame: {
          type: 'string',
          description: 'keyframe mode: last-frame image (same accepted forms as first_frame).',
        },
        images: {
          type: 'array',
          items: { type: 'string' },
          description:
            'reference mode: up to 5 reference images (flash). Refer to them in the prompt as <Picture 1>, <Picture 2>, …',
        },
        audios: {
          type: 'array',
          items: { type: 'string' },
          description:
            'reference mode: up to 3 reference audio clips (flash), 2–12 s each. Refer to them as <Audio 1>, …',
        },
        seed: {
          type: 'number',
          description: 'Optional integer seed; the same seed makes results more reproducible.',
        },
      },
      output: {
        schema: { type: 'string' },
        render: (_args, value) => [{ type: 'text', text: String(value) }],
      },
      async execute(args, exec) {
        const cwd = exec?.agent?.session?.header?.cwd
        const result = await generateVideo({
          prompt: args.prompt,
          mode: args.mode,
          seconds: args.seconds,
          size: args.size,
          aspect: args.aspect_ratio,
          firstFrame: args.first_frame,
          lastFrame: args.last_frame,
          images: args.images,
          audios: args.audios,
          seed: args.seed,
          cwd,
          signal: exec?.signal,
          origin: 'tool',
        })
        return describeVideoResult(result)
      },
    }),
  )

  // ---------------------------------------------------------------- routes --
  // Registered through connection.fetch so the /api prefix applies the
  // harness trust fence + browser cookie check for us (registration is already
  // scoped to this plugin's effect, no extra ctx.effect needed).
  const json = (value, statusCode = 200) =>
    new Response(JSON.stringify(value), {
      status: statusCode,
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
    })
  const fail = (error, statusCode = 400) =>
    json({ ok: false, error: error?.message ?? String(error) }, statusCode)

  // ---------------------------------------------------------- desktop open --

  /**
   * Hand one recorded media file to the desktop the way a folder window does:
   * `default` opens it with the file-type association (the default player or
   * image viewer), `reveal` selects it in the file manager.
   *
   * Only files this plugin recorded are accepted, so a crafted request body
   * cannot make the host launch an arbitrary path.
   */
  async function openLocalFile(file, action, request) {
    const target = String(file ?? '')
    if (target === '') throw new Error('file is required')
    const [images, videos] = await Promise.all([readHistory(), readVideoHistory()])
    const known = [...images, ...videos].some((entry) => entry && entry.file === target)
    if (!known) {
      const error = new Error('no history record for that file')
      error.statusCode = 404
      throw error
    }
    await stat(target)
    if (!canOpenNativePath()) throw new Error(`this host cannot open local files (${process.platform})`)
    const signal = AbortSignal.any([
      request?.signal ?? new AbortController().signal,
      AbortSignal.timeout(30000),
    ])
    if (action === 'reveal') await revealNativePath(target, signal)
    else await openNativeAssociatedPath(target, signal)
    return { ok: true, action: action === 'reveal' ? 'reveal' : 'default', file: target }
  }

  const routes = [
    {
      path: `${ROUTE}/status`,
      methods: ['GET'],
      // Required by ConnectionFetchRoute: the shared /api handler returns this
      // value verbatim, and an omitted mode makes the http bridge build a
      // GET Request with a stream body, which throws and surfaces as a bare
      // 400. Must stay 'buffered' for GET routes too.
      requestBody: 'buffered',
      fetch: async () => {
        try {
          return json(await status())
        } catch (error) {
          return fail(error, 500)
        }
      },
    },
    {
      path: `${ROUTE}/history`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const limit = Number(new URL(request.url).searchParams.get('limit')) || 60
          const items = (await readHistory()).slice(0, Math.min(Math.max(1, limit), 500))
          return json({ ok: true, items, dataDir: dataDir() })
        } catch (error) {
          return fail(error, 500)
        }
      },
    },
    {
      path: `${ROUTE}/generate`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          const result = await generate({
            prompt: body.prompt,
            size: body.size,
            ratio: body.ratio,
            count: body.count,
            images: body.referenceImages ?? body.reference_images,
            sessionId: body.sessionId,
            cwd: body.cwd,
            signal: request.signal,
            origin: 'panel',
          })
          return json({ ok: true, images: result.images, baseDir: result.baseDir })
        } catch (error) {
          return fail(error)
        }
      },
    },
    {
      path: `${ROUTE}/settings`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          await updateSettings(body)
          return json(await status())
        } catch (error) {
          return fail(error)
        }
      },
    },
    {
      path: `${ROUTE}/delete`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          const file = String(body.file ?? '')
          const history = await readHistory()
          // Only files this plugin recorded can be deleted, so a crafted
          // request body cannot reach arbitrary paths.
          const record = history.find((entry) => entry && entry.file === file)
          if (!record) return fail(new Error('no history record for that file'), 404)
          await rm(record.file, { force: true })
          await writeJson(
            historyFile(),
            history.filter((entry) => entry !== record),
          )
          return json({ ok: true })
        } catch (error) {
          return fail(error)
        }
      },
    },
    {
      path: `${ROUTE}/open`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          return json(await openLocalFile(body.file, body.action, request))
        } catch (error) {
          return fail(error, error?.statusCode ?? 400)
        }
      },
    },
    {
      path: `${ROUTE}/video-create`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          const task = await createVideoTask(body)
          return json({ ok: true, task })
        } catch (error) {
          return fail(error)
        }
      },
    },
    {
      path: `${ROUTE}/video-status`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const videoId = new URL(request.url).searchParams.get('videoId') ?? ''
          if (videoId === '') return fail(new Error('videoId is required'))
          const task = await refreshVideoTask(videoId)
          return json({ ok: true, task })
        } catch (error) {
          return fail(error, 500)
        }
      },
    },
    {
      path: `${ROUTE}/video-history`,
      methods: ['GET'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const limit = Number(new URL(request.url).searchParams.get('limit')) || 60
          const items = (await readVideoHistory()).slice(0, Math.min(Math.max(1, limit), 500))
          return json({ ok: true, items, dataDir: dataDir(), videoDir: VIDEO_DIR })
        } catch (error) {
          return fail(error, 500)
        }
      },
    },
    {
      path: `${ROUTE}/video-delete`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          const file = String(body.file ?? '')
          const history = await readVideoHistory()
          // Same rule as images: only a file this plugin recorded can be
          // deleted, so a crafted body cannot reach arbitrary paths.
          const record = history.find((entry) => entry && entry.file === file)
          if (!record) return fail(new Error('no history record for that file'), 404)
          await rm(record.file, { force: true })
          await writeJson(
            videoHistoryFile(),
            history.filter((entry) => entry !== record),
          )
          return json({ ok: true })
        } catch (error) {
          return fail(error)
        }
      },
    },
    {
      path: `${ROUTE}/video-cover`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          const saved = await saveVideoCover(String(body.file ?? ''), body.dataUrl)
          return json({ ok: true, cover: saved.cover })
        } catch (error) {
          return fail(error, error?.statusCode ?? 400)
        }
      },
    },
    {
      path: `${ROUTE}/optimize`,
      methods: ['POST'],
      requestBody: 'buffered',
      fetch: async (request) => {
        try {
          const body = (await request.json().catch(() => ({}))) ?? {}
          const notes = []
          const result = await optimizePrompt({
            prompt: body.prompt,
            kind: body.kind,
            backend: body.backend,
            seconds: body.seconds,
            sessionId: body.sessionId,
            onNote: (note) => notes.push(note),
          })
          return json({ ok: true, ...result, notes })
        } catch (error) {
          return fail(error)
        }
      },
    },
  ]

  // `connection` is a declared injection, but resolve it through ctx.get too so
  // the plugin also works when the service is injected under a different key.
  const connection = ctx.get('connection') ?? ctx.connection
  if (connection?.fetch?.register) {
    for (const route of routes) {
      try {
        connection.fetch.register(route)
      } catch (error) {
        // A duplicate path is the only realistic failure here; keep the tool
        // and the remaining routes alive regardless.
        warn('route registration failed:', route.path, error?.message ?? error)
      }
    }
  } else {
    warn('connection service unavailable — panel routes not registered (agent tool still works)')
  }
}
