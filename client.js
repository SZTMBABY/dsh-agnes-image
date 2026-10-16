/**
 * dsh-agnes-image — client half.
 *
 * Registers one sidebar entry (`sidebar.panellist`) and the full page behind it
 * (`main`), then talks to the host half over the plugin's own document-relative
 * `/api/agnes-image/*` routes. The API key never reaches this file.
 *
 * No build step: this is the browser artefact directly, loaded by the harness
 * module loader under the package id below.
 */
window.__ModuleLoader__.load({
  id: 'dsh-agnes-image',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })

    const React = require('react')
    const h = React.createElement
    const { useCallback, useEffect, useRef, useState } = React

    const NS = 'dsh-agnes-image'
    const PANEL_ID = 'agnes-image'
    const PANEL_ORDER = 60
    // User-picked CTA colour. Hover/active need real pseudo-classes, so they live
    // in one idempotently injected <style> tag (the idiom core client bundles use,
    // e.g. dsh-client-ui-message-feedback/lib/client.js:12-20); the fill itself is
    // also set inline so a blocked injection still renders an orange button.
    const PRIMARY_CLASS = 'dsh-agnes-primary'
    const PRIMARY_FILL = '#ff7700'
    const PRIMARY_FILL_HOVER = '#e86b00'
    const PRIMARY_FILL_ACTIVE = '#d96100'
    const PRIMARY_INK = '#1f1300'
    const PRIMARY_CSS = [
      `.${PRIMARY_CLASS}:hover:not(:disabled){background:${PRIMARY_FILL_HOVER}!important}`,
      `.${PRIMARY_CLASS}:active:not(:disabled){background:${PRIMARY_FILL_ACTIVE}!important}`,
      `.${PRIMARY_CLASS}:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid ${PRIMARY_FILL};outline-offset:2px}`,
    ].join('\n')
    // Progress bars for running jobs. The image API has no progress channel, so
    // its bar is indeterminate (sliding segment); the video API reports a real
    // percentage, so its bar is a plain width transition.
    const BAR_CLASS = 'dsh-agnes-bar'
    const BAR_CSS = [
      `.${BAR_CLASS}{position:relative;flex:1 1 auto;min-width:120px;height:6px;border-radius:999px;background:var(--dsw-alias-bg-layer-2,rgba(127,127,127,.28));overflow:hidden}`,
      `.${BAR_CLASS}>i{display:block;height:100%;border-radius:999px;background:${PRIMARY_FILL};transition:width .45s ease}`,
      `.${BAR_CLASS}.is-indeterminate>i{width:38%;animation:dsh-agnes-bar-slide 1.4s ease-in-out infinite}`,
      '@keyframes dsh-agnes-bar-slide{0%{margin-left:-38%}100%{margin-left:100%}}',
      `@media (prefers-reduced-motion:reduce){.${BAR_CLASS}.is-indeterminate>i{animation:none;width:100%;opacity:.55}}`,
    ].join('\n')
    // Motion layer: switching a tab (or the library's images/videos switch) slides
    // the new body in from the side it came from — right when moving forward through
    // the tabs, left when moving back — on a decelerating curve. A card expands by
    // animating its grid row from 0fr to 1fr (no height measurement, no layout
    // thrash), and the active-tab pill rides the same curve so the highlight and the
    // body travel together. All pure CSS, so the reduced-motion opt-out is a real
    // media query rather than a JS guess.
    //
    // The slide deliberately animates transform ONLY. Starting from opacity 0 made
    // the tall generation tabs flash the bare panel background for the first ~100ms
    // (the body is remounted, so there is nothing opaque under it) — that dark blink
    // is what made switching feel disjointed. Fully opaque from the first frame, the
    // offset alone carries the motion.
    const SLIDE_CLASS = 'dsh-agnes-slide'
    const PILL_CLASS = 'dsh-agnes-pill'
    const SLIDE_MS = 450
    const SLIDE_EASE = 'cubic-bezier(.16,1,.3,1)'
    const SLIDE_DISTANCE = 40
    const EXPAND_CLASS = 'dsh-agnes-expand'
    // The media frame is the double-click target, so hovering it says "this opens":
    // a 3% lift plus an orange ring, with the transition dropped (not the state)
    // when the system asks for reduced motion.
    const MEDIA_CLASS = 'dsh-agnes-media'
    const MOTION_CSS = [
      `.${SLIDE_CLASS}{animation:dsh-agnes-slide-in ${SLIDE_MS}ms ${SLIDE_EASE} both}`,
      `.${SLIDE_CLASS}.is-left{animation-name:dsh-agnes-slide-in-left}`,
      `@keyframes dsh-agnes-slide-in{from{transform:translateX(${SLIDE_DISTANCE}px)}to{transform:none}}`,
      `@keyframes dsh-agnes-slide-in-left{from{transform:translateX(-${SLIDE_DISTANCE}px)}to{transform:none}}`,
      `.${PILL_CLASS}{transition:transform ${SLIDE_MS}ms ${SLIDE_EASE}}`,
      `.${EXPAND_CLASS}{display:grid;grid-template-rows:0fr;transition:grid-template-rows .2s ease}`,
      `.${EXPAND_CLASS}.is-open{grid-template-rows:1fr}`,
      `.${EXPAND_CLASS}>div{overflow:hidden;min-height:0}`,
      `.${MEDIA_CLASS}{transition:transform .16s ease,box-shadow .16s ease}`,
      `.${MEDIA_CLASS}:hover{transform:scale(1.03);box-shadow:0 0 0 2px ${PRIMARY_FILL}}`,
      `@media (prefers-reduced-motion:reduce){.${SLIDE_CLASS},.${SLIDE_CLASS}.is-left{animation:none}.${PILL_CLASS}{transition:none}.${EXPAND_CLASS}{transition:none}.${MEDIA_CLASS}{transition:none}}`,
    ].join('\n')
    const PLUGIN_CSS = `${PRIMARY_CSS}\n${BAR_CSS}\n${MOTION_CSS}`
    // How long a reported percentage may sit unchanged before the bar says so:
    // three or more polls at the video API's ~4s cadence.
    const VIDEO_STALL_MS = 12000
    const elapsedOf = (startedAt) => (startedAt ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0)
    // Tab order drives both the slide direction (forward = enter from the right)
    // and the pill's position.
    const TAB_ORDER = ['generate', 'video', 'library', 'settings']
    const ensurePrimaryStyles = () => {
      if (typeof document === 'undefined' || !document.head) return () => {}
      const tagId = `${NS}/button.css`
      if (document.querySelector(`style[data-plugin-css="${tagId}"]`)) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = NS
      tag.dataset.pluginCss = tagId
      tag.textContent = PLUGIN_CSS
      document.head.appendChild(tag)
      return () => tag.remove()
    }

    const DICT = {
      zh: {
        'entry.label': 'Agnes 生图/视频',
        'title': 'Agnes 生图 / 视频',
        'tab.generate': '图片生成',
        'tab.library': '库',
        'tab.settings': '设置',
        'key.ok': '密钥已就绪',
        'key.missing': '未配置密钥',
        'key.source.panel': '面板',
        'key.source.config': '插件 Config',
        'key.source.env': '环境变量',
        'key.source.none': '无',
        'form.prompt': '提示词',
        'form.promptPlaceholder': '描述你想生成的画面…',
        'form.size': '尺寸档',
        'form.ratio': '比例',
        'form.count': '张数',
        'form.refs': '参考图（可选，每行一个 URL 或 data:image/...;base64）',
        'form.refsShow': '添加参考图',
        'form.refsHide': '收起参考图',
        'form.submit': '生成',
        'form.generating': '生成中…',
        'progress.image': '生成中（通常 10–60 秒）',
        'progress.elapsed': '已用 {seconds} 秒',
        'progress.upstreamStall': '上游只报到 {progress}%，仍在渲染 · 已用 {seconds} 秒',
        'form.hint': '1K–4K 输出当前免费，通常 10–60 秒。',
        'optimize.button': 'AI 优化',
        'optimize.busy': '优化中…',
        'optimize.result': '优化后提示词',
        'optimize.apply': '采用',
        'optimize.retry': '重试',
        'optimize.discard': '放弃',
        'optimize.backend': '优化模型',
        'optimize.backend.agnes': 'Agnes 3.0 Flash',
        'optimize.backend.dsh': 'DSH 当前模型',
        'optimize.backend.dshUnavailable': 'DSH 当前模型（不可用）',
        'optimize.empty': '请先输入提示词。',
        'optimize.done': '已采用优化后的提示词。',
        'optimize.failed': '优化失败：{message}',
        'optimize.agnesHint': 'Agnes 文本模型，当前免费。',
        'optimize.dshHint': '走本 profile 已配置的模型，不额外计费。',
        'result.title': '本次结果',
        'action.insert': '插入到输入框',
        'action.copy': '复制路径',
        'action.delete': '删除',
        'action.refresh': '刷新',
        'action.save': '保存',
        'action.saving': '保存中…',
        'action.clearKey': '清除面板密钥',
        'gallery.empty': '还没有生成记录。',
        'gallery.count': '共 {n} 张',
        'library.images': '图片库',
        'library.videos': '视频库',
        'card.expand': '展开',
        'card.collapse': '收起',
        'card.open': '用默认程序打开',
        'card.reveal': '在文件夹中显示',
        'hint.noKey': '未配置 API Key：请到「设置」页填写并保存后再生成。',
        'settings.key': 'API Key（保存在本机插件数据目录，插件本身不内置密钥）',
        'settings.keyPlaceholder': '留空则不修改',
        'settings.model': '模型',
        'settings.defaults': '默认尺寸 / 比例',
        'settings.outputDir': '输出目录（留空 = 当前会话工作区）',
        'settings.current': '当前密钥来源：{source} {hint}',
        'settings.dataDir': '数据目录：{dir}',
        'notice.done': '生成完成，已保存到工作区。',
        'notice.inserted': '已插入输入框，检查后发送即可。',
        'notice.copied': '路径已复制。',
        'notice.saved': '设置已保存。',
        'notice.opened': '已交给系统默认程序打开。',
        'notice.revealed': '已在文件管理器中显示。',
        'error.emptyPrompt': '请先填写提示词。',
        'error.open': '打开失败：{message}',
        'error.noSession': '当前没有打开的会话，无法插入。',
        'error.insert': '插入失败：会话输入框不可用。',
        'error.load': '无法读取插件状态。',
        'tab.video': '视频生成',
        'video.mode': '生成模式',
        'video.mode.text': '文生视频',
        'video.mode.keyframe': '首尾帧',
        'video.mode.reference': '参考素材',
        'video.seconds': '时长（4–12 秒）',
        'video.aspect': '画幅',
        'video.size': '分辨率',
        'video.firstFrame': '首帧图片（本地路径或 URL，可留空）',
        'video.lastFrame': '尾帧图片（本地路径或 URL，可留空）',
        'video.images': '参考图片（每行一个本地路径或 URL，最多 {n} 张）',
        'video.audios': '参考音频（每行一个本地路径或 URL，最多 {n} 段，2–12 秒）',
        'video.submit': '生成视频',
        'video.generating': '提交中…',
        'video.queued': '任务已排队，视频生成通常需要 1–3 分钟。',
        'video.rendering': '渲染中：{status} · {progress}%',
        'video.done': '视频已生成并保存到工作区。',
        'video.failed': '视频生成失败。',
        'video.current': '当前任务',
        'video.historyCount': '视频历史（共 {n} 个）',
        'video.empty': '还没有生成过视频。',
        'video.noPlayer': '视频不在插件内播放：双击封面，或用默认播放器打开。',
        'video.noCover': '暂无封面（双击可用默认播放器打开）',
        'video.hint': '免费视频队列偶尔繁忙或限流，插件会自动重试；本地图片会自动内联发送。',
      },
      en: {
        'entry.label': 'Agnes Image/Video',
        'title': 'Agnes Image / Video',
        'tab.generate': 'Images',
        'tab.library': 'Library',
        'tab.settings': 'Settings',
        'key.ok': 'Key ready',
        'key.missing': 'No key',
        'key.source.panel': 'panel',
        'key.source.config': 'plugin Config',
        'key.source.env': 'env var',
        'key.source.none': 'none',
        'form.prompt': 'Prompt',
        'form.promptPlaceholder': 'Describe the image you want…',
        'form.size': 'Size',
        'form.ratio': 'Ratio',
        'form.count': 'Count',
        'form.refs': 'Reference images (optional, one per line: URL or data:image/...;base64)',
        'form.refsShow': 'Add reference images',
        'form.refsHide': 'Hide reference images',
        'form.submit': 'Generate',
        'form.generating': 'Generating…',
        'progress.image': 'Generating (usually 10–60s)',
        'progress.elapsed': 'elapsed {seconds}s',
        'progress.upstreamStall': 'Upstream still reports {progress}% — rendering · {seconds}s elapsed',
        'form.hint': '1K–4K output is currently free; usually 10–60s.',
        'optimize.button': 'AI optimize',
        'optimize.busy': 'Optimizing…',
        'optimize.result': 'Optimized',
        'optimize.apply': 'Use it',
        'optimize.retry': 'Try again',
        'optimize.discard': 'Discard',
        'optimize.backend': 'Optimizer model',
        'optimize.backend.agnes': 'Agnes 3.0 Flash',
        'optimize.backend.dsh': 'DSH current model',
        'optimize.backend.dshUnavailable': 'DSH current model (unavailable)',
        'optimize.empty': 'Write a prompt first.',
        'optimize.done': 'Optimized prompt applied.',
        'optimize.failed': 'Optimize failed: {message}',
        'optimize.agnesHint': 'Agnes text model, currently free.',
        'optimize.dshHint': 'Uses the model this profile is already configured with.',
        'result.title': 'This run',
        'action.insert': 'Insert into composer',
        'action.copy': 'Copy path',
        'action.delete': 'Delete',
        'action.refresh': 'Refresh',
        'action.save': 'Save',
        'action.saving': 'Saving…',
        'action.clearKey': 'Clear panel key',
        'gallery.empty': 'Nothing generated yet.',
        'gallery.count': '{n} image(s)',
        'library.images': 'Images',
        'library.videos': 'Videos',
        'card.expand': 'Expand',
        'card.collapse': 'Collapse',
        'card.open': 'Open with default app',
        'card.reveal': 'Show in folder',
        'hint.noKey': 'No API key yet — open Settings, save one, then generate.',
        'settings.key': "API Key (stored in this plugin's local data dir; the plugin ships without one)",
        'settings.keyPlaceholder': 'leave blank to keep',
        'settings.model': 'Model',
        'settings.defaults': 'Default size / ratio',
        'settings.outputDir': 'Output directory (blank = session workspace)',
        'settings.current': 'Active key source: {source} {hint}',
        'settings.dataDir': 'Data directory: {dir}',
        'notice.done': 'Done — saved into the workspace.',
        'notice.inserted': 'Inserted into the composer; review and send.',
        'notice.copied': 'Path copied.',
        'notice.saved': 'Settings saved.',
        'notice.opened': 'Handed to the system default app.',
        'notice.revealed': 'Shown in the file manager.',
        'error.emptyPrompt': 'Enter a prompt first.',
        'error.open': 'Open failed: {message}',
        'error.noSession': 'No open session to insert into.',
        'error.insert': 'Insert failed: the composer is unavailable.',
        'error.load': 'Could not read plugin status.',
        'tab.video': 'Videos',
        'video.mode': 'Mode',
        'video.mode.text': 'Text to video',
        'video.mode.keyframe': 'Keyframes',
        'video.mode.reference': 'References',
        'video.seconds': 'Seconds (4–12)',
        'video.aspect': 'Aspect ratio',
        'video.size': 'Resolution',
        'video.firstFrame': 'First frame (local path or URL, optional)',
        'video.lastFrame': 'Last frame (local path or URL, optional)',
        'video.images': 'Reference images (one local path or URL per line, up to {n})',
        'video.audios': 'Reference audio (one local path or URL per line, up to {n}, 2–12s each)',
        'video.submit': 'Generate video',
        'video.generating': 'Submitting…',
        'video.queued': 'Job queued; rendering usually takes 1–3 minutes.',
        'video.rendering': 'Rendering: {status} · {progress}%',
        'video.done': 'Video generated and saved into the workspace.',
        'video.failed': 'Video generation failed.',
        'video.current': 'Current job',
        'video.historyCount': 'Videos ({n})',
        'video.empty': 'No videos yet.',
        'video.noPlayer': 'Videos do not play inside the panel: double-click the cover, or open the file with the default player.',
        'video.noCover': 'No cover yet (double-click to open with the default player)',
        'video.hint': 'The free video queue is sometimes busy or rate-limited; retries are automatic. Local images are inlined automatically.',
      },
    }

    // Replaced by the bound locale translator in apply(); this fallback keeps
    // the panel readable in English even if locale registration fails.
    let tt = (key) => DICT.en[key] ?? key

    // ------------------------------------------------------------- host API --
    // Document-relative on purpose: the GUI runs under <base href="./"> and may
    // be deployed below a path prefix, where a root-absolute /api/... escapes it.
    const url = (relative) => new URL(relative, document.baseURI).toString()

    async function request(relative, init) {
      const response = await fetch(url(relative), init)
      const payload = await response.json().catch(() => null)
      if (!response.ok || !payload || payload.ok === false) {
        throw new Error(payload?.error ?? `HTTP ${response.status}`)
      }
      return payload
    }

    const json = (body) => ({
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    })

    const api = {
      status: () => request('api/agnes-image/status'),
      history: (limit) => request(`api/agnes-image/history?limit=${limit}`),
      generate: (body) => request('api/agnes-image/generate', json(body)),
      settings: (body) => request('api/agnes-image/settings', json(body)),
      remove: (body) => request('api/agnes-image/delete', json(body)),
      // Video is a two-step flow: create returns a videoId, then the panel polls
      // videoStatus until the host has downloaded and saved the MP4.
      videoCreate: (body) => request('api/agnes-image/video-create', json(body)),
      videoStatus: (videoId) =>
        request(`api/agnes-image/video-status?videoId=${encodeURIComponent(videoId)}`),
      videoHistory: (limit) => request(`api/agnes-image/video-history?limit=${limit}`),
      videoRemove: (body) => request('api/agnes-image/video-delete', json(body)),
      // One shared rewriter for both prompt boxes; the host owns the backend
      // choice (agnes text model or the harness' own model).
      optimize: (body) => request('api/agnes-image/optimize', json(body)),
      // Hand a recorded file to the desktop: 'default' opens the file-type
      // association, 'reveal' selects it in the file manager.
      open: (body) => request('api/agnes-image/open', json(body)),
      // Store the poster frame the browser captured for a recorded video. The
      // host writes it next to the MP4 and keeps its path in the history entry.
      cover: (body) => request('api/agnes-image/video-cover', json(body)),
    }

    const lines = (text) =>
      String(text ?? '')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '')

    /** The core file route serves any absolute path the host can read. */
    function fileUrl(absolutePath) {
      const target = new URL('api/file', document.baseURI)
      target.searchParams.set('path', absolutePath)
      return target.toString()
    }

    /**
     * Capture a poster frame from a finished MP4 in the browser (this machine has
     * no ffmpeg, so the host cannot do it): seek a detached <video> a fifth of a
     * second in, draw it on a canvas and return a PNG data URL. Any failure —
     * unsupported codec, timeout, tainted canvas — resolves to '' and the card
     * falls back to the frame the browser paints for the video element.
     */
    function grabFrame(url, timeoutMs = 8000) {
      return new Promise((resolve) => {
        const video = document.createElement('video')
        let settled = false
        const finish = (value) => {
          if (settled) return
          settled = true
          window.clearTimeout(timer)
          video.removeAttribute('src')
          video.load()
          resolve(value)
        }
        const timer = window.setTimeout(() => finish(''), timeoutMs)
        video.muted = true
        video.playsInline = true
        video.preload = 'auto'
        video.addEventListener('error', () => finish(''))
        video.addEventListener('loadeddata', () => {
          try {
            video.currentTime = Math.min(0.2, (Number(video.duration) || 1) / 2)
          } catch (error) {
            finish('')
          }
        })
        video.addEventListener('seeked', () => {
          try {
            const width = Number(video.videoWidth) || 0
            const height = Number(video.videoHeight) || 0
            if (!width || !height) return finish('')
            const canvas = document.createElement('canvas')
            canvas.width = Math.min(width, 640)
            canvas.height = Math.max(1, Math.round((height / width) * canvas.width))
            canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height)
            finish(canvas.toDataURL('image/png'))
          } catch (error) {
            finish('')
          }
        })
        video.src = url
        video.load()
      })
    }

    // ------------------------------------------------------- session bridge --
    function currentSession(ctx) {
      try {
        const workspace = ctx.get?.('uiWorkspace') ?? ctx.uiWorkspace
        const selection = workspace?.selection?.getSnapshot?.()
        const sessionId = selection?.sessionId ?? workspace?.mainReference?.sessionId
        if (!sessionId) return { sessionId: '', cwd: '' }
        const byId = ctx.get?.('sessions')?.list?.getSnapshot?.()?.byId
        const cwd = byId?.[sessionId]?.cwd
        return { sessionId, cwd: typeof cwd === 'string' ? cwd : '' }
      } catch (error) {
        console.warn('[agnes-image] session lookup failed:', error)
        return { sessionId: '', cwd: '' }
      }
    }

    /**
     * Plain-text draft insertion (no image-attachment API exists). Returns an
     * error key or '' on success.
     */
    function insertIntoDraft(ctx, sessionId, text) {
      try {
        const sessions = ctx.get?.('sessions') ?? ctx.sessions
        const actx = sessions?.scope?.(sessionId)
        if (!actx) return 'error.noSession'
        const conversation = ctx.get?.('conversation') ?? ctx.conversation
        if (!conversation?.input?.for) return 'error.insert'
        const input = conversation.input.for(actx)
        const draft = input.state.getSnapshot().draft ?? ''
        input.setDraft(draft === '' ? text : `${draft}\n${text}`)
        return ''
      } catch (error) {
        console.warn('[agnes-image] draft insert failed:', error)
        return 'error.insert'
      }
    }

    async function copyText(text) {
      try {
        await navigator.clipboard.writeText(text)
        return true
      } catch {
        try {
          const scratch = document.createElement('textarea')
          scratch.value = text
          scratch.setAttribute('readonly', 'readonly')
          scratch.style.position = 'fixed'
          scratch.style.opacity = '0'
          document.body.appendChild(scratch)
          scratch.select()
          const ok = document.execCommand('copy')
          document.body.removeChild(scratch)
          return ok
        } catch {
          return false
        }
      }
    }

    // ---------------------------------------------------------------- style --
    // The sliding highlight used by the tab strip and the library's images/videos
    // switch. Both are equal-column flex rows with a fixed gap inside a padded,
    // rounded container, so the pill's width and offset can be expressed exactly in
    // CSS (no measuring, no ResizeObserver: it stays right when the sidebar is
    // resized). translateX percentages resolve against the pill's own width, which
    // is why the step is `100% + gap` per column.
    const pillStyle = (index, count, gap, inset) => ({
      position: 'absolute',
      top: `${inset}px`,
      bottom: `${inset}px`,
      left: `${inset}px`,
      width: `calc((100% - ${2 * inset + (count - 1) * gap}px) / ${count})`,
      transform: `translateX(calc(${index * 100}% + ${index * gap}px))`,
      borderRadius: '6px',
      background: 'var(--dsw-alias-bg-layer-3)',
      // The stroke rides along with the pill, so it lands on the new tab at the
      // same time the body does.
      boxShadow: `inset 0 0 0 1px ${PRIMARY_FILL}`,
      pointerEvents: 'none',
    })
    const S = {
      root: {
        height: '100%',
        overflowY: 'auto',
        // The tab body slides in from off to the side, so clip that temporary
        // horizontal overflow here instead of letting it grow a scrollbar.
        overflowX: 'hidden',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        fontSize: '13px',
        lineHeight: '1.5',
      },
      inner: { padding: '12px 14px 24px', display: 'flex', flexDirection: 'column', gap: '12px' },
      header: { display: 'flex', alignItems: 'center', gap: '8px' },
      title: { fontSize: '15px', fontWeight: '600' },
      grow: { flex: '1 1 auto' },
      pill: (ok) => ({
        fontSize: '11px',
        padding: '2px 8px',
        borderRadius: '999px',
        border: `1px solid ${ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)'}`,
        color: ok ? 'var(--dsw-alias-state-success-primary)' : 'var(--dsw-alias-state-warn-primary)',
        whiteSpace: 'nowrap',
      }),
      tabs: {
        position: 'relative',
        display: 'flex',
        gap: '4px',
        padding: '3px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      tab: (active) => ({
        position: 'relative',
        zIndex: 1,
        // Equal columns keep the sliding pill's calc()-derived width exact:
        // flex-basis 0 + grow 1 would otherwise stop at each label's min-content
        // width, so 库 would be narrower than 图片生成 and the pill would drift.
        flex: '1 1 0',
        minWidth: '0',
        padding: '5px 10px',
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
      }),
      card: {
        display: 'flex',
        flexDirection: 'column',
        gap: '8px',
        padding: '10px',
        borderRadius: '10px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-layer-1)',
        minWidth: '0',
      },
      label: { fontSize: '12px', color: 'var(--dsw-alias-label-secondary)' },
      // The frame is the double-click target: it turns the file over to the
      // desktop default app, so it is sized like a thumbnail, not like a viewer.
      cardMedia: { display: 'flex', justifyContent: 'center', cursor: 'pointer', borderRadius: '8px' },
      frameImage: {
        width: '96px',
        height: '96px',
        objectFit: 'cover',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2)',
        display: 'block',
      },
      frameVideo: {
        width: '160px',
        height: '90px',
        objectFit: 'cover',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2)',
        display: 'block',
      },
      coverFallback: {
        width: '160px',
        height: '90px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '6px',
        textAlign: 'center',
      },
      cardRow: { display: 'flex', alignItems: 'center', gap: '8px', minWidth: '0' },
      cardName: {
        flex: '1 1 auto',
        minWidth: '0',
        padding: '0',
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        fontWeight: '600',
        textAlign: 'left',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
        cursor: 'pointer',
      },
      actions: { display: 'flex', gap: '10px', flexWrap: 'wrap' },
      // Segmented switch used inside the library tab (images | videos).
      segmented: {
        position: 'relative',
        display: 'flex',
        gap: '3px',
        padding: '3px',
        borderRadius: '8px',
        background: 'var(--dsw-alias-bg-layer-2)',
      },
      segment: (active) => ({
        position: 'relative',
        zIndex: 1,
        // Equal columns: the sliding pill's width is computed from this layout.
        flex: '1 1 0',
        minWidth: '78px',
        padding: '4px 12px',
        borderRadius: '6px',
        border: 'none',
        cursor: 'pointer',
        font: 'inherit',
        color: active ? 'var(--dsw-alias-label-primary)' : 'var(--dsw-alias-label-secondary)',
        background: 'transparent',
      }),
      textarea: {
        width: '100%',
        minHeight: '74px',
        resize: 'vertical',
        boxSizing: 'border-box',
        padding: '8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        outline: 'none',
      },
      input: {
        width: '100%',
        boxSizing: 'border-box',
        padding: '6px 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
        outline: 'none',
      },
      select: {
        width: '100%',
        padding: '6px 8px',
        borderRadius: '8px',
        border: '1px solid var(--dsw-alias-border-l2)',
        background: 'var(--dsw-alias-bg-base)',
        color: 'var(--dsw-alias-label-primary)',
        font: 'inherit',
      },
      row: { display: 'flex', gap: '8px' },
      col: { flex: '1 1 0', display: 'flex', flexDirection: 'column', gap: '4px', minWidth: '0' },
      // Filled buttons must use an on-primary foreground: pairing the fill with
      // --dsw-alias-label-primary renders invisible text in the dark theme. The
      // fill is the user-picked CTA orange (#ff7700) with dark ink for contrast
      // (~8:1); hover/active come from the injected .dsh-agnes-primary rules.
      button: (primary, disabled) => ({
        padding: '7px 14px',
        borderRadius: '8px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        font: 'inherit',
        opacity: disabled ? '0.55' : '1',
        transition: 'background-color .12s',
        border: primary ? '1px solid transparent' : '1px solid var(--dsw-alias-border-l2)',
        background: primary ? PRIMARY_FILL : 'var(--dsw-alias-bg-layer-2)',
        color: primary ? PRIMARY_INK : 'var(--dsw-alias-label-secondary)',
      }),
      link: {
        border: 'none',
        background: 'transparent',
        color: 'var(--dsw-alias-label-secondary)',
        cursor: 'pointer',
        font: 'inherit',
        fontSize: '12px',
        padding: '2px 0',
        textAlign: 'left',
      },
      banner: (kind) => ({
        padding: '7px 10px',
        borderRadius: '8px',
        fontSize: '12px',
        border: `1px solid ${kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-state-business-primary)'}`,
        color: kind === 'error' ? 'var(--dsw-alias-state-error-primary)' : 'var(--dsw-alias-label-secondary)',
        background: 'var(--dsw-alias-bg-layer-1)',
        wordBreak: 'break-word',
      }),
      grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(116px, 1fr))',
        gap: '10px',
      },
      // Video cards carry a 160x90 frame, so their grid stays a little wider.
      gridWide: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(182px, 1fr))',
        gap: '10px',
      },
      cardTitle: { fontSize: '12px', wordBreak: 'break-word', color: 'var(--dsw-alias-label-secondary)' },
      mono: {
        fontFamily: 'var(--dsw-font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)',
        fontSize: '11px',
        color: 'var(--dsw-alias-label-tertiary)',
        wordBreak: 'break-all',
      },
    }

    // ----------------------------------------------------------- components --
    function PanelIcon(props) {
      const size = props?.size ?? 18
      return h(
        'svg',
        {
          width: size,
          height: size,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 1.4,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
          'aria-hidden': 'true',
        },
        h('rect', { x: 3, y: 4.5, width: 18, height: 15, rx: 2.5 }),
        h('circle', { cx: 8.5, cy: 10, r: 1.6 }),
        h('path', { d: 'M4 17.5l4.6-4.2a1.6 1.6 0 0 1 2.2.05L13 15.5' }),
        h('path', { d: 'M19 2.2l.55 1.45L21 4.2l-1.45.55L19 6.2l-.55-1.45L17 4.2l1.45-.55z' }),
      )
    }

    /** Filename of a history record; `name` is already a basename server-side. */
    function fileNameOf(record) {
      return record?.name || String(record?.file ?? '').split(/[\\/]/).pop() || ''
    }

    /**
     * Shared card chrome: a media frame on top, the filename underneath and the
     * expand toggle next to it. The frame is the only double-click target — that
     * hands the file to the desktop default app, exactly like double-clicking it
     * in a folder window — while the filename and the toggle only expand or
     * collapse. The card is collapsed by default, but it keeps its frame so the
     * entry is recognisable at a glance.
     */
    function CardShell(props) {
      const toggle = () => props.onToggle(!props.expanded)
      const boxRef = useRef(null)
      // The actions stay mounted (that is what gives the row a height to grow into)
      // but `inert` keeps the hidden buttons out of the tab order while collapsed.
      // It is set through the DOM so this works the same on React 18 and 19.
      useEffect(() => {
        const node = boxRef.current
        if (!node) return
        if (props.expanded) node.removeAttribute('inert')
        else node.setAttribute('inert', '')
      }, [props.expanded])
      return h(
        'div',
        { style: { ...S.card, gap: '0px' } },
        h(
          'div',
          { className: MEDIA_CLASS, style: S.cardMedia, title: tt('card.open'), onDoubleClick: () => props.onOpen() },
          props.media,
        ),
        h(
          'div',
          { style: { ...S.cardRow, marginTop: '8px' } },
          h('button', { type: 'button', style: S.cardName, title: props.title, onClick: toggle }, props.title),
          h(
            'button',
            { type: 'button', style: S.link, onClick: toggle },
            props.expanded ? tt('card.collapse') : tt('card.expand'),
          ),
        ),
        // The actions stay mounted (that is what gives the row a height to grow
        // into) and `inert` keeps the hidden buttons out of the tab order while
        // the card is collapsed.
        h(
          'div',
          {
            ref: boxRef,
            className: props.expanded ? `${EXPAND_CLASS} is-open` : EXPAND_CLASS,
          },
          h('div', null, h('div', { style: { paddingTop: '8px' } }, props.actions)),
        ),
      )
    }

    function ImageCard(props) {
      const image = props.image
      const onInsert = props.onInsert
      const onCopy = props.onCopy
      const onDelete = props.onDelete
      const onOpen = props.onOpen ?? (() => {})
      const [expanded, setExpanded] = useState(false)
      return h(CardShell, {
        title: fileNameOf(image),
        expanded,
        onToggle: setExpanded,
        onOpen: () => onOpen(image.file, 'default'),
        media: h('img', {
          src: fileUrl(image.file),
          alt: image.prompt ?? image.name,
          style: S.frameImage,
          loading: 'lazy',
        }),
        actions: h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { style: S.cardTitle }, image.prompt ?? ''),
          h(
            'div',
            { style: S.actions },
            h('button', { type: 'button', style: S.link, onClick: () => onInsert(image) }, tt('action.insert')),
            h('button', { type: 'button', style: S.link, onClick: () => onCopy(image.file) }, tt('action.copy')),
            h('button', { type: 'button', style: S.link, onClick: () => onOpen(image.file, 'default') }, tt('card.open')),
            h('button', { type: 'button', style: S.link, onClick: () => onOpen(image.file, 'reveal') }, tt('card.reveal')),
            onDelete
              ? h('button', { type: 'button', style: S.link, onClick: () => onDelete(image) }, tt('action.delete'))
              : null,
          ),
        ),
      })
    }

    /**
     * Videos never play inside the panel: the card shows the poster frame the
     * host stored at generation time, or — until that exists — the still first
     * frame of a controls-less <video>. Double-clicking the frame opens the file
     * in the system default player.
     */
    function VideoCard(props) {
      const video = props.video
      const onInsert = props.onInsert
      const onCopy = props.onCopy
      const onDelete = props.onDelete
      const onOpen = props.onOpen ?? (() => {})
      const [broken, setBroken] = useState(false)
      const [expanded, setExpanded] = useState(false)
      const megabytes =
        Number(video.bytes) > 0 ? `${(Number(video.bytes) / (1024 * 1024)).toFixed(1)} MB` : ''
      const cover = typeof video.cover === 'string' && video.cover !== '' ? video.cover : ''
      const media = cover
        ? h('img', { src: fileUrl(cover), alt: video.prompt ?? video.name, style: S.frameVideo, loading: 'lazy' })
        : broken
          ? h('div', { style: S.coverFallback }, h('span', { style: S.label }, tt('video.noCover')))
          : h('video', {
              src: fileUrl(video.file),
              preload: 'metadata',
              muted: true,
              playsInline: true,
              onError: () => setBroken(true),
              style: S.frameVideo,
            })
      return h(CardShell, {
        title: fileNameOf(video),
        expanded,
        onToggle: setExpanded,
        onOpen: () => onOpen(video.file, 'default'),
        media,
        actions: h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
          h('div', { style: S.cardTitle }, video.prompt ?? ''),
          h('div', { style: S.mono }, video.file),
          h(
            'div',
            { style: S.mono },
            [video.seconds ? `${video.seconds}s` : '', video.size, video.aspectRatio, megabytes]
              .filter(Boolean)
              .join(' · '),
          ),
          h('div', { style: S.mono }, tt('video.noPlayer')),
          h(
            'div',
            { style: S.actions },
            onInsert
              ? h('button', { type: 'button', style: S.link, onClick: () => onInsert(video) }, tt('action.insert'))
              : null,
            onCopy
              ? h('button', { type: 'button', style: S.link, onClick: () => onCopy(video.file) }, tt('action.copy'))
              : null,
            h('button', { type: 'button', style: S.link, onClick: () => onOpen(video.file, 'default') }, tt('card.open')),
            h('button', { type: 'button', style: S.link, onClick: () => onOpen(video.file, 'reveal') }, tt('card.reveal')),
            onDelete
              ? h('button', { type: 'button', style: S.link, onClick: () => onDelete(video) }, tt('action.delete'))
              : null,
          ),
        ),
      })
    }

    /**
     * Progress row for a running job. `percent` of null means the upstream gives
     * no progress at all (image generation), so the bar slides instead of filling.
     * `stalled` means the upstream DOES report a number but has not moved it for a
     * while (its video API only knows 0 → 10 → 70 → 100 and the 10 leg lasts
     * minutes): the bar slides again and `note` explains where the number comes
     * from, so a real value is shown without pretending it is advancing.
     */
    function ProgressBar(props) {
      const indeterminate = props.percent == null || !Number.isFinite(Number(props.percent))
      const stalled = !indeterminate && props.stalled === true
      const moving = indeterminate || stalled
      const percent = indeterminate ? 0 : Math.max(0, Math.min(100, Number(props.percent)))
      const caption = props.note
        ? props.note
        : props.label
          ? `${props.label} · ${tt('progress.elapsed').replace('{seconds}', String(props.elapsed ?? 0))}`
          : tt('progress.elapsed').replace('{seconds}', String(props.elapsed ?? 0))
      return h(
        'div',
        { style: { display: 'flex', flexDirection: 'column', gap: '6px' } },
        h(
          'div',
          {
            className: moving ? `${BAR_CLASS} is-indeterminate` : BAR_CLASS,
            style: { minWidth: '160px' },
            role: 'progressbar',
            'aria-label': props.label ?? '',
            ...(indeterminate ? {} : { 'aria-valuenow': percent, 'aria-valuemin': 0, 'aria-valuemax': 100 }),
          },
          h('i', { style: moving ? undefined : { width: `${percent}%` } }),
        ),
        h('span', { style: S.label }, caption),
      )
    }

    /**
     * Comparison card for the optimizer: original on top, rewrite below, and
     * nothing is written into the draft until "use it" is pressed.
     */
    function OptimizeCard(props) {
      const result = props.result
      if (!result) return null
      return h(
        'div',
        { style: S.card },
        // The card only shows what is NEW: the original is still in the prompt box above,
        // so there is no title and no echo of it here — just the rewritten prompt.
        h('div', { style: S.label }, tt('optimize.result')),
        h('textarea', {
          style: { ...S.textarea, minHeight: '96px' },
          readOnly: true,
          value: result.prompt,
          onFocus: (event) => event.target.select?.(),
        }),
        h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(
            'button',
            { type: 'button', className: PRIMARY_CLASS, style: S.button(true, false), onClick: props.onApply },
            tt('optimize.apply'),
          ),
          h('button', { type: 'button', style: S.button(false, false), onClick: props.onRetry }, tt('optimize.retry')),
          h('button', { type: 'button', style: S.link, onClick: props.onDiscard }, tt('optimize.discard')),
          h('span', { style: S.label }, result.model || ''),
        ),
        result.notes && result.notes.length > 0 ? h('div', { style: S.mono }, result.notes.join(' · ')) : null,
      )
    }

    function AgnesPanel(props) {
      const ctx = props.ctx
      const [tab, setTab] = useState('generate')
      // Which way the next body enters from: forward through the tabs slides in from
      // the right, backwards from the left.
      const [slideDir, setSlideDir] = useState('right')
      const [status, setStatus] = useState(null)
      const [prompt, setPrompt] = useState('')
      const [size, setSize] = useState('')
      const [ratio, setRatio] = useState('')
      const [count, setCount] = useState(1)
      const [references, setReferences] = useState('')
      const [showRefs, setShowRefs] = useState(false)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState('')
      const [notice, setNotice] = useState('')
      const [results, setResults] = useState([])
      const [history, setHistory] = useState([])
      const [keyInput, setKeyInput] = useState('')
      const [model, setModel] = useState('')
      const [defaultSize, setDefaultSize] = useState('')
      const [defaultRatio, setDefaultRatio] = useState('')
      const [outputDir, setOutputDir] = useState('')
      const [saving, setSaving] = useState(false)
      const [galleryLoading, setGalleryLoading] = useState(false)
      const [videoPrompt, setVideoPrompt] = useState('')
      const [videoMode, setVideoMode] = useState('text')
      const [videoSeconds, setVideoSeconds] = useState('')
      const [videoAspect, setVideoAspect] = useState('')
      const [videoSize, setVideoSize] = useState('')
      const [videoFirstFrame, setVideoFirstFrame] = useState('')
      const [videoLastFrame, setVideoLastFrame] = useState('')
      const [videoImages, setVideoImages] = useState('')
      const [videoAudios, setVideoAudios] = useState('')
      const [videoBusy, setVideoBusy] = useState(false)
      const [videoTask, setVideoTask] = useState(null)
      const [videoHistory, setVideoHistory] = useState([])
      // Which collection the library tab shows: images or videos.
      const [libraryKind, setLibraryKind] = useState('images')
      // Prompt optimizer: which backend, which box is running, and the pending
      // comparison card (nothing is written back until the user accepts).
      const [optimizeBackend, setOptimizeBackend] = useState('agnes')
      const [optimizeBusy, setOptimizeBusy] = useState('')
      const [optimizeResult, setOptimizeResult] = useState(null)
      // Elapsed-time readouts for the two progress bars (0 = no job running).
      const [imageStartedAt, setImageStartedAt] = useState(0)
      const [videoStartedAt, setVideoStartedAt] = useState(0)
      const [, setClock] = useState(0)
      const seeded = useRef(false)
      // When the upstream last changed its reported percentage. The video API only
      // knows 0 → 10 → 70 → 100, so "no movement for a while" is normal and the
      // bar switches from a filling width to a sliding one instead of looking dead.
      const progressStamp = useRef({ value: null, at: 0 })

      // This plugin ships without any credential, so nothing can run until the
      // user saves a key in the Settings tab. While the first status request is
      // still in flight (status === null) the CTAs stay enabled to avoid a flash
      // of disabled buttons.
      const missingKey = status !== null && status?.hasKey !== true

      // A 1s heartbeat keeps "已用 N 秒" counting while a job runs.
      const jobRunning =
        busy ||
        videoBusy ||
        (Boolean(videoTask?.videoId) && videoTask?.file === '' && videoTask?.status !== 'failed' && videoTask?.status !== 'error')
      useEffect(() => {
        if (!jobRunning) return undefined
        const timer = setInterval(() => setClock((value) => value + 1), 1000)
        return () => clearInterval(timer)
      }, [jobRunning])

      const applyStatus = useCallback((payload) => {
        setStatus(payload)
        setModel((prev) => (prev === '' ? payload.model ?? prev : prev))
        setDefaultSize((prev) => (prev === '' ? payload.size ?? prev : prev))
        setDefaultRatio((prev) => (prev === '' ? payload.ratio ?? prev : prev))
        setOutputDir((prev) => (prev === '' ? payload.outputDir ?? prev : prev))
        if (!seeded.current) {
          seeded.current = true
          setSize(payload.size ?? '')
          setRatio(payload.ratio ?? '')
          setVideoSeconds(String(payload.videoSeconds ?? '5'))
          setVideoAspect(payload.videoAspect ?? '16:9')
          setVideoSize(payload.videoSize ?? '720P')
          setOptimizeBackend(payload.optimizeBackend === 'dsh' ? 'dsh' : 'agnes')
        }
      }, [])

      const refreshStatus = useCallback(async () => {
        try {
          applyStatus(await api.status())
        } catch (cause) {
          setError(cause?.message ?? tt('error.load'))
        }
      }, [applyStatus])

      const refreshGallery = useCallback(async () => {
        setGalleryLoading(true)
        try {
          const payload = await api.history(120)
          setHistory(Array.isArray(payload.items) ? payload.items : [])
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        } finally {
          setGalleryLoading(false)
        }
      }, [])

      /**
       * Poster frame for a finished video: the browser grabs one frame, the host
       * stores it as a PNG next to the MP4 and records it in the history entry.
       * A file is only tried once per session and every failure is non-fatal —
       * the card then falls back to the frame the <video> element paints.
       */
      const coverTried = useRef(new Set())

      const captureCover = async (video) => {
        const file = String(video?.file ?? '')
        if (file === '' || video?.cover || coverTried.current.has(file)) return
        coverTried.current.add(file)
        try {
          const dataUrl = await grabFrame(fileUrl(file))
          if (!dataUrl) return
          const payload = await api.cover({ file, dataUrl })
          const cover = typeof payload?.cover === 'string' ? payload.cover : ''
          if (cover === '') return
          setVideoTask((prev) => (prev?.file === file ? { ...prev, cover } : prev))
          setVideoHistory((prev) => prev.map((item) => (item.file === file ? { ...item, cover } : item)))
        } catch (cause) {
          console.warn('[agnes-image] cover capture failed:', cause)
        }
      }

      const refreshVideoGallery = useCallback(async () => {
        try {
          const payload = await api.videoHistory(120)
          const items = Array.isArray(payload.items) ? payload.items : []
          setVideoHistory(items)
          // Backfill poster frames for the newest few videos recorded before the
          // cover route existed; each file is still only grabbed once.
          items
            .filter((item) => item?.file && !item.cover)
            .slice(0, 3)
            .forEach((item) => captureCover(item))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        }
      }, [])

      useEffect(() => {
        refreshStatus()
        refreshGallery()
        refreshVideoGallery()
      }, [refreshStatus, refreshGallery, refreshVideoGallery])

      const onGenerateVideo = async () => {
        const text = videoPrompt.trim()
        if (text === '') {
          setError(tt('error.emptyPrompt'))
          return
        }
        setVideoBusy(true)
        setError('')
        setNotice('')
        setVideoStartedAt(Date.now())
        progressStamp.current = { value: null, at: 0 }
        try {
          const session = currentSession(ctx)
          const payload = await api.videoCreate({
            prompt: text,
            mode: videoMode,
            seconds: videoSeconds || undefined,
            aspectRatio: videoAspect || undefined,
            size: videoSize || undefined,
            firstFrame: videoFirstFrame.trim() || undefined,
            lastFrame: videoLastFrame.trim() || undefined,
            images: lines(videoImages),
            audios: lines(videoAudios),
            sessionId: session.sessionId,
            cwd: session.cwd,
          })
          setVideoTask(payload.task ?? null)
          setNotice(tt('video.queued'))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
          setVideoStartedAt(0)
        } finally {
          setVideoBusy(false)
        }
      }

      /**
       * Poll the running job until the host has the MP4 on disk. The host saves
       * exactly once, so a repeated poll after `file` is set is a no-op.
       */
      useEffect(() => {
        const task = videoTask
        if (!task?.videoId || task.file || task.status === 'failed' || task.status === 'error') {
          return undefined
        }
        let cancelled = false
        let timer = null
        const tick = async () => {
          try {
            const payload = await api.videoStatus(task.videoId)
            if (cancelled) return
            const next = payload.task ?? null
            setVideoTask(next)
            const reported = Number.isFinite(Number(next?.progress)) ? Number(next.progress) : null
            if (progressStamp.current.value !== reported) {
              progressStamp.current = { value: reported, at: Date.now() }
            }
            if (next?.file) {
              setVideoHistory((prev) => [next, ...prev.filter((item) => item.videoId !== next.videoId)])
              setNotice(tt('video.done'))
              setVideoStartedAt(0)
              captureCover(next)
            } else if (next?.status === 'failed') {
              setError(next.error || tt('video.failed'))
              setVideoStartedAt(0)
            } else {
              timer = setTimeout(tick, 5000)
            }
          } catch (cause) {
            if (cancelled) return
            setError(cause?.message ?? String(cause))
            timer = setTimeout(tick, 10000)
          }
        }
        timer = setTimeout(tick, 4000)
        return () => {
          cancelled = true
          if (timer) clearTimeout(timer)
        }
      }, [videoTask])

      const onGenerate = async () => {
        const text = prompt.trim()
        if (text === '') {
          setError(tt('error.emptyPrompt'))
          return
        }
        setBusy(true)
        setError('')
        setNotice('')
        setImageStartedAt(Date.now())
        try {
          const session = currentSession(ctx)
          const payload = await api.generate({
            prompt: text,
            size: size || undefined,
            ratio: ratio || undefined,
            count,
            referenceImages: references
              .split('\n')
              .map((line) => line.trim())
              .filter((line) => line !== ''),
            sessionId: session.sessionId,
            cwd: session.cwd,
          })
          const images = Array.isArray(payload.images) ? payload.images : []
          setResults(images)
          setHistory((prev) => [...images, ...prev])
          setNotice(tt('notice.done'))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        } finally {
          setBusy(false)
          setImageStartedAt(0)
        }
      }

      const onInsert = (image) => {
        const session = currentSession(ctx)
        if (!session.sessionId) {
          setError(tt('error.noSession'))
          return
        }
        const failure = insertIntoDraft(ctx, session.sessionId, `![${image.name}](${image.file})`)
        if (failure) setError(tt(failure))
        else {
          setError('')
          setNotice(tt('notice.inserted'))
        }
      }

      const onCopy = async (text) => {
        setNotice((await copyText(text)) ? tt('notice.copied') : '')
      }

      const onDelete = async (image) => {
        try {
          await api.remove({ file: image.file })
          setHistory((prev) => prev.filter((item) => item.file !== image.file))
          setResults((prev) => prev.filter((item) => item.file !== image.file))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        }
      }

      const onVideoInsert = (video) => {
        const session = currentSession(ctx)
        if (!session.sessionId) {
          setError(tt('error.noSession'))
          return
        }
        // Markdown-image syntax would promise a picture; a link to the local MP4
        // is what the composer and the agent can actually act on.
        const failure = insertIntoDraft(ctx, session.sessionId, `[${video.name}](${video.file})`)
        if (failure) setError(tt(failure))
        else {
          setError('')
          setNotice(tt('notice.inserted'))
        }
      }

      const onVideoDelete = async (video) => {
        try {
          await api.videoRemove({ file: video.file })
          setVideoHistory((prev) => prev.filter((item) => item.file !== video.file))
          setVideoTask((prev) => (prev?.file === video.file ? null : prev))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        }
      }

      /**
       * Double click (or the expanded-area button) hands the recorded file to the
       * desktop: the host resolves the file-type association, which is what a
       * double click in a folder window does. The host refuses paths it did not
       * record, so this cannot be used to launch anything else.
       */
      const onOpen = async (file, action = 'default') => {
        try {
          await api.open({ file, action })
          setError('')
          setNotice(action === 'reveal' ? tt('notice.revealed') : tt('notice.opened'))
        } catch (cause) {
          setNotice('')
          setError(tt('error.open').replace('{message}', cause?.message ?? String(cause)))
        }
      }

      /**
       * Rewrite the prompt of one box. The result only lands in a comparison
       * card — the draft itself is untouched until the user accepts it.
       */
      const onOptimize = async (kind) => {
        const source = (kind === 'video' ? videoPrompt : prompt).trim()
        if (source === '') {
          setError(tt('optimize.empty'))
          return
        }
        setOptimizeBusy(kind)
        setError('')
        setNotice('')
        try {
          const session = currentSession(ctx)
          const payload = await api.optimize({
            prompt: source,
            kind,
            backend: optimizeBackend,
            seconds: kind === 'video' ? videoSeconds || undefined : undefined,
            sessionId: session.sessionId,
          })
          setOptimizeResult({
            kind,
            original: payload.original ?? source,
            prompt: payload.prompt ?? '',
            backend: payload.backend ?? optimizeBackend,
            model: payload.model ?? '',
            notes: Array.isArray(payload.notes) ? payload.notes : [],
          })
        } catch (cause) {
          setOptimizeResult(null)
          setError(tt('optimize.failed').replace('{message}', cause?.message ?? String(cause)))
        } finally {
          setOptimizeBusy('')
        }
      }

      const applyOptimized = () => {
        const result = optimizeResult
        if (!result) return
        if (result.kind === 'video') setVideoPrompt(result.prompt)
        else setPrompt(result.prompt)
        setOptimizeResult(null)
        setError('')
        setNotice(tt('optimize.done'))
      }

      /** The choice is persisted so it survives a reload, like the other defaults. */
      const changeOptimizeBackend = async (value) => {
        setOptimizeBackend(value === 'dsh' ? 'dsh' : 'agnes')
        try {
          applyStatus(await api.settings({ optimizeBackend: value }))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        }
      }

      const onSave = async () => {
        setSaving(true)
        setError('')
        setNotice('')
        try {
          applyStatus(
            await api.settings({
              apiKey: keyInput,
              model,
              size: defaultSize,
              ratio: defaultRatio,
              outputDir,
            }),
          )
          setKeyInput('')
          setNotice(tt('notice.saved'))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        } finally {
          setSaving(false)
        }
      }

      const onClearKey = async () => {
        setSaving(true)
        try {
          applyStatus(await api.settings({ clearApiKey: true }))
          setKeyInput('')
          setNotice(tt('notice.saved'))
        } catch (cause) {
          setError(cause?.message ?? String(cause))
        } finally {
          setSaving(false)
        }
      }

      const select = (value, onChange, options) =>
        h(
          'select',
          { style: S.select, value, onChange: (event) => onChange(event.target.value) },
          options.map((option) => h('option', { key: option, value: option }, option)),
        )

      /**
       * The "AI optimize" row under a prompt box: run button plus the backend
       * switch. The switch is only offered when the host can actually honour the
       * DSH option (LLM service + a configured default model).
       */
      const optimizeRow = (kind) => {
        const busyHere = optimizeBusy === kind
        // The Agnes backend needs the panel key; without one only the DSH
        // backend could run, so leave the button enabled in that case.
        const blocked = missingKey && optimizeBackend !== 'dsh'
        const disabled = busyHere || blocked
        const dshReady = status?.llmAvailable === true && status?.llmRoute != null
        const route = status?.llmRoute
        return h(
          'div',
          { style: { display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' } },
          h(
            'button',
            {
              type: 'button',
              style: S.button(false, disabled),
              disabled,
              onClick: () => onOptimize(kind),
            },
            busyHere ? tt('optimize.busy') : tt('optimize.button'),
          ),
          h('span', { style: S.label }, tt('optimize.backend')),
          h(
            'select',
            {
              style: S.select,
              value: optimizeBackend,
              disabled: busyHere,
              onChange: (event) => changeOptimizeBackend(event.target.value),
            },
            [
              h('option', { key: 'agnes', value: 'agnes' }, tt('optimize.backend.agnes')),
              h(
                'option',
                { key: 'dsh', value: 'dsh' },
                dshReady
                  ? `${tt('optimize.backend.dsh')}${route?.model ? ` · ${route.model}` : ''}`
                  : tt('optimize.backend.dshUnavailable'),
              ),
            ],
          ),
          h('span', { style: S.label }, optimizeBackend === 'dsh' ? tt('optimize.dshHint') : tt('optimize.agnesHint')),
        )
      }

      const statusPill = h(
        'span',
        { style: S.pill(Boolean(status?.hasKey)) },
        status?.hasKey ? tt('key.ok') : tt('key.missing'),
      )

      const goTab = (id) => {
        if (id === tab) return
        setSlideDir(TAB_ORDER.indexOf(id) > TAB_ORDER.indexOf(tab) ? 'right' : 'left')
        setTab(id)
      }

      const goLibrary = (kind) => {
        if (kind === libraryKind) return
        setSlideDir(kind === 'videos' ? 'right' : 'left')
        setLibraryKind(kind)
      }

      const tabButton = (id) =>
        h('button', { key: id, type: 'button', style: S.tab(tab === id), onClick: () => goTab(id) }, tt(`tab.${id}`))

      let body
      if (tab === 'generate') {
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          h(
            'div',
            { style: S.card },
            h('div', { style: S.label }, tt('form.prompt')),
            h('textarea', {
              style: S.textarea,
              value: prompt,
              placeholder: tt('form.promptPlaceholder'),
              onChange: (event) => setPrompt(event.target.value),
            }),
            optimizeRow('image'),
            optimizeResult && optimizeResult.kind === 'image'
              ? h(OptimizeCard, {
                  result: optimizeResult,
                  onApply: applyOptimized,
                  onRetry: () => onOptimize('image'),
                  onDiscard: () => setOptimizeResult(null),
                })
              : null,
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: S.col },
                h('div', { style: S.label }, tt('form.size')),
                select(size, setSize, status?.sizes ?? ['1K', '2K', '3K', '4K']),
              ),
              h(
                'div',
                { style: S.col },
                h('div', { style: S.label }, tt('form.ratio')),
                select(ratio, setRatio, status?.ratios ?? ['1:1']),
              ),
              h(
                'div',
                { style: S.col },
                h('div', { style: S.label }, tt('form.count')),
                select(String(count), (value) => setCount(Number(value)), ['1', '2', '3', '4']),
              ),
            ),
            h(
              'button',
              { type: 'button', style: S.link, onClick: () => setShowRefs((prev) => !prev) },
              showRefs ? tt('form.refsHide') : tt('form.refsShow'),
            ),
            showRefs ? h('textarea', { style: S.textarea, value: references, onChange: (event) => setReferences(event.target.value) }) : null,
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h(
                'button',
                {
                  type: 'button',
                  className: PRIMARY_CLASS,
                  style: S.button(true, busy || missingKey),
                  disabled: busy || missingKey,
                  onClick: onGenerate,
                },
                busy ? tt('form.generating') : tt('form.submit'),
              ),
              h('span', { style: S.label }, missingKey ? tt('hint.noKey') : tt('form.hint')),
            ),
            busy ? h(ProgressBar, { percent: null, label: tt('progress.image'), elapsed: elapsedOf(imageStartedAt) }) : null,
          ),
          results.length > 0
            ? h(
                'div',
                { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                h('div', { style: S.label }, tt('result.title')),
                h(
                  'div',
                  { style: S.grid },
                  results.map((image) =>
                    h(ImageCard, {
                      key: image.file,
                      image,
                      onInsert,
                      onCopy,
                      onDelete: null,
                      onOpen,
                    }),
                  ),
                ),
              )
            : null,
        )
      } else if (tab === 'library') {
        const imagesView = libraryKind === 'images'
        const entries = imagesView ? history : videoHistory
        const loading = imagesView ? galleryLoading : galleryLoading === true
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '10px' } },
          h(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            h(
              'div',
              { style: S.segmented },
              h('div', {
                className: PILL_CLASS,
                style: pillStyle(libraryKind === 'images' ? 0 : 1, 2, 3, 3),
                'aria-hidden': 'true',
              }),
              h(
                'button',
                {
                  type: 'button',
                  style: S.segment(libraryKind === 'images'),
                  onClick: () => goLibrary('images'),
                },
                tt('library.images'),
              ),
              h(
                'button',
                {
                  type: 'button',
                  style: S.segment(libraryKind === 'videos'),
                  onClick: () => goLibrary('videos'),
                },
                tt('library.videos'),
              ),
            ),
            h(
              'span',
              { style: S.label },
              imagesView
                ? tt('gallery.count').replace('{n}', String(history.length))
                : tt('video.historyCount').replace('{n}', String(videoHistory.length)),
            ),
            h('span', { style: S.grow }),
            h(
              'button',
              {
                type: 'button',
                style: S.button(false, loading),
                disabled: loading,
                onClick: imagesView ? refreshGallery : refreshVideoGallery,
              },
              tt('action.refresh'),
            ),
          ),
          entries.length === 0
            ? h('div', { style: S.label }, imagesView ? tt('gallery.empty') : tt('video.empty'))
            : h(
                'div',
                { style: imagesView ? S.grid : S.gridWide },
                entries.map((entry) =>
                  imagesView
                    ? h(ImageCard, {
                        key: entry.file,
                        image: entry,
                        onInsert,
                        onCopy,
                        onDelete,
                        onOpen,
                      })
                    : h(VideoCard, {
                        key: entry.videoId ?? entry.file,
                        video: entry,
                        onInsert: onVideoInsert,
                        onCopy,
                        onDelete: onVideoDelete,
                        onOpen,
                      }),
                ),
              ),
        )
      } else if (tab === 'video') {
        const videoModes = ['text', 'keyframe', 'reference']
        const secondsOptions = Array.from({ length: 9 }, (_, index) => String(index + 4))
        const modeSelect = h(
          'select',
          { style: S.select, value: videoMode, onChange: (event) => setVideoMode(event.target.value) },
          videoModes.map((mode) => h('option', { key: mode, value: mode }, tt(`video.mode.${mode}`))),
        )
        const task = videoTask
        const finished = Boolean(task?.file)
        const running = Boolean(task?.videoId) && !finished && task?.status !== 'failed'
        // "Stalled" is honest, not a guess: the last value the upstream sent has
        // been unchanged for a while, so the caption says exactly that.
        const stalled =
          running && progressStamp.current.at > 0 && Date.now() - progressStamp.current.at > VIDEO_STALL_MS
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          h(
            'div',
            { style: S.card },
            h('div', { style: S.label }, tt('form.prompt')),
            h('textarea', {
              style: S.textarea,
              value: videoPrompt,
              placeholder: tt('form.promptPlaceholder'),
              onChange: (event) => setVideoPrompt(event.target.value),
            }),
            optimizeRow('video'),
            optimizeResult && optimizeResult.kind === 'video'
              ? h(OptimizeCard, {
                  result: optimizeResult,
                  onApply: applyOptimized,
                  onRetry: () => onOptimize('video'),
                  onDiscard: () => setOptimizeResult(null),
                })
              : null,
            h(
              'div',
              { style: S.row },
              h('div', { style: S.col }, h('div', { style: S.label }, tt('video.mode')), modeSelect),
              h(
                'div',
                { style: S.col },
                h('div', { style: S.label }, tt('video.seconds')),
                select(videoSeconds, setVideoSeconds, secondsOptions),
              ),
            ),
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: S.col },
                h('div', { style: S.label }, tt('video.aspect')),
                select(videoAspect, setVideoAspect, status?.videoRatios ?? ['16:9']),
              ),
              h(
                'div',
                { style: S.col },
                h('div', { style: S.label }, tt('video.size')),
                select(videoSize, setVideoSize, status?.videoSizes ?? ['720P']),
              ),
            ),
            videoMode === 'keyframe'
              ? h(
                  'div',
                  { style: S.col },
                  h('div', { style: S.label }, tt('video.firstFrame')),
                  h('input', {
                    style: S.input,
                    value: videoFirstFrame,
                    onChange: (event) => setVideoFirstFrame(event.target.value),
                  }),
                  h('div', { style: S.label }, tt('video.lastFrame')),
                  h('input', {
                    style: S.input,
                    value: videoLastFrame,
                    onChange: (event) => setVideoLastFrame(event.target.value),
                  }),
                )
              : null,
            videoMode === 'reference'
              ? h(
                  'div',
                  { style: S.col },
                  h(
                    'div',
                    { style: S.label },
                    tt('video.images').replace('{n}', String(status?.videoMaxImages ?? 5)),
                  ),
                  h('textarea', {
                    style: S.textarea,
                    value: videoImages,
                    onChange: (event) => setVideoImages(event.target.value),
                  }),
                  h(
                    'div',
                    { style: S.label },
                    tt('video.audios').replace('{n}', String(status?.videoMaxAudios ?? 3)),
                  ),
                  h('textarea', {
                    style: S.textarea,
                    value: videoAudios,
                    onChange: (event) => setVideoAudios(event.target.value),
                  }),
                )
              : null,
            h(
              'div',
              { style: { display: 'flex', alignItems: 'center', gap: '10px' } },
              h(
                'button',
                {
                  type: 'button',
                  className: PRIMARY_CLASS,
                  style: S.button(true, videoBusy || running || missingKey),
                  disabled: videoBusy || running || missingKey,
                  onClick: onGenerateVideo,
                },
                videoBusy ? tt('video.generating') : tt('video.submit'),
              ),
              h('span', { style: S.label }, missingKey ? tt('hint.noKey') : tt('video.hint')),
            ),
          ),
          running
            ? h(ProgressBar, {
                percent: task?.progress,
                stalled,
                note: stalled
                  ? tt('progress.upstreamStall')
                      .replace('{progress}', String(task?.progress ?? 0))
                      .replace('{seconds}', String(elapsedOf(videoStartedAt)))
                  : '',
                label: tt('video.rendering')
                  .replace('{status}', String(task?.status ?? 'queued'))
                  .replace('{progress}', String(task?.progress ?? 0)),
                elapsed: elapsedOf(videoStartedAt),
              })
            : videoBusy
              ? h(ProgressBar, { percent: null, label: tt('video.generating'), elapsed: elapsedOf(videoStartedAt) })
              : null,
          finished
            ? h(VideoCard, {
                video: task,
                onInsert: onVideoInsert,
                onCopy: onCopy,
                onDelete: null,
                onOpen,
              })
            : null,
        )
      } else {
        const sourceKey = `key.source.${status?.keySource ?? 'none'}`
        body = h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          missingKey ? h('div', { style: S.banner('error') }, tt('hint.noKey')) : null,
          h(
            'div',
            { style: S.card },
            h('div', { style: S.label }, tt('settings.key')),
            h('input', {
              style: S.input,
              type: 'password',
              value: keyInput,
              placeholder: tt('settings.keyPlaceholder'),
              onChange: (event) => setKeyInput(event.target.value),
            }),
            h(
              'div',
              { style: S.mono },
              tt('settings.current')
                .replace('{source}', tt(sourceKey))
                .replace('{hint}', status?.keyHint ?? ''),
            ),
            h(
              'div',
              { style: { display: 'flex', gap: '8px', flexWrap: 'wrap' } },
              h(
                'button',
                { type: 'button', className: PRIMARY_CLASS, style: S.button(true, saving), disabled: saving, onClick: onSave },
                saving ? tt('action.saving') : tt('action.save'),
              ),
              h(
                'button',
                { type: 'button', style: S.button(false, saving), disabled: saving, onClick: onClearKey },
                tt('action.clearKey'),
              ),
            ),
            h(
              'div',
              { style: S.col },
              h('div', { style: S.label }, tt('settings.model')),
              h('input', { style: S.input, value: model, onChange: (event) => setModel(event.target.value) }),
            ),
            h(
              'div',
              { style: S.row },
              h(
                'div',
                { style: S.col },
                h('div', { style: S.label }, tt('settings.defaults')),
                select(defaultSize, setDefaultSize, status?.sizes ?? ['1K', '2K', '3K', '4K']),
              ),
              h('div', { style: S.col }, h('div', { style: S.label }, ' '), select(defaultRatio, setDefaultRatio, status?.ratios ?? ['1:1'])),
            ),
            h(
              'div',
              { style: S.col },
              h('div', { style: S.label }, tt('settings.outputDir')),
              h('input', { style: S.input, value: outputDir, onChange: (event) => setOutputDir(event.target.value) }),
            ),
          ),
          h('div', { style: S.mono }, tt('settings.dataDir').replace('{dir}', status?.dataDir ?? '')),
        )
      }

      return h(
        'div',
        { style: S.root },
        h(
          'div',
          { style: S.inner },
          h('div', { style: S.header }, h(PanelIcon, { size: 18 }), h('span', { style: S.title }, tt('title')), h('span', { style: S.grow }), statusPill),
          h(
            'div',
            { style: S.tabs },
            h('div', { className: PILL_CLASS, style: pillStyle(TAB_ORDER.indexOf(tab), TAB_ORDER.length, 4, 3), 'aria-hidden': 'true' }),
            TAB_ORDER.map(tabButton),
          ),
          error ? h('div', { style: S.banner('error') }, error) : null,
          notice ? h('div', { style: S.banner('notice') }, notice) : null,
          // Keying the wrapper remounts it on every switch, which replays the slide:
          // tab changes and the library's images/videos toggle both animate without
          // any transition bookkeeping. The direction follows the tab order, and the
          // pill above rides the same curve so highlight and body arrive together.
          h(
            'div',
            {
              key: tab === 'library' ? `library:${libraryKind}` : tab,
              className: slideDir === 'left' ? `${SLIDE_CLASS} is-left` : SLIDE_CLASS,
            },
            body,
          ),
        ),
      )
    }

    // ----------------------------------------------------------------- wire --
    const inject = ['slots', 'locale', 'layout']

    function apply(ctx) {
      ctx.effect(
        () => {
          try {
            return ctx.locale.register(NS, DICT)
          } catch (error) {
            console.warn('[agnes-image] locale registration failed:', error)
            return () => {}
          }
        },
        'agnes-image: dictionaries',
      )

      try {
        const bound = ctx.locale.bind(NS)
        tt = (key) => bound(key)
      } catch (error) {
        console.warn('[agnes-image] locale bind failed:', error)
      }

      ctx.effect(() => ensurePrimaryStyles(), 'agnes-image: button styles')

      try {
        const slots = ctx.get?.('slots') ?? ctx.slots
        if (!slots) {
          console.warn('[agnes-image] slots service unavailable; panel not registered')
          return
        }
        slots.inject('sidebar.panellist', () =>
          slots.register(
            { name: 'sidebar.panellist', id: PANEL_ID, order: PANEL_ORDER, label: () => tt('entry.label') },
            PanelIcon,
          ),
        )
        slots.inject('main', () =>
          slots.register({ name: 'main', key: PANEL_ID, inject: () => ({ ctx }) }, AgnesPanel),
        )
      } catch (error) {
        console.warn('[agnes-image] panel registration failed:', error)
      }
    }

    exports.apply = apply
    exports.inject = inject
    return module.exports
  },
})
