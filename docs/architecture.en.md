# Architecture

[中文](architecture.md) · [Docs index](index.en.md)

## How the two halves split

| | Host half `index.js` | Client half `client.js` |
| --- | --- | --- |
| Runs in | the DSH host process | the browser |
| Has access to | API key, filesystem, Agnes HTTP, session cwd | DOM, canvas, locale, slots |
| Owns | Agnes calls, disk writes, history, the two agent tools, the 12 routes | the sidebar entry, the full page, motion, i18n |
| Cannot see | — | the API key, ever |

The browser artefact has no build step. `client.js` is the code that ships, wrapped in `window.__ModuleLoader__.load({ id: 'dsh-agnes-image', factory })`.

Client requests build **document-relative** URLs with `new URL(relative, document.baseURI)` — `api/agnes-image/status`, no leading slash. The GUI's `<base href="./">` may sit under a path prefix, where a root-absolute `/api/...` escapes it. Images and videos do not go through plugin routes at all; they use the core `api/file?path=<absolute>` route.

Routes register through `ctx.connection.fetch.register`, which is what puts the `/api` prefix behind the trust fence and cookie auth. Do not switch to `ctx.webServer.register` — that path skips authentication. `connection` is a declared injection, so a profile without the web app keeps the plugin pending rather than half-loading it. When the service is missing, the host logs one warning:

```
connection service unavailable — panel routes not registered (agent tool still works)
```

## Route table

The prefix is `ROUTE = '/api/agnes-image'`, and there are 12 routes. Every one of them sets `requestBody: 'buffered'` explicitly — the reason is in the next section.

| Method | Path | Input | Output |
| --- | --- | --- | --- |
| GET | `/status` | — | `ok`, `hasKey`, `keySource`, `keyHint`, the effective settings, the enums, `llmAvailable`, `llmRoute`, `dataDir`, `version` |
| GET | `/history?limit=60` | `limit`, clamped to 1–500 | `items`, `dataDir` |
| POST | `/generate` | `prompt`, `size`, `ratio`, `count`, `referenceImages` (or `reference_images`), `sessionId`, `cwd` | `images` (absolute paths), `baseDir` |
| POST | `/settings` | see [configuration.en.md](configuration.en.md) | the updated `status` |
| POST | `/delete` | `file` | `ok` |
| POST | `/open` | `file`, `action` (`default` or `reveal`) | `ok`, `action`, `file` |
| POST | `/video-create` | the video parameters | `task` |
| GET | `/video-status?videoId=` | `videoId` required | the refreshed `task` |
| GET | `/video-history?limit=60` | `limit`, clamped to 1–500 | `items`, `dataDir`, `videoDir` |
| POST | `/video-delete` | `file` | `ok` |
| POST | `/video-cover` | `file`, `dataUrl` | `cover` (absolute path of the PNG) |
| POST | `/optimize` | `prompt`, `kind`, `backend`, `seconds`, `sessionId` | the rewritten text, `usage`, `backend`, `notes` |

Both delete routes share one safety boundary: only a file already recorded in `history.json` / `video-history.json` can be deleted, otherwise the answer is 404 `no history record for that file`. A crafted request body cannot reach an arbitrary path. `/video-cover` works the same way — only a video file recorded in `video-history.json` is accepted.

Errors come back uniformly as `{ ok: false, error: '...' }`.

## Why every route sets requestBody: 'buffered' (including GET)

`ConnectionFetchRoute.requestBody` is typed `'buffered' | 'streaming'` — there is no "absent" member. The shared `/api` handler passes it through unchanged (`dsh-client-connection/lib/index.js:610-613`), and the HTTP bridge only special-cases `bodyMode === 'buffered'`; every other value takes the streaming branch, which builds a Request with a body via `Readable.toWeb(req)` (same file, `:43-81`).

A body on GET or HEAD is illegal, so `new Request(url, { method: 'GET', body })` throws before any response exists. All the browser sees is a 400 with an empty body and no `content-type`, which tells you nothing.

That is why GET routes must spell out `requestBody: 'buffered'` too. The repetition 12 times in `index.js` is load-bearing, not boilerplate left over from a template.

## Video: create, poll, retry

- Create lives at `/v1/videos`; polling lives at the site root, `/agnesapi`, with no `/v1`. Getting that wrong is a 404, not a 400.
- A poll carries `video_id` and `model_name`. The model name is required for keyframe and reference jobs and accepted for text jobs.
- Retriable statuses: 429, 500, 502, 503, 504. The free tier's `video_queue_full` and `video_queue_unavailable` land in that set.
- Create retries up to `videoQueueRetries` times (default 6), backing off by `min(30s, 5s × attempt)`. Each retry emits a note the panel shows:

  ```
  Agnes video queue busy (HTTP 503: ...); retry 3/6 in 10s
  ```

  When the retries run out the error adds "the free video queue was busy or rate-limited after 6 attempts; retry in a minute".
- Polling sleeps `videoPollMs` (3 s) before each query, with a 60 s timeout per query. A failed query that is marked retriable does **not** fail the job — it keeps waiting, because polling hits its own 429s while the render is still going. Non-retriable errors are thrown.
- The whole task gets `videoTimeoutMs` (900 s) from creation. On timeout:

  ```
  Agnes video timed out after 900s (task <videoId> still <status>)
  ```

- The task table lives in `video-tasks.json`, and each videoId remembers its `baseDir`. Close the page, come back later, and the host resumes polling and downloads the MP4 into the original workspace. The download happens exactly once. This is what makes "close the page and come back" work.
- The client's own cadence: first poll at 4 s after submit, then every 5 s; on a query error it backs off to 10 s instead of treating one hiccup as a failure.

## The poster-frame chain

A collapsed video card still has to show something, but the host does not decode video: the author's machine has no ffmpeg and the core packages expose no host-side thumbnail service. So the browser grabs a frame and sends it back to the host to store.

1. `grabFrame()` creates a detached `<video>` with `muted`, `playsInline` and `preload='auto'`, and seeks to `min(0.2, duration / 2)` once it has loaded.
2. On `seeked` it draws to a canvas with the width clamped to `min(videoWidth, 640)` and exports a PNG data URL. There is an 8 s timeout; an unsupported codec, a tainted canvas or a missing intrinsic size all resolve to an empty string.
3. On an empty string the card falls back to whatever frame the browser paints for the `<video>` element, so it is never blank.
4. `POST /api/agnes-image/video-cover` with `{ file, dataUrl }`. The host checks that `dataUrl` starts with `data:image/png;base64,`, decodes to something non-empty and stays under 6 MB, and that `file` is recorded in `video-history.json`, otherwise 404.
5. The host writes the PNG next to the MP4 as `<stem>-cover.png` and updates the `cover` field on both the history row and the task row.
6. When the library refreshes it back-fills at most 3 cover-less records per refresh, with a `coverTried` set so the same record is not retried again and again in one session. A page refresh resets that, so a record that failed earlier gets another chance.

## Motion layer

All CSS, no JS height measurement.

| Motion | Timing | How |
| --- | --- | --- |
| Tab switch / library images-videos switch | 450 ms, `cubic-bezier(.16,1,.3,1)`, 40 px | The new body slides in from the side it came from: right when moving forward through the tabs, left when moving back. Direction comes from the index in `TAB_ORDER` |
| Active-tab pill | the same 450 ms curve | It rides along so the highlight and the body arrive together |
| Card expand / collapse | 200 ms | `grid-template-rows` from `0fr` to `1fr`, with `overflow:hidden; min-height:0` on the child. No height measurement, no extra layout pass |
| Thumbnail / poster hover | 0.16 s | 1.03× scale plus a 2 px orange ring, the hint that it can be double-clicked |
| Indeterminate progress bar | 1.4 s loop | A 38% wide segment sliding back and forth |

The slide animates `transform` only, never opacity. Starting from `opacity: 0` made the tall tabs flash the bare panel background for about 100 ms — the body is remounted, so there is nothing opaque underneath it, and that dark blink is what made switching feel disjointed. Fully opaque from the first frame, the offset alone carries the motion.

`prefers-reduced-motion: reduce` turns off the slide animation, the pill transition, the expand transition and the media transition; the bar's stripes become a static full-width fill at lower opacity. That is a real media query, not a JS guess. The thumbnail hover affordance keeps its scale and ring under reduced motion — only the transition is dropped, because the ring is what says "this opens".

## Progress bars

- Images: the API has no progress channel, so the bar is indeterminate with elapsed seconds. No number is invented.
- Videos: the real upstream percentage, with a 0.45 s width transition, next to the status and elapsed seconds.
- `VIDEO_STALL_MS = 12000`: when the reported percentage has not moved for 12 seconds — roughly three polls at the video API's ~4 s cadence — the bar switches to flowing stripes and the caption becomes

  ```
  Upstream still reports 10% — rendering · 132s elapsed
  ```

  It names where the number comes from instead of faking motion. The moment upstream jumps to 70 or 100 it snaps back to a real fill.

## i18n

The namespace is `dsh-agnes-image`, and `client.js` embeds both a Chinese and an English dictionary, 99 keys each. Registration goes through `ctx.locale.register(NS, DICT)`; if binding fails the panel falls back to the English dictionary with `DICT.en[key] ?? key`, so it stays readable.

Strings with variables use placeholders — the stall caption, for instance, uses `{progress}` and `{seconds}` — and the host takes no part in translation: it sends states and numbers, the wording lives in the client.

## CTA colour

The primary button fills with `#ff7700`, hovers to `#e86b00`, presses to `#d96100`, and writes its label in `#1f1300` (dark brown).

Contrast of that dark ink on the orange: about 6.9:1 at rest, 5.7:1 on hover, 4.9:1 when active — all three clear WCAG AA's 4.5:1. White on the same orange is only about 2.7:1, which is why the label here is dark rather than white.

Hover and active need real pseudo-classes, so they live in an idempotently injected `<style>` tag, the same idiom the core client bundles use; the fill is also set inline so a blocked injection still renders an orange button. The focus ring uses the core `--dsw-focus-ring-width` variable, 2 px by default.
