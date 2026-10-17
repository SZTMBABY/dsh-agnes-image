# Contributing

[中文](contributing.md) · [Docs index](index.en.md)

## Dev setup

This repository has no npm install step: `index.js` is the host half, `client.js` is the browser artefact, and there is no build. There is no `node_modules` here either.

`node` may not be on your PATH. Use the runtime that ships with the profile:

```
%DSH_HOME%\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
```

The rest of this page just calls it `node`. It was v24.21.0 on the author's machine.

## Checking your change

```powershell
node --check index.js
node --check client.js
```

- `node --check` parses syntax only. It does not type-check and does not resolve dependencies, so passing it is not proof the logic is right.
- Changed `client.js`: the host recomposes the graph and serves a new rev, so a page refresh picks it up (the HMR receiver may save you the refresh).
- Changed `index.js`: a loaded module generation cannot be hot-replaced, so restart the profile.
- The version lives in `version` in `package.json` and in the `version` field `status()` returns in `index.js` (both `1.4.0` now). Bump them together.

## The end-to-end suite

The dev machine has a suite that runs the real `index.js` (copied in as `plugin.mjs`) against the real `@deepseek-ai/dsh-tools` and schemastery with fake cordis `ctx` objects. With a key present it makes real Agnes calls.

How to run it:

1. Copy `index.js` over `plugin.mjs` in the test directory. The test directory resolves the core packages through a junction; the plugin directory itself has no `node_modules`.
2. Run `node run.mjs` from that directory.

Results, both measured:

| Mode | Result |
| --- | --- |
| No key | 92 PASS / 0 FAIL, 6 sections skipped (the output shows 7 `SKIP` lines; the first is the banner) |
| With a key | 124 PASS / 0 FAIL / 0 SKIP |

Key lookup order: `AGNES_API_KEY` from the environment first, then the panel's own `%DSH_HOME%\agnes-image\settings.json`. With no key every live upstream call is skipped and the rest of the assertions still run.

The 6 sections skipped without a key: the real tool call, panel generation, settings precedence, delete-by-record, `video-create` payload validation, and the prompt optimizer.

A few notes:

- **After editing `index.js` you must re-copy `plugin.mjs`**, otherwise the suite still tests the old host half and you get a false green.
- The live sections really do hit Agnes. Network flakiness shows up as `Agnes request failed: fetch failed`; re-run, that is upstream rather than a regression.
- The suite writes its own home and workspace into temp directories (`<tmp>\agnes-home-*`, `<tmp>\agnes-ws-*`) and never touches your real data directory.
- The last section asserts against the shipped client source text — CSS and DOM behaviour that headless cannot exercise, so it checks the code that goes out instead.

## install-agnes.mjs (author-side, not in this repo)

`install-agnes.mjs` on the author's dev machine does the two manual steps:

1. Back up the profile's `package.json` to `package.json.bak-agnes-image` (skipped if it already exists).
2. Delete `<profile>\node_modules\dsh-agnes-image` and copy the tree in.
3. Push `dsh-agnes-image` into `dsh.profile.bundles` (skipped if already listed) and rewrite `package.json` with 2-space indent.

It needs write permission on the profile directory, and it fails fast if `dsh.profile.bundles` is not an array, so it cannot corrupt the profile.

## Commit conventions

- One change per commit. Behaviour, docs and screenshots go in separate commits.
- Say what the **behaviour** change is. For a bug fix, describe the trigger, not just "fix issue".
- Run `node --check` and the suite before committing; the no-key mode should be at least 92 PASS / 0 FAIL.
- If the UI changed, update the matching image in `screenshots/`. Do not rename the files the README and `docs/` reference without updating the references.
- In a PR, state the motivation and how you verified it: what changed, what you ran, what you saw. A real screenshot helps.

## Never commit a key

- No key belongs in this repository. **Watch out for**: `apiKey` inside `%DSH_HOME%\agnes-image\settings.json`, the profile's `package.json.bak-agnes-image`, a key hardcoded in a scratch script, anything like `.env`.
- When a test needs a key, use the `AGNES_API_KEY` environment variable or the copy already saved in your local panel. Do not paste it into code, test files or a commit message.
- Check before you commit, from the repository root:

  ```powershell
  Select-String -Path .\* -Pattern 'sk-[A-Za-z0-9_-]{8,}'
  ```

  The hit count should be 0. Do not forget the images under `screenshots/` — a screenshot showing the key field filled in is a leak too.
- If a key ever reached the commit history, deleting the file is not enough: revoke the key first, then clean the history.
