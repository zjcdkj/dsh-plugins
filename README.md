# dsh-plugins

[![license](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-plugins-black)](https://github.com/deepseek-ai/deepseek-harness)

English | [中文](README.zh.md)

Plugins for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Each package under `packages/` is published to npm on its own and installs independently — nothing here requires the others.

## Plugins

| Plugin | npm | What it does |
|---|---|---|
| [qwen-image](packages/qwen-image) | [`dsh-plugin-qwen-image`](https://www.npmjs.com/package/dsh-plugin-qwen-image) | Gives a text-only coding model eyes. An image goes to a vision route through `ctx.llm` and comes back as text, so DeepSeek keeps driving the session while Qwen does the looking. **Pasting a screenshot into the composer works** — the bytes are stashed in the workspace instead of the conversation, which is why a text-only route still accepts the request, and your draft is never written to. It finds a vision route on its own, so a dsh that already reaches one needs no configuration. |
| [session-resources](packages/session-resources) | [`dsh-plugin-session-resources`](https://www.npmjs.com/package/dsh-plugin-session-resources) | A file panel beside the conversation: the session's workspace as a tree you can walk, the files this session produced pinned above it, and a dot on every row it touched. Click a file to open it; the conversation makes room rather than being covered. |

## Install

Pick the package you want; the repository layout does not matter to the installer:

```sh
dsh plugin --profile web add -w dsh-plugin-qwen-image
```

Every plugin here ships **with no build step**, so no `prepare` script runs at install time and pnpm never asks you to allowlist a build. That allowance is permission to execute a package's code on your machine, and none of these packages need it.

Both plugins here contribute browser UI, so each needs installing into every profile that should show it, the desktop shell included:

```sh
dsh plugin --profile desktop add -w dsh-plugin-qwen-image
dsh plugin --profile desktop add -w dsh-plugin-session-resources
```

## House rules

These hold for every package in this repository:

- **Not one line of upstream changes.** Public seams only — `ctx.tools`, `ctx.llm`, `ctx.fs`, `ctx.attachments`, `ctx.slots`, `ctx.connection.rpc`. Installing one into a profile needs no change to the harness and no desktop rebuild.

  **"Changes nothing upstream" is not the same as "you cannot tell it is there", and the two differ sharply on that** — worth saying plainly rather than glossing:

  - `qwen-image` adds one model-facing tool, and since 0.3.0 a browser half that claims image pastes. **Until you paste an image the interface is unchanged**; when you do, one strip appears above the composer listing what is waiting, and it goes away again when nothing is. What it never does is write to the composer — the draft holds only what you typed. A paste outside the composer, or one carrying only text, is left alone entirely, and so is every paste on a deployment where its channel is unreachable.
  - `session-resources` adds a button to the session header and makes the conversation body give up width — its stylesheet does land on one of the app's own nodes, found by the `data-conversation-scroll` attribute the app puts there on purpose rather than by a class name that changes with every build. **The header never moves**: the title row, the conversation tabs and `Session log` sit at the same pixel whether the panel is open or closed, and only the scrolling body below the rule makes room.
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

pnpm links rather than copies: the package directory in the profile's
`node_modules` is a junction into the store, and each file inside it is a **hard
link to the file in your checkout**. Editing one in place therefore reaches every
profile with no further step; **adding or deleting** a file is what needs a
re-link, since a new file has no link yet:

```sh
dsh plugin --profile web install
```

A running app re-reads none of this. The browser picks up a client change on
reload, the host half is loaded once at boot, and the desktop shell loads both at
startup.

## License

[MIT](LICENSE)
