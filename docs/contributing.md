# 参与开发

[English](contributing.en.md) · [文档索引](index.md)

## 开发环境

这个仓库不依赖 npm 安装：`index.js` 是宿主半，`client.js` 是浏览器产物，没有构建步骤，也没有 `node_modules`。

开发机的 PATH 里可能没有 node。用 profile 自带的运行时：

```
%DSH_HOME%\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe
```

本文下面统一写成 `node`。本机实测是 v24.21.0。

## 改代码后的自检

```powershell
node --check index.js
node --check client.js
```

- 只用 `node --check` 过语法。它不做类型检查，也不读依赖，能过不代表逻辑对。
- 改了 `client.js`：宿主会重新组合 graph 并给出新的 rev，刷新页面就能拿到新代码（HMR 接收器生效时不用手动刷）。
- 改了 `index.js`：已加载的模块代不能热替换，必须重启 profile。
- 版本号在 `package.json` 的 `version` 和 `index.js` 里 `status()` 返回的 `version`（当前都是 `1.4.1`）两处，一起改。

## 端到端套件

开发机上有一套套件，跑真实的 `index.js`（以 `plugin.mjs` 的名字复制进测试目录），对着真实的 `@deepseek-ai/dsh-tools` 和 schemastery 跑，用假的 cordis `ctx` 对象；有 key 时会真的调 Agnes。

跑法：

1. 把 `index.js` 复制成测试目录里的 `plugin.mjs`。测试目录靠 junction 解析核心包，插件目录本身没有 `node_modules`。
2. 在测试目录里跑 `node run.mjs`。

结果（两种模式都实测过）：

| 模式 | 结果 |
| --- | --- |
| 没有 key | 92 PASS / 0 FAIL，6 段跳过（输出里是 7 行 `SKIP`，第一行是提示） |
| 有 key | 124 PASS / 0 FAIL / 0 SKIP |

取 key 的顺序：先看环境变量 `AGNES_API_KEY`，再读面板写的那份 `%DSH_HOME%\agnes-image\settings.json`。没有 key 就跳过所有真实上游调用，其余断言照跑。

没 key 时跳过的 6 段：工具真实调用、面板生成、设置优先级、按记录删除、`video-create` 载荷校验、提示词优化。

几点注意：

- **改了 `index.js` 之后必须重新复制 `plugin.mjs`**，不然套件测的还是旧的宿主半，会得到假绿。
- 有 key 的那几段真的会打 Agnes。网络抖动时会看到 `Agnes request failed: fetch failed` 这类失败，重跑即可，那是上游不是代码回归。
- 套件自己会往临时目录写 home 和工作区（`<tmp>\agnes-home-*`、`<tmp>\agnes-ws-*`），不碰真实数据目录。
- 最后一段断言校验的是客户端源码里的 CSS/DOM 行为（动效、进度条、封面卡片），headless 跑不出来，所以直接对着发出去的代码文本断言。

## 安装助手脚本（作者自用，不在仓库里）

作者开发机上的 `install-agnes.mjs` 做的是手动安装那两步：

1. 备份 profile 的 `package.json` 成 `package.json.bak-agnes-image`，已经存在就不覆盖。
2. 删掉 `<profile>\node_modules\dsh-agnes-image`，整树复制过去。
3. 把 `dsh-agnes-image` push 进 `dsh.profile.bundles`（已在列表里就跳过），用 2 空格缩进重写 `package.json`。

它需要 profile 目录的写权限；`dsh.profile.bundles` 不是数组时直接报错退出，避免写坏 profile。

## 提交约定

- 一个提交一件事。改行为、改文档、改截图分开提。
- 提交信息写清楚**行为**变了什么。修 bug 要写触发条件，别只写「修复问题」。
- 提交前跑一遍 `node --check` 和套件；套件没 key 的模式至少要是 92 PASS / 0 FAIL。
- UI 有变化就更新 `screenshots/` 里的对应图。README 和 `docs/` 引用的文件名不要改，改了要同步改引用。
- PR 说明动机和验证方式：改了哪里、跑了什么命令、看到什么结果。有实测截图更好。

## 绝对不要提交密钥

- 仓库里不该有任何 key。**特别注意**：`%DSH_HOME%\agnes-image\settings.json` 里的 `apiKey`、profile 的 `package.json.bak-agnes-image`、临时脚本里硬编码的 key、`.env` 之类，全部不要进版本库。
- 测试需要 key 时只用环境变量 `AGNES_API_KEY`，或者本机面板里存的那一份。不要写进代码、测试文件或提交信息。
- 提交前自查（在仓库根目录跑）：

  ```powershell
  Select-String -Path .\* -Pattern 'sk-[A-Za-z0-9_-]{8,}'
  ```

  命中数应该是 0。别忘了扫 `screenshots/` 下的图——截图里带上 key 输入框的内容也是泄露。
- 如果 key 已经进过提交历史，光删文件不够：先作废那把 key，再清理历史。
