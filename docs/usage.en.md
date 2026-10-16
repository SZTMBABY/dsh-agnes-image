# Usage

[中文](usage.md) · [Docs index](index.en.md)

## Agent tools

### agnes_generate_image

Synchronous: one call returns the result, and the result is the absolute path of each saved file.

| Parameter | Notes |
| --- | --- |
| `prompt` | Required. Use the user's own wording; Chinese prompts work |
| `size` | `1K` / `2K` (default) / `3K` / `4K`. An exact `WxH` string is also accepted |
| `ratio` | `1:1` (default), `3:4`, `4:3`, `16:9`, `9:16`, `2:3`, `3:2`, `21:9` |
| `reference_images` | Array of public HTTPS URLs or `data:image/...;base64` strings |
| `count` | 1 (default) to 4; out-of-range values are clamped |

Passing reference images means image-to-image or multi-image composition. Do not also ask for an img2img tag — the model infers it. At most 8 references are used.

### agnes_generate_video

Asynchronous: create a task, poll until it finishes, then download the MP4 into the workspace. Usually one to three minutes.

| Parameter | Notes |
| --- | --- |
| `prompt` | Required. Subject and scene first, then action, camera movement, style and sound |
| `mode` | `text` (default, prompt only), `keyframe` (first/last frame), `reference` (images/audios) |
| `seconds` | String from `"4"` to `"12"`, default `"5"` |
| `size` | `720P` / `1080P` / `1K` / `2K`. `agnes-video-2.5-flash` renders 720P only; anything else is pinned to 720P |
| `aspect_ratio` | `16:9` (default), `9:16`, `1:1`, `4:3`, `3:4`, `21:9` |
| `first_frame` / `last_frame` | keyframe mode. Public URL, `data:` URL or a local path |
| `images` | reference mode. Up to 5 with the flash model. Refer to them as `<Picture 1>`, `<Picture 2>` |
| `audios` | reference mode. Up to 3 clips with the flash model, 2–12 s each. Refer to them as `<Audio 1>` |
| `seed` | Optional integer; the same seed makes results more reproducible |

The per-mode rules are validated locally before the request, and the error says exactly what is missing:

- `keyframe` needs at least one of first/last frame, and rejects reference images or audios.
- `reference` needs at least one reference image or audio clip, and rejects first/last frames.
- Reference media can be a public HTTPS URL, a `data:` URL, or a local file path. Local files are inlined into `data:` URLs automatically; the limit is 15 MB per file.

The tool timeout is 900000 ms (15 minutes). The free queue is sometimes full or rate-limited; the plugin retries a few times itself, and a failure that survives the retries tells you to try again in a minute.

## Panel

The sidebar entry registers in `sidebar.panellist` with id `agnes-image` and order 60. Clicking it opens a full page whose tabs are, in order: Images, Videos, Library, Settings.

![Images tab](../screenshots/panel-images.png)

### Images

Prompt box, size, ratio, count (1–4), and a reference-image box that takes one URL or `data:` URL per line. A rewrite button sits next to the prompt.

While a job runs you get an indeterminate striped bar plus elapsed seconds. The image API has no progress channel, so no number is invented here.

### Videos

Prompt, mode (text / keyframe / reference), duration, resolution, aspect ratio, the first/last frame or reference image/audio inputs for that mode, and a seed field.

![Videos tab](../screenshots/panel-video.png)

A running job shows the real upstream percentage (0/10/70/100) with the status and elapsed seconds. If that percentage does not move for 12 seconds the bar switches to flowing stripes and the caption becomes:

```
Upstream still reports 10% — rendering · 132s elapsed
```

It says where the number comes from instead of pretending it is moving. The moment upstream jumps to 70 or 100 it snaps back to a real fill.

Closing the page does not lose the job. The host keeps the task in `video-tasks.json` with its output directory, resumes polling when you come back, and downloads the MP4 exactly once.

### Library

A segmented images/videos switch over a grid of small cards.

![Image library](../screenshots/library-images.png)

![Video library](../screenshots/library-videos.png)

Every card carries a thumbnail by default: 96×96 for images, 160×90 for video posters. Collapsed, a card shows the thumbnail and the file name; click the name or the chevron to expand it and reveal the prompt, size, ratio, duration, bytes and the action buttons (open, reveal in folder, insert into the session, copy, delete). Expanding and collapsing is a 200 ms transition.

Hovering a thumbnail scales it 1.03× and draws an orange ring, the hint that it can be double-clicked. Double-clicking hands the file to the desktop's default association: images to the image viewer, videos to the default player — semantically the same as double-clicking in Explorer.

The panel never plays video in place. A collapsed video card still has to show something, but the host does not decode video, so the poster is a frame the browser grabbed (see [architecture.en.md](architecture.en.md)). With no poster yet the card says `No cover yet (double-click to open with the default player)`.

### Settings

![Settings tab](../screenshots/panel-settings.png)

- API Key: a password field, plus a clear button.
- Model, default size, default ratio, output directory (blank = the calling session's workspace).
- Two mono hint lines: where the current key comes from, in masked form, and the absolute path of the data directory.

With no key saved the tab shows a red banner and the generate buttons are disabled.

Video defaults (model, size, aspect, seconds, polling) and the optimizer's token/timeout numbers are not in the panel; they only come from Config — see [configuration.en.md](configuration.en.md). The optimizer's backend dropdown sits next to the prompt box, and switching it writes back to settings immediately.

## Prompt optimizer

Both prompt boxes (image and video) share one rewriter, with two backends.

| Backend | What it does |
| --- | --- |
| `agnes` | One Chat Completions call on the same panel key, using the free Agnes text model (default `agnes-3.0-flash`), temperature 0.7, `max_tokens` 900. The free tier 429s and 5xxs occasionally, so it backs off and retries 3 times (2 s, then 4 s) |
| `dsh` | Runs through this profile's own chat model. No extra cost and no extra key. If the profile has no default model or the host has no LLM service, the option is disabled in the panel instead of failing on click |

Input over 4000 characters fails before any upstream call. Output is capped at 1200 characters. The image and video prompts use different system instructions: the image one asks for at most 90 words (about 120 CJK characters) in one to three sentences; the video one allows 110 words (about 150 CJK characters) in two to four sentences, one continuous shot, no cuts. Both say to reply with the prompt alone — no quotes, label, explanation or markdown — and to write in the language of the input.

## Common shapes

```
Use agnes_generate_image for a 16:9 2K wallpaper: the Shanghai skyline at dusk
```

```
Composite these two images into one, 1:1: https://.../a.png  https://.../b.png
```

```
agnes_generate_video, reference mode, reference image https://.../cat.png,
refer to it as <Picture 1> in the prompt, 8 seconds, 9:16
```

```
agnes_generate_video, keyframe mode, first_frame from this local file, slow push-in, 6 seconds
```
