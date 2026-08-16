# dsh-plugins

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugins-black)](https://github.com/deepseek-ai/deepseek-harness)

[English](README.md) | 中文

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件集。`packages/` 下每个包独立发到 npm、独立安装，彼此之间没有依赖。

## 插件列表

| 插件 | npm | 做什么 |
|---|---|---|
| [qwen-image](packages/qwen-image) | [`dsh-plugin-qwen-image`](https://www.npmjs.com/package/dsh-plugin-qwen-image) | 给纯文本模型装上眼睛。图片经 `ctx.llm` 交给视觉路由，回来的是文本，DeepSeek 继续当编码模型、千问只负责看图。它会自己找视觉路由，已经配过的 dsh 无需额外配置。 |
| [session-resources](packages/session-resources) | [`dsh-plugin-session-resources`](https://www.npmjs.com/package/dsh-plugin-session-resources) | 一个会话动过什么的账本：「资源」标签页列出它产出的文件和用作来源的文件，点一行即可打开。由工具的渲染意图折叠而来，不读磁盘；工作区之外的目录会被标出来。 |

## 安装

挑你要的那个包装上就行，仓库怎么组织对安装方没有影响：

```sh
dsh plugin --profile web add -w dsh-plugin-qwen-image
```

这里每个插件都**没有构建步骤**，所以安装时不会跑 `prepare`，pnpm 也不会要你把构建加白名单。那个许可等于「允许这个包在你机器上执行代码」，而这些包都不需要它。

带浏览器界面的插件，需要在每个想让它出现的 profile 里各装一次，桌面端也一样：

```sh
dsh plugin --profile desktop add -w dsh-plugin-session-resources
```

## 共同约定

仓库里每个包都守这几条：

- **只用公开能力缝。** 插件只碰 `ctx.tools`、`ctx.llm`、`ctx.fs`、`ctx.attachments` 这类公开接口，不碰 harness 内部实现。装进 profile 即可，不需要改 harness，也不需要重新打包桌面端。
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

改完某个包的源码后，用 `dsh plugin --profile web install` 刷新那份拷贝。

## 许可

[MIT](LICENSE)
