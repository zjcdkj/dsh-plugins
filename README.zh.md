# dsh-plugins

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugins-black)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集。`packages/` 下每个包独立发到 npm、独立安装，彼此之间没有依赖。

## 插件列表

| 插件 | npm | 做什么 |
|---|---|---|
| [qwen-image](packages/qwen-image) | [`dsh-plugin-qwen-image`](https://www.npmjs.com/package/dsh-plugin-qwen-image) | 给纯文本模型装上眼睛。图片经 `ctx.llm` 交给视觉路由，回来的是文本，DeepSeek 继续当编码模型、千问只负责看图。**直接往输入框粘贴截图也能用** —— 字节存进工作区而不是塞进对话，这正是纯文本路由依然肯收下这次请求的原因，而且输入框里的字一个都不会被改。它会自己找视觉路由，已经配过的 dsh 无需额外配置。 |
| [session-resources](packages/session-resources) | [`dsh-plugin-session-resources`](https://www.npmjs.com/package/dsh-plugin-session-resources) | 对话旁边的文件面板：会话工作区以目录树呈现、可逐层展开，本次会话产出的文件置顶，动过的每一行带一个圆点。点文件即打开；对话区会让出宽度而不是被盖住。 |

## 安装

挑你要的那个包装上就行，仓库怎么组织对安装方没有影响：

```sh
dsh plugin --profile web add -w dsh-plugin-qwen-image
```

这里每个插件都**没有构建步骤**，所以安装时不会跑 `prepare`，pnpm 也不会要你把构建加白名单。那个许可等于「允许这个包在你机器上执行代码」，而这些包都不需要它。

这两个插件都带浏览器界面，需要在每个想让它出现的 profile 里各装一次，桌面端也一样：

```sh
dsh plugin --profile desktop add -w dsh-plugin-qwen-image
dsh plugin --profile desktop add -w dsh-plugin-session-resources
```

## 共同约定

仓库里每个包都守这几条：

- **不改上游一行代码。** 只走公开能力缝 —— `ctx.tools`、`ctx.llm`、`ctx.fs`、`ctx.attachments`、`ctx.slots`、`ctx.connection.rpc`。装进 profile 即可，不需要改 harness，也不需要重新打包桌面端。

  **但「不改上游」不等于「你看不出来」，两个插件在这件事上差别很大**，说清楚比含糊过去有用：

  - `qwen-image` 加一个模型可见的工具，从 0.3.0 起还加了一个接管图片粘贴的浏览器半边。**在你粘图之前界面没有任何变化**；粘了之后，输入框上方会出现一条列出待读图片的条，没有待读图时它又整条消失。它始终不做的事是写输入框 —— 里面只有你自己敲的内容。粘到输入框以外的地方、或者只粘文字，都完全不碰；在通道不可达的部署里，所有粘贴也一律原样放行。
  - `session-resources` 会在会话头部加一个按钮，并且让对话主体让出宽度 —— 它的样式表确实落在宿主自己的节点上（靠 app 主动标注的 `data-conversation-scroll` 属性定位，不是靠会随构建变化的 class 哈希）。**顶部保持不动**：开关面板前后，标题行、`对话/轨迹` 标签、`Session log` 的位置一个像素都不变，让位的只有横线以下的滚动主体。
- **无构建步骤。** 宿主半边是纯 ESM，因此与 harness 共用同一个 cordis 实例，而不是自带一份副本；浏览器半边是手写的纯 JS，经应用自己的模块加载器载入，所以带界面也不需要打包器、同样不需要构建授权。
- **peer 范围从 `^0.1.0-rc.5` 起。** rc.5 与 rc.6 都能加载，包括仍停在 rc.5 的桌面端。
- **双语文档。** 每个包都带 `README.md` 和 `README.zh.md`。

## 本地开发

```sh
git clone git@github.com:zjcdkj/dsh-plugins.git
cd dsh-plugins
```

从检出目录直接安装某个包时**必须带 `file:` 前缀** —— 裸路径会走 pnpm 的 `link:` 语义，导致 peer 解析失败：

```sh
dsh plugin --profile web add -w "file:$PWD/packages/qwen-image"
```

pnpm 是链接而不是拷贝：profile 的 `node_modules` 里那个包目录是指向存储的 junction，里面每个文件是**指向你检出目录中同一个文件的硬链接**。所以就地改一个文件会同时到达所有 profile，不需要额外动作；**新增或删除文件**才需要重新链接（新文件还没有链接）：

```sh
dsh plugin --profile web install
```

另外，运行中的应用不会重读这些：浏览器刷新页面即可拿到新的客户端代码，宿主半边只在启动时加载一次，桌面外壳两边都在启动时加载。

## 许可

[MIT](LICENSE)
