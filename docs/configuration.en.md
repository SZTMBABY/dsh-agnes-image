# Configuration

[中文](configuration.md) · [Docs index](index.en.md)

## Settings and defaults

`Config` in `index.js` is the single source of defaults, and the repository's `cordis.patch.yml` carries the same values.

| Key | Default | What it does | Panel-editable |
| --- | --- | --- | --- |
| `model` | `agnes-image-2.5-flash` | Image model | yes |
| `size` | `2K` | Default resolution bucket | yes |
| `ratio` | `1:1` | Default aspect ratio | yes |
| `timeoutMs` | `300000` | Per-request Agnes timeout; shared by image requests and video create | no |
| `outputDir` | `''` | Output root; blank = the calling session's workspace | yes |
| `historyLimit` | `200` | Rows kept in `history.json`; writes keep at least 10 | no |
| `videoModel` | `agnes-video-2.5-flash` | Video model | no |
| `videoSize` | `720P` | Default video resolution | no |
| `videoAspect` | `16:9` | Default video aspect ratio | no |
| `videoSeconds` | `5` | Default clip length (a string) | no |
| `videoTimeoutMs` | `900000` | Whole-task budget: create + retries + queue wait + render + download | no |
| `videoPollMs` | `3000` | Poll interval. Clamped to a 1000 ms floor on read | no |
| `videoQueueRetries` | `6` | Create-time retry count. Floor of 1 on read | no |
| `optimizeBackend` | `agnes` | Rewriter backend: `agnes` or `dsh` | yes (next to the prompt box) |
| `optimizeModel` | `agnes-3.0-flash` | Text model the `agnes` backend asks | yes |
| `optimizeMaxTokens` | `900` | Rewriter output token cap. Floor of 64 on read | no |
| `optimizeTimeoutMs` | `120000` | Rewriter request timeout | no |

Precedence is panel-first: if the panel's stored value is not `undefined`, `null` or an empty string it wins, otherwise Config does. The Settings tab writes `model`, `size`, `ratio`, `outputDir` and `optimizeBackend`; the settings route also accepts the string keys `videoModel`, `videoSize`, `videoAspect`, `videoSeconds`, `optimizeModel` and the numeric keys `videoTimeoutMs`, `videoPollMs`, `videoQueueRetries`, `optimizeMaxTokens`, `optimizeTimeoutMs` (each must be a finite positive number).

To change Config, edit the profile's bundle config or the repository's `cordis.patch.yml`, then restart the profile.

## The key

- There is no `apiKey` field and no `apiKeyEnv` field. The plugin ships with no credential at all.
- Exactly one source: the panel's Settings tab. The host writes it to `apiKey` in `%DSH_HOME%\agnes-image\settings.json`.
- Key resolution reads only that file and returns `{ value, source }`, where `source` is `panel` or `none`. No environment variable is consulted.
- `GET /api/agnes-image/status` returns `hasKey`, `keySource` and a masked `keyHint` (first 6 characters + `…` + last 4). The full key never leaves the host process, and `client.js` never contains it.
- Clearing: the Settings tab's clear button sends `{ clearApiKey: true }`; the host deletes the `apiKey` field and keeps everything else.
- With no key, any generation action fails with:

  ```
  No Agnes API key configured: open the panel Settings tab and save one first (the plugin ships without a key).
  ```

  The prompt optimizer needs a key only on the `agnes` backend; the `dsh` backend uses the profile's own model.

## Data files

The data directory is `<home>\agnes-image\`. `home` resolves as `ctx.get('profileContext')?.home`, then `process.env.DSH_HOME`, then `~\.dsh`.

| File | Contents |
| --- | --- |
| `settings.json` | `apiKey` plus whatever the panel has changed |
| `history.json` | Image rows, newest first |
| `video-history.json` | Finished video rows, including the cover path |
| `video-tasks.json` | Video tasks that have not finished, used to resume across a page reload |

Writes are atomic: the content goes to `<file>.tmp-<pid>-<timestamp>` first and is then renamed over the target, so a crash never leaves half a JSON file. `history.json` and `video-history.json` are treated as empty arrays if what is on disk is not an array.

The Settings tab shows the absolute path of the data directory, and `/status`, `/history` and `/video-history` all return `dataDir`.

## Output directories

- `outputDir` blank: write into the calling session's workspace.
- Relative path: resolved against the session cwd.
- Absolute path: used as is.

Session cwd resolves in this order: the live session's header `cwd` (authoritative), then an absolute `cwd` sent by the panel, then the process cwd. Tool calls go through the first path; the panel uses the second.

Where files land:

- Images: `<base>\agnes-images\YYYY-MM-DD\HHMMSS-<slug>.<ext>`. `slug` is the first 32 characters of the prompt with whitespace and Windows-illegal characters replaced by `-`; CJK characters survive. When nothing usable is left it falls back to `image`. Collisions get `-2` through `-99`.
- Videos: `<base>\agnes-videos\...`, with the poster written next to the MP4 as `<stem>-cover.png`.

The extension comes from the upstream `content-type`: png, jpeg, webp or gif, falling back to `.png`.

## Environment variables

The plugin reads exactly one environment variable: `DSH_HOME`, used to find the home directory and therefore the `agnes-image` data directory. It reads nothing else related to Agnes.

The test suite (which is not part of the plugin at runtime) also looks at `AGNES_API_KEY` — that is the suite's own key lookup, environment first and then the panel's `settings.json`.
