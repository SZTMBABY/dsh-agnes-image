# Install

[中文](install.md) · [Docs index](index.en.md)

## Before you start

- DSH desktop, or any profile that has the web app.
- The plugin writes into `%DSH_HOME%\agnes-image\`, so that directory has to be writable.
- The plugin's `inject` is `['tools', 'connection']`. A profile without the web app has no `connection` service, so the plugin stays pending and even the tools never register. See the headless section below.

## Option 1: plugin_manager's install_bundle

Ask the agent to call `install_bundle` with the plugin directory. It does the two things that matter — copies the package into `<profile>\node_modules\` and adds the package name to the profile's `dsh.profile.bundles` — plus the pnpm bookkeeping (lockfile and workspace file). Restart the profile when it finishes.

## Option 2: copy it by hand

The same two steps as `install_bundle`, minus the pnpm bookkeeping. The comment at the top of the helper script `_sztm-tooling/tmp/install-agnes.mjs` describes it the same way.

1. Copy the whole plugin directory to `%DSH_HOME%\profiles\<profile>\node_modules\dsh-agnes-image`.
2. Append `"dsh-agnes-image"` to the `dsh.profile.bundles` array in `%DSH_HOME%\profiles\<profile>\package.json`.
3. Restart the profile.

```powershell
$dsh = if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }
$profile = "$dsh\profiles\desktop"          # use your own profile name
Copy-Item .\dsh-agnes-image "$profile\node_modules\dsh-agnes-image" -Recurse -Force
# then add "dsh-agnes-image" to $profile\package.json -> dsh.profile.bundles
```

One gotcha: a later `pnpm install` inside the profile can prune an unregistered directory in `node_modules`. Re-run the copy, or use `pnpm add <absolute path to this directory>` so pnpm records it properly.

### The same two steps as a script

`_sztm-tooling/tmp/install-agnes.mjs` does the two steps for you: back up the profile's `package.json` to `package.json.bak-agnes-image` (skipped if that file already exists), delete any old `node_modules\dsh-agnes-image`, copy the tree, then push the package name into `dsh.profile.bundles`. It needs write permission on the profile directory, and it verifies that `dsh.profile.bundles` really is an array before writing anything.

## Upgrade

Overwrite the files in `node_modules\dsh-agnes-image` (or re-run install_bundle / `pnpm add`), then restart the profile.

The version appears in two places: `version` in `package.json`, and the `version` field `status()` returns in `index.js`. Both currently say `1.4.0`. Bump them together — `/status` is what the panel displays.

Host-half changes always need a profile restart; a loaded module generation cannot be hot-replaced. Client-half (`client.js`) changes only need a page refresh: the host recomposes the graph and serves a new rev.

## Rollback, three steps

1. Remove `"dsh-agnes-image"` from `dsh.profile.bundles` in `%DSH_HOME%\profiles\<profile>\package.json`.
2. Delete `%DSH_HOME%\profiles\<profile>\node_modules\dsh-agnes-image`.
3. Restart the profile.

The plugin's own `cordis.patch.yml` is only referenced by its own patch layer, so it stops applying once the bundle leaves the list. The profile's own `cordis.patch.yml` is never touched by this plugin. Your data lives in `%DSH_HOME%\agnes-image\` and is not removed by a rollback — delete it yourself if you want it gone.

## Headless

In a profile without the web app there is no `connection` service, so the plugin stays pending: no `/api/agnes-image/*` routes and no registered tools, because both happen in the same `apply()`.

To use the tools only, change this line in `index.js`:

```js
export const inject = ['tools', 'connection']
```

to `['tools']`. The plugin then loads without `connection`, the tools register, and the routes stay unavailable (and so does the panel). That is expected. With no routes registered the host logs:

```
connection service unavailable — panel routes not registered (agent tool still works)
```

## Desktop hand-off

"Open with default app" and "Reveal in folder" go through `POST /api/agnes-image/open`. The host `stat`s the file to confirm it still exists, then asks `canOpenNativePath()`:

- On Windows it hands the file's URI to explorer.exe, the same resolution a double-click in a folder window uses.
- A host with no desktop session returns `this host cannot open local files (<platform>)`.
- The call has a 30 second timeout.

So this depends on the host actually having a desktop session. On a headless or tool-driven host you get the file path and nothing more.
