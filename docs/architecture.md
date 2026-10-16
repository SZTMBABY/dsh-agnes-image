# 架构

[English](architecture.en.md) · [文档索引](index.md)

## 两半怎么分工

| | 宿主半 `index.js` | 客户端半 `client.js` |
| --- | --- | --- |
| 运行位置 | DSH 宿主进程 | 浏览器 |
| 拿得到的东西 | API key、文件系统、Agnes HTTP、会话 cwd | DOM、canvas、locale、slots |
| 负责 | 调用 Agnes、落盘、历史、两个 Agent 工具、12 条路由 | 侧边栏入口、整页面板、动效、i18n |
| 拿不到的东西 | — | API key（永远不进这个文件） |

浏览器产物没有构建步骤：`client.js` 就是 `window.__ModuleLoader__.load({ id: 'dsh-agnes-image', factory })` 里直接发出去的代码。

客户端请求用 `new URL(relative, document.baseURI)` 拼**文档相对**地址（`api/agnes-image/status` 这种，没有前导斜杠）。GUI 的 `<base href="./">` 可能带路径前缀，写成根绝对的 `/api/...` 会逃出前缀。图片和视频不走插件路由，直接用核心的 `api/file?path=<绝对路径>` 取。

路由注册走 `ctx.connection.fetch.register`，`/api` 前缀的鉴权和信任栅栏由它负责。不要改用 `ctx.webServer.register`，那条路绕过鉴权。注入声明里有 `connection`：没有 web 应用的 profile 会保持 pending，而不是半加载。服务缺失时只打一条警告：

```
connection service unavailable — panel routes not registered (agent tool still works)
```

## 路由表

前缀 `ROUTE = '/api/agnes-image'`，一共 12 条。每条都显式写了 `requestBody: 'buffered'`（原因见下一节）。

| 方法 | 路径 | 入参 | 出参 |
| --- | --- | --- | --- |
| GET | `/status` | — | `ok`、`hasKey`、`keySource`、`keyHint`、生效的设置、各枚举、`llmAvailable`、`llmRoute`、`dataDir`、`version` |
| GET | `/history?limit=60` | `limit` 夹到 1–500 | `items`、`dataDir` |
| POST | `/generate` | `prompt`、`size`、`ratio`、`count`、`referenceImages`（或 `reference_images`）、`sessionId`、`cwd` | `images`（绝对路径数组）、`baseDir` |
| POST | `/settings` | 见 [configuration.md](configuration.md) | 更新后的 `status` |
| POST | `/delete` | `file` | `ok` |
| POST | `/open` | `file`、`action`（`default` 或 `reveal`） | `ok`、`action`、`file` |
| POST | `/video-create` | 视频参数 | `task` |
| GET | `/video-status?videoId=` | `videoId` 必填 | 刷新后的 `task` |
| GET | `/video-history?limit=60` | `limit` 夹到 1–500 | `items`、`dataDir`、`videoDir` |
| POST | `/video-delete` | `file` | `ok` |
| POST | `/video-cover` | `file`、`dataUrl` | `cover`（PNG 的绝对路径） |
| POST | `/optimize` | `prompt`、`kind`、`backend`、`seconds`、`sessionId` | 重写后的文本、`usage`、`backend`、`notes` |

两条删除路由的安全边界一样：只有 `history.json` / `video-history.json` 里记录过的文件才肯删，否则回 404 `no history record for that file`。伪造的请求体到不了任意路径。`/video-cover` 同理，只认 `video-history.json` 里记录过的视频文件。

文字错误统一用 `{ ok: false, error: '...' }` 返回。

## 为什么每条路由都写 requestBody: 'buffered'（GET 也写）

`ConnectionFetchRoute.requestBody` 的类型是 `'buffered' | 'streaming'`，没有「不填」这一档。共享的 `/api` handler 把它原样传下去（`dsh-client-connection/lib/index.js:610-613`），而 HTTP 桥只对 `bodyMode === 'buffered'` 做特判；其它任何值都走 streaming 分支，用 `Readable.toWeb(req)` 造一个带 body 的 Request（同文件 `:43-81`）。

GET 和 HEAD 带 body 是非法的，`new Request(url, { method: 'GET', body })` 会在拿到任何响应之前就抛。浏览器最后只看到一个 400，没有 body，也没有 `content-type`，排查起来毫无线索。

所以 GET 路由也必须写 `requestBody: 'buffered'`。这是全文件重复 12 次的原因，不是模板残留。

## 视频：创建、轮询、重试

- 创建在 `/v1/videos`，轮询在站点根的 `/agnesapi`——没有 `/v1`。写错位置是 404，不是 400。
- 轮询要带 `video_id` 和 `model_name`。后者对 keyframe / reference 任务是必需的，text 任务也接受。
- 可重试状态：429、500、502、503、504。免费档的 `video_queue_full` 和 `video_queue_unavailable` 都落在这一组里。
- 创建阶段最多重试 `videoQueueRetries` 次（默认 6），退避是 `min(30s, 5s × 第几次)`。每次重试发一条 note，面板可见：

  ```
  Agnes video queue busy (HTTP 503: ...); retry 3/6 in 10s
  ```

  重试耗尽后错误里补一句「免费队列忙或限流，过一分钟再试」。
- 轮询阶段每个循环先睡 `videoPollMs`（3 秒），单次查询 60 秒超时。查询失败且标记为可重试时**不算**任务失败——继续等，因为轮询自己也会撞 429，而任务还在渲染。不可重试的错误直接抛。
- 整个任务的总预算是 `videoTimeoutMs`（900 秒），从创建算起。超时的错误是：

  ```
  Agnes video timed out after 900s (task <videoId> still <status>)
  ```

- 任务表落在 `video-tasks.json`，每个 videoId 记着它的 `baseDir`。页面关掉再打开，宿主继续轮询，渲染完把 mp4 下载到原来那个工作区，下载只做一次。这是「关掉页面再回来」仍然接得上的原因。
- 客户端自己的轮询节奏：提交后 4 秒第一次查，之后 5 秒一次；查询出错时改成 10 秒一次，不把一次抖动当失败。

## 封面抓帧链路

视频卡片折叠时也得有东西可看，但宿主不解码视频：作者的机器上没有 ffmpeg，核心包也没有宿主侧的缩略图服务。所以封面在浏览器里抓，再送回宿主存盘。

1. `grabFrame()` 造一个游离的 `<video>`，`muted` + `playsInline` + `preload='auto'`，加载完 seek 到 `min(0.2, duration / 2)` 秒。
2. `seeked` 后画到 canvas 上，宽度夹到 `min(videoWidth, 640)`，导出 PNG data URL。8 秒超时；编解码不支持、canvas 被污染、取不到宽高，一律返回空串。
3. 返回空串时卡片回落到浏览器给 `<video>` 元素画的那一帧，所以永远不会是空白。
4. `POST /api/agnes-image/video-cover`，带 `{ file, dataUrl }`。宿主校验：`dataUrl` 必须以 `data:image/png;base64,` 开头、解码后非空、不超过 6 MB；`file` 必须在 `video-history.json` 里有记录，否则 404。
5. 宿主把 PNG 写成 MP4 同目录的 `<名字>-cover.png`，同时更新历史行和任务行的 `cover` 字段。
6. 库刷新时最多给 3 条缺封面的记录补抓一次，`coverTried` 集合保证同一次会话里不会反复重试同一条。刷新页面会重置，抓失败的记录下次还会试。

## 动效层

全部是 CSS，没有 JS 测高度。

| 动效 | 参数 | 做法 |
| --- | --- | --- |
| 切页签 / 库里图片视频切换 | 450 ms，`cubic-bezier(.16,1,.3,1)`，位移 40 px | 新 body 从来的方向滑入：往后走从右边进，往回走从左边进。方向由 `TAB_ORDER` 里的下标决定 |
| 活动页签的胶囊高亮 | 同一条 450 ms 曲线 | 和 body 一起到位，高亮不会先到 |
| 卡片展开 / 收起 | 200 ms | `grid-template-rows` 从 `0fr` 到 `1fr`，子元素 `overflow:hidden; min-height:0`。不量高度，不额外布局 |
| 缩略图 / 封面 hover | 0.16 s | 放大 1.03×，加 2 px 橙色描边，提示可以双击 |
| 进度条不确定态 | 1.4 s 循环 | 38% 宽的段来回滑 |

滑入只动 `transform`，不做 opacity。从 `opacity: 0` 起手会让高页签闪一下约 100 ms 的裸面板底色——body 是重新挂载的，它下面没有不透明内容，那一闪就是切换感觉断掉的原因。完全不透明，靠位移就够了。

`prefers-reduced-motion: reduce` 里滑入动画、胶囊过渡、展开过渡、媒体过渡全部关掉；进度条的条纹换成静态满宽并降低不透明度。这是真实媒体查询，不是 JS 猜的。缩略图的 hover 提示在 reduced-motion 下只关过渡，描边和放大仍然生效，因为那是「这里能点开」的提示。

## 进度条

- 图片：接口没有百分比通道，所以是不确定条纹加已用秒数。不编数字。
- 视频：用上游真实百分比，宽度过渡 0.45 s，状态和已用秒数一起显示。
- `VIDEO_STALL_MS = 12000`：报告的百分比超过 12 秒没动（按上游约 4 秒一轮，大概三轮），条纹改成流动样式，文案变成

  ```
  上游只报到 10%，仍在渲染 · 已用 132 秒
  ```

  它说的是数字的来源，而不是假装在动。上游跳到 70 或 100 时立刻切回真实填充。

## i18n

命名空间是 `dsh-agnes-image`，`client.js` 里同时内置中文和英文两套字典，各 99 个键。注册走 `ctx.locale.register(NS, DICT)`，绑定失败时退回英文兜底字典 `DICT.en[key] ?? key`，面板至少还能看懂。

带变量的文案用占位符，例如停滞提示用 `{progress}` 和 `{seconds}`，宿主侧不参与翻译：宿主只发状态和数字，措辞在客户端。

## CTA 配色

主按钮的填充是 `#ff7700`，hover `#e86b00`，active `#d96100`，文字 `#1f1300`（深棕）。

深色文字在橙底上的对比度：常态约 6.9:1，hover 约 5.7:1，active 约 4.9:1，三档都过 WCAG AA 的 4.5:1。同一个橙色底配白字只有约 2.7:1，这是这里用深色而不是白色文字的原因。

hover 和 active 需要真伪类，所以放在一个按需注入的 `<style>` 里（和核心客户端产物同一个写法）；填充色同时内联写一遍，注入被挡也能渲染出一个橙色按钮。焦点环用核心的 `--dsw-focus-ring-width` 变量（缺省 2 px）。
