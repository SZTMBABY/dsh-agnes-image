# 安装

[English](install.en.md) · [文档索引](index.md)

## 前置

- DSH 桌面版，或者任何带 web 应用的 profile。
- 插件要写 `%DSH_HOME%\agnes-image\` 下的数据文件，所以该目录要可写。
- 插件的 `inject` 是 `['tools', 'connection']`。没有 web 应用的 profile 里没有 `connection` 服务，插件会保持 pending，连工具也不会注册。这种场景见下面的 headless 一节。

## 方式一：plugin_manager 的 install_bundle

在会话里让 agent 调 `install_bundle`，指向插件目录。它做两件必要的事：把包复制进 `<profile>\node_modules\`，把包名登记进 profile 的 `dsh.profile.bundles`；另外还会跑 pnpm 的登记动作（lockfile 和 workspace 文件）。完成后重启 profile。

## 方式二：手动复制

和 `install_bundle` 的两步一样，只是少了 pnpm 的记账（`_sztm-tooling/tmp/install-agnes.mjs` 的注释里就是这么描述的）。

1. 把插件目录整个复制到 `%DSH_HOME%\profiles\<profile>\node_modules\dsh-agnes-image`。
2. 把 `"dsh-agnes-image"` 追加到 `%DSH_HOME%\profiles\<profile>\package.json` 的 `dsh.profile.bundles` 数组里。
3. 重启 profile。

```powershell
$dsh = if ($env:DSH_HOME) { $env:DSH_HOME } else { "$env:USERPROFILE\.dsh" }
$profile = "$dsh\profiles\desktop"          # 换成自己的 profile 名
Copy-Item .\dsh-agnes-image "$profile\node_modules\dsh-agnes-image" -Recurse -Force
# 再把 "dsh-agnes-image" 加进 $profile\package.json 的 dsh.profile.bundles
```

注意：以后在 profile 里跑 `pnpm install`，未登记的 `node_modules` 目录可能被清掉。重跑上面的复制，或者用 `pnpm add <本目录绝对路径>` 正式登记。

### 用脚本做上面两步

`_sztm-tooling/tmp/install-agnes.mjs` 把这两步写成了脚本：先把 profile 的 `package.json` 备份成 `package.json.bak-agnes-image`（已存在就不覆盖），删掉旧的 `node_modules\dsh-agnes-image`，整树复制，再把包名写进 `dsh.profile.bundles`。它需要 profile 目录的写权限；写入前会检查 `dsh.profile.bundles` 确实是个数组，不是就直接报错。

## 升级

覆盖 `node_modules\dsh-agnes-image` 里的文件（或重跑 install_bundle / `pnpm add`），然后重启 profile。

版本号写在两处：`package.json` 的 `version`，和 `index.js` 里 `status()` 返回的 `version`。当前都是 `1.4.0`，改版本时两处要一起改，`/status` 是面板显示的那一份。

宿主半改动必须重启 profile，已加载的模块代不能热替换。客户端半（`client.js`）改动只要刷新页面，宿主会重新组合 graph 并给出新的 rev。

## 回滚（三步）

1. 从 `%DSH_HOME%\profiles\<profile>\package.json` 的 `dsh.profile.bundles` 里删掉 `"dsh-agnes-image"`。
2. 删掉 `%DSH_HOME%\profiles\<profile>\node_modules\dsh-agnes-image`。
3. 重启 profile。

插件自带的 `cordis.patch.yml` 只被它自己的补丁层引用，bundle 从列表里移除后就失效了。profile 自己的 `cordis.patch.yml` 没有被这个插件改过，不用动。数据文件在 `%DSH_HOME%\agnes-image\`，回滚插件不会删它们，需要的话手动清理。

## headless 场景

没有 web 应用的 profile 里，`connection` 服务不存在，插件保持 pending，`/api/agnes-image/*` 路由不会注册，两个工具也不会注册——因为工具注册和路由注册在同一个 `apply()` 里。

只用工具的话，把 `index.js` 的

```js
export const inject = ['tools', 'connection']
```

改成 `['tools']`。这样插件不依赖 `connection`，工具能注册，路由仍然不可用（面板也没有），这是预期的。没注册路由时宿主会打一条警告：`connection service unavailable — panel routes not registered (agent tool still works)`。

## 桌面手递手

「打开文件」和「在文件夹中显示」在宿主侧走 `POST /api/agnes-image/open`。宿主先 `stat` 一次确认文件确实还在，再问 `canOpenNativePath()`：

- Windows 上把文件 URI 交给 explorer.exe，和资源管理器里双击的解析方式一致。
- 没有桌面会话的宿主返回 `this host cannot open local files (<platform>)`。
- 调用带 30 秒超时。

所以这一项依赖宿主真的有桌面会话；headless 或用工具驱动的宿主上，只能拿到文件路径，自己处理。
