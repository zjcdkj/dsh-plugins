# dsh-plugin-qwen-image

[![npm](https://img.shields.io/npm/v/dsh-plugin-qwen-image)](https://www.npmjs.com/package/dsh-plugin-qwen-image)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-black)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

**给纯文本模型装上眼睛。** 图片交给一条视觉路由，**回来的是文本** —— DeepSeek 继续当编码模型，千问只负责看图。**直接往输入框粘贴截图也能用**，而且输入框里的文字一个字都不会被改。

```sh
dsh plugin --profile web add -w dsh-plugin-qwen-image
```

![在 DeepSeek 会话里用 qwen_image 读一张幻灯片](https://raw.githubusercontent.com/zjcdkj/dsh-plugins/main/packages/qwen-image/assets/demo.png)

## 安装

**`-w` 是必需的。** profile 目录是个 pnpm workspace 根，不带 `-w` 时 pnpm 会以 `ERR_PNPM_ADDING_TO_ROOT` 拒绝，什么都不会装上。

**装的时候不索要构建授权。** 纯 ESM 无构建步骤，所以没有 `prepare` 脚本。pnpm ≥10 会拦下 git 依赖的构建，直到你显式加白名单 —— 而那个许可等于「允许这个包在安装时于你机器上执行代码」。本包从不索要它。

**rc.5 和 rc.6 都能装。** peer 范围写的是 `^0.1.0-rc.5`，所以在当前版本和仍停在 rc.5 的旧桌面端里都能加载。

之后更新：

```sh
dsh plugin --profile web update dsh-plugin-qwen-image
```

它取的是安装时写下的那个范围内的版本，而且不需要 `-w`。`0.x` 版本上 npm 的 caret 会停在下一个 minor 之前，所以 `^0.3.0` 能拿到 `0.3.x` 但拿不到 `0.4.0` —— 跨 minor 要重新执行一次安装命令。每个版本改了什么记在 [CHANGELOG.md](CHANGELOG.md)。

## 一条视觉路由

这个工具需要一个能吃图的模型。

**如果你的 dsh 里已经有了，那就不用配任何东西。** 首次调用时插件先试它被指向的那条路由；那条不可用时，它会扫描所有已注册的 provider，取第一个声明了图片输入的模型，并记录选中了谁。扫描按 provider 拓扑做一次，不是每次调用都做。

一个都没有的话，在 `$DSH_HOME/settings.yaml` 里声明一条：

```yaml
llm-pi-ai:
  providers:
    dashscope:
      displayName: 通义千问 DashScope
      apiKeyEnv: DASHSCOPE_API_KEY
      api: openai-completions
      baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
      models:
        - id: qwen3-vl-plus
          name: Qwen3-VL Plus
          input: [text, image]        # ← 关键：没有这行，模型只声明 [text]
```

Key 放进 `$DSH_HOME/.credentials.yaml`，托管凭据不会进 `process.env`：

```yaml
DASHSCOPE_API_KEY: sk-...
```

`input: [text, image]` 是整件事的开关。漏了这行的模型条目会被报成只接受文本，插件不会选它 —— 能力未知按「没有」处理而不去猜，因为猜错会把一个配置问题变成 provider 的 `400`。路由级的 `defaultInput: [text, image]` 同样有效，适合那种所有模型都能吃图的网关。

也可以在 **设置 → 模型 → 添加自定义提供方** 里用 UI 完成同样的事，key 由 UI 只写存入。它生成的 provider id **不必**叫 `dashscope`，扫描一样能找到。

如果所有 provider 都没有模型声明图片输入，调用会失败，并报出它找过哪条路由、扫了哪些 provider、以及要补的那段配置 —— 而不是一个光秃秃的错误码。

## 粘贴截图

**粘贴或拖进来，然后照常提问就行。**

不装这个插件时，这件事会失败，而且是**晚失败**：应用先把图收进自己的图片轨道，你点发送，然后宿主拒掉整个请求 —— 「当前模型不支持图片」。问题从来不是图片，而是把图片放进了对话里。

所以这个插件在应用看到之前就把这次粘贴接走：图片存进 `<工作区>/.dsh-pasted/`，同时在运行时上下文里说明「有一张图在等你读」。**对话内容里依然没有图片部件，这正是请求能过去的原因。**

输入框上方会出现一条「待读图片」，带缩略图和一个移除按钮。没有待读图时这条**完全不存在**。

几条明确的边界：

- **不写输入框。** 不会塞路径、不会替你打字。输入框里始终只有你自己写的内容。
- **图文混着粘也行。** 图片走插件通道，文字**原样交还**给应用，效果和单独粘任一个一样。
- **只在输入框区域生效。** 粘到会话搜索框之类的地方不受影响；只有文字的粘贴也不受影响。
- **通道不通就完全不介入。** 浏览器半边会先探测通道，探测成功前（以及在没有宿主半边的部署里）应用自带的粘贴行为一点没变 —— 接走一次自己完不成的粘贴，等于白白毁掉剪贴板内容。
- **读过就不再提示，但文件留着。** 模型读完后这张图从待读列表消失，文件仍在工作区里，你随时能打开，模型也能再传同一个路径。点移除按钮才会删文件。
- 每个会话最多留 8 张，最多跟踪 64 个会话，淘汰时连文件一起删。

存下来的文件名**完全由宿主生成**：调用方只能给字节和媒体类型，给不了路径也给不了文件名，所以这条通道没有路径穿越面。在此之上它还是 `authority: 'loopback'`，只有本机页面能调。单图字节上限取自 `ctx.attachments.imageLimits`，所以这里收下的图，后面那次视觉请求一定装得下。

CLI 或无头部署不受影响：`connection`、`sessions`、`systemPrompt` 都是可选子，没有浏览器就只有工具本身，没有粘贴这一路。

## 模型可见的工具

`qwen_image(file_path?, question?)`

支持 PNG / JPEG / WebP / GIF。`question` 省略时做通用描述并逐字转录图中文字。相对路径锚在**调用方会话的工作区**，不是服务器的启动目录。

**`file_path` 可以省略** —— 省略时读本会话最近粘贴的那张图。没有待读图时省略会报错，并说明原因。

返回解析后的路径、实际应答的视觉模型、以及该模型的文本回答。

## 为什么不用内置的 `read_image`

内置 `read_image` 把图片放进**会话自己的**路由，所以要求那条路由本身能吃图。DeepSeek 不能，于是直接拒绝。

本插件反过来：图片走一条独立的视觉路由，只有**文字**回来。调用方模型完全不需要任何多模态能力。

它只使用公开的能力缝 —— `ctx.tools`、`ctx.llm`、`ctx.fs`、`ctx.attachments` —— 因此装进 profile 即可，**不需要改动 harness 本身，也不需要重新打包桌面端**。

## 配置

安装后这个包就在 profile 的 `dsh.profile.bundles` 里，它自带的 bundle patch **已经插入了** `qwen-image` 这一行。要改配置，在 profile 的 `cordis.patch.yml` 里**按 id 覆盖**它：

```yaml
- id: qwen-image
  name: dsh-plugin-qwen-image      # 可选断言：名字不匹配就跳过并告警
  config:
    provider: dashscope
    model: qwen3-vl-flash
```

别再写一遍 `insert:` —— 同一个 id 插两次会让启动直接失败（`duplicate loader entry id`）。另外 `config` 是**整体替换**而非深合并，所以要偏离默认值的字段都得写全。

| 字段 | 默认 | 说明 |
|---|---|---|
| `provider` | `dashscope` | 首选 provider id；不可用时回退到任意发现到的视觉路由 |
| `model` | `qwen3-vl-plus` | 首选视觉模型 id；回退方式同上 |
| `systemPrompt` | 见源码 | 发给视觉模型的 system 提示 |
| `maxOutputTokens` | `1024` | 视觉模型回答的输出上限 |
| `timeoutMs` | `120000` | 单次调用的协作式超时预算 |

`provider` 与 `model` 是首选而非硬要求：指向一条不存在的路由只会多一条日志，不会失败。想锁定某个具体模型时再填你确实有的那条 —— 配了多条视觉路由时，扫描取的是第一条注册的，那是部署自己的顺序，未必是你想要的那条。

## 已知限制

- **不读 URL。** 网络图片请先落盘（粘贴和拖入是支持的，见上）。
- **单张图。** 一次调用一张；多图请多次调用。
- **待读列表在内存里。** 宿主重启后它就没了 —— 字节还在盘上，但那条「有图在等你读」的提示不再出现。代价是重新粘一次，换来的是不往一份本插件并不拥有的会话日志里写东西。
- **待读条消失有几秒延迟。** 浏览器半边靠轮询感知宿主那边已经读过（只在有待读图时轮询，列表一空就停），所以模型读完到 chip 消失之间有一小段时间差。
- **不做重试。** 视觉路由的瞬时失败原样抛出；重试策略属于路由自己的 `retryPolicy`。
- **上限由部署决定。** 单图字节上限取 `ctx.attachments.imageLimits` 的两个界的较小值，本插件不自设阈值。
- **路由失效要等到下一次拓扑变化才被发现。** 解析结果会缓存到 harness 报告 provider 发生变化为止，所以吊销一个凭据表现为那个 provider 自己的失败，而不是自动切换。

## 设计要点

**图片不进调用方的上下文。** 工具返回的是纯文本，所以调用方模型无需任何多模态能力。这是本插件与 `read_image` 的根本区别。

**能力检查针对视觉路由，而非会话路由。** 且在任何 I/O 之前完成，避免配错时先写下一个附件。

**图片经 `ctx.attachments` 持久提交。** `ImageBlock` 携带的是耐久附件引用而非裸字节，所以这一步是必须的，也顺带让请求可重放。

**文件经 `ctx.fs` 读取，不用 `node:fs`。** 这样沙箱与远程执行世界自动跟随 —— 把 fs provider 指向远程沙箱，本插件一起搬过去。

**相对路径锚在会话工作区，不是服务器启动目录。** 解析时带上 `exec.agent.session.header.cwd`（`..` 穿越时先做 canonical），与内置文件工具一致。少了这一步，`slide_05.png` 会被解析到 dsh 进程的 cwd 去。

**声明 `kind: 'read'` + `locations`。** 资源/交付物类面板据此把这张图计入「来源」，无需认识本工具的名字。

**粘贴在浏览器侧接走，而不是在宿主侧改消息。** 宿主那边没有可用的缝：`intercept('/api', …)` 是全局单一名额，已被 API 网关占用；提交前也没有钩子能改写消息内容。而浏览器侧只要在捕获阶段接住事件即可 —— 应用自己的处理是 textarea 上的 React `onPaste` 加一个 document 级 `drop`，都比捕获阶段晚。

**用运行时上下文，而不是提示词段落。** 「现在有张图在等你读」是关于此刻的事实，不是人格设定：宿主每次装配都会重述它，并让新快照取代旧快照，所以待读列表一空，这段文字自己就消失了。

**一次全局注册，按会话给出不同内容。** `AssembleContext` 带着本次装配的 `agent`，所以 `text` 函数直接用 `context.agent.id` 查该会话的待读列表就够了 —— 不需要监听 `agent/created` 去为每个会话各注册一次。

**不改输入框是硬约束。** 另一条能让粘贴「可用」的路子是把图片落盘后往输入框里塞一行路径文字（消息里就没有图片部件了，宿主的门自然不触发）。本插件不走这条：输入框是你的，插件不往里写字。图文混排时那半段文字之所以被原样交还，也是同一个原因 —— 那些字符是你自己的剪贴板内容，去了你本来要它们去的地方。

## 本地开发

从本地检出安装时**必须带 `file:` 前缀**：

```sh
dsh plugin --profile web add -w "file:/path/to/dsh-plugins/packages/qwen-image"
```

**别用裸路径。** 裸目录路径走 pnpm 的 `link:` 语义，装出来是个符号链接；Node 按**真实路径**向上找 `node_modules`，于是走不到 profile 的 peer 目录，插件加载时报 `Cannot find package '@deepseek-ai/schemastery'`。`file:` 则把包放进 profile 的 `node_modules` 树内（目录是指向 pnpm 存储的 junction，里面每个文件是指向你检出目录的硬链接），peer 解析才能沿父目录命中 `$DSH_HOME/profiles/node_modules` 这个安装级回退目录。

新增或删除文件后重新链接（就地编辑现有文件不需要，硬链接会同时到达）：

```sh
dsh plugin --profile web install
```

## 许可

[MIT](LICENSE)
