# dsh-agnes-image 文档

[English](index.en.md)

DSH 插件，把 Agnes 的生图和视频接进 Harness。宿主半提供两个 Agent 工具和一组 HTTP 路由，客户端半是一个侧边栏面板。

仓库：<https://github.com/SZTMBABY/dsh-agnes-image>

## 装完得到什么

- `agnes_generate_image` 和 `agnes_generate_video` 两个工具，模型可以直接调用。
- 侧边栏一个面板，四个页签：图片生成、视频生成、库、设置。
- 图片和视频落到当前会话的工作区，分别在 `agnes-images\` 和 `agnes-videos\` 下，按日期分文件夹。
- 两个提示词输入框都带优化按钮，后端可以选 Agnes 的免费文本模型，也可以选当前 profile 自己的模型。

## 关于密钥

插件和这套文档都不带任何密钥。API key 只有一个来源：面板的「设置」页签，保存到 `%DSH_HOME%\agnes-image\settings.json`。插件不读任何 Agnes 相关的环境变量，仓库里也没有 key。

## 文档地图

| 文档 | 内容 |
| --- | --- |
| [install.md](install.md) | 安装、升级、回滚、headless、桌面手递手 |
| [usage.md](usage.md) | 两个工具怎么调，面板四个页签怎么用 |
| [configuration.md](configuration.md) | 设置项与默认值、密钥策略、数据文件、输出目录 |
| [architecture.md](architecture.md) | 宿主半和客户端半的分工、12 条路由、轮询重试、动效层 |
| [contributing.md](contributing.md) | 开发环境、测试套件、提交约定 |

中文文件名不带后缀，英文版是同名的 `.en.md`。

## 目录约定

| 路径 | 说明 |
| --- | --- |
| `index.js` | 宿主半。Agnes 调用、落盘、历史、路由、工具注册都在这里 |
| `client.js` | 客户端半。浏览器产物，没有构建步骤 |
| `cordis.patch.yml` | bundle 补丁层，声明 bundle 行 id 和默认配置 |
| `screenshots/` | README 和文档引用的截图 |
| `docs/` | 这套分节文档 |

面板的截图在文档里用相对路径引用，例如 `../screenshots/panel-images.png`。
