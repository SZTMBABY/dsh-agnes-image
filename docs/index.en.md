# dsh-agnes-image docs

[中文](index.md)

A DSH plugin that wires Agnes image and video generation into the Harness. The host half ships two agent tools and a set of HTTP routes; the client half is a sidebar panel.

Repository: <https://github.com/SZTMBABY/dsh-agnes-image>

## What you get

- Two tools the model can call directly: `agnes_generate_image` and `agnes_generate_video`.
- One sidebar panel with four tabs: Images, Videos, Library, Settings.
- Images and videos land in the calling session's workspace, under `agnes-images\` and `agnes-videos\`, sorted into date folders.
- Both prompt boxes have a rewrite button. The backend is either Agnes' free text model or the model this profile already uses.

## About the key

Neither the plugin nor these docs ship a credential. The API key has exactly one source: the panel's Settings tab, which stores it in `%DSH_HOME%\agnes-image\settings.json`. The plugin reads no Agnes-related environment variable, and no key is checked into the repository.

## Docs map

| Document | Covers |
| --- | --- |
| [install.en.md](install.en.md) | Install, upgrade, rollback, headless, desktop hand-off |
| [usage.en.md](usage.en.md) | How to call the two tools, how the four tabs work |
| [configuration.en.md](configuration.en.md) | Settings and defaults, key policy, data files, output directories |
| [architecture.en.md](architecture.en.md) | Host vs client split, the 12 routes, polling and retries, motion layer |
| [contributing.en.md](contributing.en.md) | Dev setup, the test suite, commit conventions |

Chinese file names carry no suffix; the English version of each doc is the same name plus `.en.md`.

## Layout

| Path | What it is |
| --- | --- |
| `index.js` | Host half. Agnes calls, disk writes, history, routes, tool registration |
| `client.js` | Client half. The browser artefact, built by hand, no build step |
| `cordis.patch.yml` | Bundle patch layer: the bundle row id and default config |
| `screenshots/` | The images the README and these docs reference |
| `docs/` | This documentation set |

Screenshots are referenced from inside `docs/` with a relative path, for example `../screenshots/panel-images.png`.
