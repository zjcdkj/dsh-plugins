# dsh-plugin-qwen-image

[![npm](https://img.shields.io/npm/v/dsh-plugin-qwen-image)](https://www.npmjs.com/package/dsh-plugin-qwen-image)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugin-black)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

**给纯文本模型装上眼睛。** 本地图片交给一条视觉路由，**回来的是文本** —— DeepSeek 继续当编码模型，千问只负责看图。

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

它取的是安装时写下的那个范围内的版本，而且不需要 `-w`。`0.x` 版本上 npm 的 caret 会停在下一个 minor 之前，所以 `^0.2.0` 能拿到 `0.2.x` 但拿不到 `0.3.0` —— 跨 minor 要重新执行一次安装命令。每个版本改了什么记在 [CHANGELOG.md](CHANGELOG.md)。

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

## 模型可见的工具

`qwen_image(file_path, question?)`

支持 PNG / JPEG / WebP / GIF。`question` 省略时做通用描述并逐字转录图中文字。相对路径锚在**调用方会话的工作区**，不是服务器的启动目录。

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

- **只读本地路径。** 不接受 URL 或剪贴板数据；网络图片请先落盘。
- **单张图。** 一次调用一张；多图请多次调用。
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
