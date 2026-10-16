# 配置

[English](configuration.en.md) · [文档索引](index.md)

## 设置项与默认值

`index.js` 里的 `Config` 是唯一的默认值来源，仓库里的 `cordis.patch.yml` 给出的就是这一份。

| 键 | 默认值 | 作用 | 面板能改 |
| --- | --- | --- | --- |
| `model` | `agnes-image-2.5-flash` | 图片模型 | 是 |
| `size` | `2K` | 默认尺寸 | 是 |
| `ratio` | `1:1` | 默认比例 | 是 |
| `timeoutMs` | `300000` | 单次 Agnes 请求超时；图片请求和视频创建共用 | 否 |
| `outputDir` | `''` | 输出根目录，空 = 当前会话工作区 | 是 |
| `historyLimit` | `200` | `history.json` 保留条数，写入时至少留 10 条 | 否 |
| `videoModel` | `agnes-video-2.5-flash` | 视频模型 | 否 |
| `videoSize` | `720P` | 视频默认分辨率 | 否 |
| `videoAspect` | `16:9` | 视频默认画幅 | 否 |
| `videoSeconds` | `5` | 视频默认时长（字符串） | 否 |
| `videoTimeoutMs` | `900000` | 整个视频任务的预算：创建 + 重试 + 排队 + 渲染 + 下载 | 否 |
| `videoPollMs` | `3000` | 轮询间隔。读取时下限 1000 | 否 |
| `videoQueueRetries` | `6` | 创建视频任务的重试次数。读取时下限 1 | 否 |
| `optimizeBackend` | `agnes` | 优化器后端，`agnes` 或 `dsh` | 是（在提示词框旁） |
| `optimizeModel` | `agnes-3.0-flash` | `agnes` 后端用的文本模型 | 是 |
| `optimizeMaxTokens` | `900` | 优化输出的 token 上限。读取时下限 64 | 否 |
| `optimizeTimeoutMs` | `120000` | 优化请求超时 | 否 |

取值规则是「面板优先」：面板存的值不是 `undefined`、`null` 或空字符串就用它，否则回落到 Config。面板的「设置」页签能写的是 `model`、`size`、`ratio`、`outputDir` 和 `optimizeBackend`；写设置的路由还接受 `videoModel`、`videoSize`、`videoAspect`、`videoSeconds`、`optimizeModel` 这些字符串键，以及 `videoTimeoutMs`、`videoPollMs`、`videoQueueRetries`、`optimizeMaxTokens`、`optimizeTimeoutMs` 这些数字键（必须是有限正数）。

要改 Config，改 profile 的 bundle 配置或仓库里的 `cordis.patch.yml`，然后重启 profile。

## 密钥

- Config 里没有 `apiKey`，也没有 `apiKeyEnv` 之类的字段。插件不内置任何凭据。
- 只有一个来源：面板「设置」页签，宿主把它写到 `%DSH_HOME%\agnes-image\settings.json` 的 `apiKey`。
- 宿主解析 key 时只读这个文件，返回 `{ value, source }`，`source` 是 `panel`（有 key）或 `none`。不读环境变量。
- `GET /api/agnes-image/status` 只回 `hasKey`、`keySource` 和掩码 `keyHint`（前 6 位 + `…` + 后 4 位）。完整 key 不出宿主进程，`client.js` 里也没有它。
- 清除：设置页签的清除按钮发 `{ clearApiKey: true }`，宿主删掉 `apiKey` 字段，其余设置保留。
- 没有 key 时，任何生成动作都报：

  ```
  No Agnes API key configured: open the panel Settings tab and save one first (the plugin ships without a key).
  ```

  提示词优化只在 `agnes` 后端需要 key；`dsh` 后端用 profile 自己的模型。

## 数据文件

数据目录是 `<home>\agnes-image\`。`home` 的取法是：`ctx.get('profileContext')?.home`，没有就 `process.env.DSH_HOME`，再没有就 `~\.dsh`。

| 文件 | 内容 |
| --- | --- |
| `settings.json` | `apiKey` 和面板改过的设置项 |
| `history.json` | 图片记录，新的在前 |
| `video-history.json` | 生成完成的视频记录，含封面路径 |
| `video-tasks.json` | 还没结束的视频任务，用于跨页面刷新续接 |

写入是原子的：先写 `<文件>.tmp-<pid>-<时间戳>`，再 rename 覆盖。中途断电不会留下半个 JSON。`history.json` 和 `video-history.json` 读取时如果不是数组就当空数组处理。

面板的设置页签会把数据目录的绝对路径显示出来，`/status`、`/history`、`/video-history` 也会回 `dataDir`。

## 输出目录

- `outputDir` 为空：落到当前会话的工作区。
- 相对路径：按会话 cwd 解析。
- 绝对路径：直接用。

会话 cwd 的优先级是：会话 header 里的 cwd（实时会话，权威）> 面板传来的绝对 cwd > 进程 cwd。工具调用走的是第一条，面板走第二条。

落盘位置：

- 图片：`<base>\agnes-images\YYYY-MM-DD\HHMMSS-<slug>.<ext>`。`slug` 取提示词前 32 个字符，空白和 Windows 非法字符换成 `-`，中文保留；纯 ASCII 出不来名字时退回 `image`。同名时依次加 `-2` 到 `-99`。
- 视频：`<base>\agnes-videos\...`，封面写成同目录的 `<MP4 名字>-cover.png`。

扩展名按上游 `content-type` 定：png / jpeg / webp / gif，认不出来时按 `.png` 存。

## 环境变量

插件只读一个环境变量：`DSH_HOME`，用来定位 home 目录，从而定位 `agnes-image` 数据目录。除此之外不读任何 Agnes 相关变量。

测试套件（不在插件运行时里）会看 `AGNES_API_KEY`，那是套件自己的取 key 顺序：先环境变量，再读面板那份 `settings.json`。
