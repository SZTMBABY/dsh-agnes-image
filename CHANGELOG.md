# Changelog

All notable changes to `dsh-agnes-image`. Versions track the plugin's own `version` field (the host half reports it through `GET /api/agnes-image/status`).

## 1.4.0

- **Cards carry a thumbnail by default.** Collapsed cards now show a thumbnail on top and the file name below (images 96×96, video posters 160×90); the prompt, media facts and action buttons live behind the expand chevron. The expand area stays in the DOM and animates `grid-template-rows: 0fr → 1fr`, and is marked `inert` while collapsed.
- **Double-click opens, chevron expands.** Only the thumbnail/poster responds to a double click and hands the file to the desktop's default application; the file name and the chevron only toggle expansion.
- **Video posters without ffmpeg.** The panel grabs a frame with a hidden `<video>` + canvas and posts it to `POST /api/agnes-image/video-cover`, which stores `<same stem>-cover.png` next to the file and records `cover` in `video-history.json` / `video-tasks.json`. Failures only `console.warn`. Refreshing the Library back-fills at most 3 old records.
- **No in-panel video playback anywhere**, and the Library renders both kinds as small card grids (segmented Images/Videos switch).
- **Honest progress bar.** A running video job shows the real upstream percentage (0/10/70/100); when it has not changed for more than 12 s (`VIDEO_STALL_MS`) the bar becomes flowing stripes and the caption says the number comes from upstream, together with elapsed seconds. Image jobs show an indeterminate striped bar plus elapsed time — no invented numbers.
- **Motion layer.** Tab switches slide 450 ms / 40 px on `cubic-bezier(.16,1,.3,1)` with direction following tab order, an orange inset-ring pill slides to the active tab in step (pure `calc()`, no DOM measurement), and thumbnails scale 1.03× with an orange ring on hover. Everything honours `prefers-reduced-motion: reduce`. Slide keyframes animate `transform` only — an `opacity` start made tall form tabs flash the bare panel background for ~100 ms.
- **Panel-only credentials.** `Config.apiKey` and the environment-variable fallback are gone; the key is read from the panel's Settings tab only (`%DSH_HOME%\agnes-image\settings.json`). Without a key the generation/optimize entry points refuse with `No Agnes API key configured: …`. `status` returns only `keySource` and a masked `keyHint`.
- Twelve routes (adds `/open` and `/video-cover`); every route declares `requestBody: 'buffered'`.
- Published to npm as [`dsh-agnes-image@1.4.0`](https://www.npmjs.com/package/dsh-agnes-image) (zero dependencies, `files` limited to source, docs and screenshots).

## 1.3.0

- Library tab (segmented Images/Videos, small card grids); video history moved out of the Videos tab.
- Collapsible cards with `文件名 + 展开/收起`; `/open` route (default app / reveal in folder) restricted to files recorded in history.
- Panel-only API key; no credential shipped in `cordis.patch.yml`.
- Prompt optimizer with two backends (`agnes` / `dsh`).

## 1.2.0 and earlier

- Video generation (create + poll + resume across page reloads), video history and delete.
- Prompt optimizer, image history, settings tab, sidebar panel, image generation tool.
