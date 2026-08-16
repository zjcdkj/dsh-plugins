# dsh-plugins

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugins-black)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Each package under `packages/` is published to npm on its own and installs independently — nothing here requires the others.

## Plugins

| Plugin | npm | What it does |
|---|---|---|
| [qwen-image](packages/qwen-image) | [`dsh-plugin-qwen-image`](https://www.npmjs.com/package/dsh-plugin-qwen-image) | Gives a text-only coding model eyes. A local image goes to a vision route through `ctx.llm` and comes back as text, so DeepSeek keeps driving the session while Qwen does the looking. It finds a vision route on its own, so a dsh that already reaches one needs no configuration. |
| [session-resources](packages/session-resources) | [`dsh-plugin-session-resources`](https://www.npmjs.com/package/dsh-plugin-session-resources) | A ledger of what one session touched: a Resources tab listing the files it produced and the files it used as sources, click to open. Folded from tool render intent rather than by reading the disk, and directories outside the session workspace are flagged. |

## Install

Pick the package you want; the repository layout does not matter to the installer:

```sh
dsh plugin --profile web add -w dsh-plugin-qwen-image
```

Every plugin here ships **with no build step**, so no `prepare` script runs at install time and pnpm never asks you to allowlist a build. That allowance is permission to execute a package's code on your machine, and none of these packages need it.

A plugin that contributes browser UI also needs installing into each profile that should show it, the desktop shell included:

```sh
dsh plugin --profile desktop add -w dsh-plugin-session-resources
```

## House rules

These hold for every package in this repository:

- **Public seams only.** Plugins touch `ctx.tools`, `ctx.llm`, `ctx.fs`, `ctx.attachments` and friends — never harness internals. Installing one into a profile needs no change to the harness and no desktop rebuild.
- **No build step.** Host halves are pure ESM, so the harness's own cordis instance is shared rather than duplicated. Browser halves are hand-written plain JS loaded through the app's own module loader, so shipping UI costs no bundler and no build authorization either.
- **Peer range starts at `^0.1.0-rc.5`.** Plugins load on rc.5 and rc.6 alike, including desktop shells still pinned to rc.5.
- **Bilingual docs.** Every package carries `README.md` and `README.zh.md`.

## Development

```sh
git clone git@github.com:zjcdkj/dsh-plugins.git
cd dsh-plugins
```

Install a package straight from the checkout with the `file:` prefix — a bare path takes pnpm's `link:` semantics and breaks peer resolution:

```sh
dsh plugin --profile web add -w "file:$PWD/packages/qwen-image"
```

After editing a package, refresh that copy with `dsh plugin --profile web install`.

## License

[MIT](LICENSE)
