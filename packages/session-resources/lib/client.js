/**
 * dsh-plugin-session-resources — browser half.
 *
 * A collapsible right-hand panel listing two things about the current session:
 * the files it PRODUCED and the files it used as SOURCES. A button in the
 * session header's utility row opens and closes it, so the panel sits beside
 * the conversation instead of replacing it — you keep reading while the
 * artifacts stay in view.
 *
 * Both lists are folded from render intent the tool events already carry, so
 * nothing here scans a disk, sends a request, or asks the model for anything.
 *
 * Why a floating panel rather than a real reflowing column: the frame's right
 * column is the `details` slot, which is `kind: 'single'` and already occupied
 * by the conversation package's DetailsPanel. Registering there would replace
 * that panel and take the tool-details seat it declares down with it — trading
 * away a shipped feature to add one. `shell.overlay` is the seat the frame
 * documents as "the additive seat for a frame-wide surface of your own", and it
 * is positioned against the frame rather than the viewport, so a desktop
 * window's title bar and its controls stay clear.
 *
 * Loaded by the DSH web app through this package's `dsh.client` declaration
 * (see package.json) and registered as an ordinary Cordis client plugin. The
 * file is hand-written plain JS on purpose: the module loader hands the factory
 * a `require` for host-provided modules, so there is nothing to bundle and
 * installing never asks for build permission.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-session-resources',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    /**
     * Every identifier this package owns is prefixed rather than named
     * `resources`. A dictionary namespace, a view target and a slot entry id
     * are global keys; taking the bare word would collide with any other
     * plugin — or a future in-box feature — that reaches for the obvious name.
     */
    const NS = 'session-resources'
    const TARGET = 'session-resources'
    const KIND = 'session-resource-call'

    // ---------------------------------------------------------------- copy

    const zh = {
      'panel.title': '资源',
      'panel.open': '打开资源面板',
      'panel.close': '收起资源面板',
      'panel.resize': '拖动调整面板宽度（方向键也可）',
      'section.produced': '产出',
      'section.consulted': '来源',
      'section.count': '{count} 个文件',
      'empty.all': '本会话还没有产生文件资源',
      'empty.produced': '暂无产出文件',
      'empty.consulted': '暂无来源文件',
      'list.aria': '会话文件资源',
      'tree.aria': '工作区文件',
      'tree.filter': '筛选文件…',
      'tree.filter.clear': '清除筛选',
      'tree.openRoot': '打开工作区文件夹',
      'tree.reload': '重新读取',
      'tree.loading': '读取中…',
      'tree.empty': '这个文件夹是空的',
      'tree.truncated': '目录过大，仅显示前 {count} 项',
      'tree.error': '无法读取：{reason}',
      'tree.noMatch': '没有匹配的文件',
      'tree.expand': '展开 {name}',
      'tree.collapse': '收起 {name}',
      // Said once, plainly, instead of leaving an empty panel: the tree needs a
      // directory read this deployment cannot serve, so the session's own file
      // list stands in for it.
      'tree.unavailable': '此部署无法列出工作区文件，下面是本次会话动过的文件',
      'output.title': '本次产出',
      // The dot's tooltip carries what the row used to spell out. The tools are
      // still worth having; they were not worth the width they took beside a
      // filename that is what the reader came for.
      'mark.produced': '本次会话产出 · {tools}',
      'mark.consulted': '本次会话读取 · {tools}',
      // The verb is the app's own, from its produced-file row; the name is added
      // because a list repeats this control on every entry, and six identically
      // named buttons tell a screen reader nothing.
      'row.showInFolder': '在文件夹中显示 {name}',
      'tag.outside': '工作区外',
      'tag.outside.title': '这个目录不在本会话的工作区内。它出现在这里，是因为本会话确实动过它 —— 当时的权限模式允许如此。',
    }

    const en = {
      'panel.title': 'Resources',
      'panel.open': 'Open resources',
      'panel.close': 'Collapse resources',
      'panel.resize': 'Drag to resize the panel (arrow keys work too)',
      'section.produced': 'Produced',
      'section.consulted': 'Sources',
      'section.count': '{count} files',
      'empty.all': 'This session has produced no file resources yet',
      'empty.produced': 'No produced files',
      'empty.consulted': 'No source files',
      'list.aria': 'Session file resources',
      'tree.aria': 'Workspace files',
      'tree.filter': 'Filter files…',
      'tree.filter.clear': 'Clear filter',
      'tree.openRoot': 'Open workspace folder',
      'tree.reload': 'Reload',
      'tree.loading': 'Reading…',
      'tree.empty': 'This folder is empty',
      'tree.truncated': 'Large directory; showing the first {count}',
      'tree.error': 'Could not read: {reason}',
      'tree.noMatch': 'No matching files',
      'tree.expand': 'Expand {name}',
      'tree.collapse': 'Collapse {name}',
      'tree.unavailable': 'This deployment cannot list workspace files; below are the files this session touched',
      'output.title': 'Produced here',
      'mark.produced': 'Produced by this session · {tools}',
      'mark.consulted': 'Read by this session · {tools}',
      'row.showInFolder': 'Show {name} in folder',
      'tag.outside': 'outside workspace',
      'tag.outside.title': 'This directory is not inside the session workspace. It is listed because the session did touch it — the permission mode in force at the time allowed that.',
    }

    // -------------------------------------------------------- classification

    /** Generic-card `kind` read as a file mutation. */
    const MUTATION_KIND = 'edit'
    /** Generic-card `kind` read as a file read. */
    const READ_KIND = 'read'

    /**
     * Narrow an untrusted value to a plain object.
     *
     * Everything below `card` on a tool event view is untrusted: the wire
     * schema locks only the `for` discriminant and the presence of a
     * card-tagged object, so a version mismatch or an anomalous plugin can
     * deliver a `diff` card with no `diffs` array or a `locations` entry with
     * no `path`. This module narrows structurally and drops what it cannot
     * read, so a malformed view costs one missing row instead of a broken tab.
     * @param {unknown} value - the untrusted value.
     * @returns {Record<string, unknown> | undefined} the object, or undefined.
     */
    function record(value) {
      return typeof value === 'object' && value !== null && !Array.isArray(value)
        ? value
        : undefined
    }

    /**
     * Collect the `path` of every well-formed entry in an untrusted array.
     * @param {unknown} value - the untrusted `locations` or `diffs` field.
     * @returns {string[]} each distinct non-blank path, in first-seen order.
     */
    function paths(value) {
      if (!Array.isArray(value)) return []
      const collected = []
      for (const entry of value) {
        const found = record(entry)
        const path = found === undefined ? undefined : found['path']
        if (typeof path !== 'string' || path === '') continue
        if (!collected.includes(path)) collected.push(path)
      }
      return collected
    }

    /**
     * Merge two untrusted path sources, keeping first-seen order across both.
     * A diff card names its files twice (`diffs` and the follow-along
     * `locations`); either alone is enough, so neither is required.
     * @param {unknown} first - the preferred source.
     * @param {unknown} second - the secondary source.
     * @returns {string[]} the distinct union, first-seen order.
     */
    function union(first, second) {
      const merged = paths(first)
      for (const path of paths(second)) {
        if (!merged.includes(path)) merged.push(path)
      }
      return merged
    }

    function contribution(role, collected) {
      return collected.length === 0 ? null : { role, paths: collected }
    }

    /**
     * Classify one tool call or result view into an inventory contribution.
     *
     * The vocabulary is render intent, not tool names: a mutation is a `diff`
     * card or a generic card whose `kind` is `edit` (the shape
     * `str_replace_editor`'s insert presents), and a read is a `read` card or a
     * generic card whose `kind` is `read`. Reading intent is what lets a file
     * tool nobody has written yet join this ledger by declaring what it does.
     * @param {{ for: string, view: unknown } | undefined} event - the untrusted view riding the tool event.
     * @returns {{ role: string, paths: readonly string[] } | null} the contribution, or null.
     */
    function classifyToolEventView(event) {
      if (event === undefined || event === null) return null
      const view = record(event.view)
      if (view === undefined) return null
      if (view['card'] === 'diff') {
        return contribution('produced', union(view['diffs'], view['locations']))
      }
      if (view['card'] === 'read') {
        const path = view['path']
        return typeof path === 'string' && path !== ''
          ? { role: 'consulted', paths: [path] }
          : null
      }
      if (view['card'] !== 'generic') return null
      if (view['kind'] === MUTATION_KIND) return contribution('produced', paths(view['locations']))
      if (view['kind'] === READ_KIND) return contribution('consulted', paths(view['locations']))
      return null
    }

    // ----------------------------------------------------- per-call context

    function callIdOf(event) {
      if (event.type === 'tool/call') return String(event.data.callId)
      if (event.type === 'tool/result') return String(event.data.message.source.callId)
      return undefined
    }

    /**
     * Whether a settled call failed, by either signal the log carries.
     *
     * `data.error` is the internal failure identity (the tool threw), while
     * `message.content[0].isError` is the model-facing error flag (the tool
     * returned a failure). They are different facts and either one means
     * nothing was written, so a call must clear its claim when either is
     * present — checking only the first would let a tool that reported failure
     * without throwing keep claiming the file its call-time diff named.
     * @param {object} event - the `tool/result` event.
     * @returns {boolean} true when this call must not claim a file.
     */
    function failed(event) {
      if (event.data.error !== undefined && event.data.error !== null) return true
      const message = record(event.data.message)
      const content = message === undefined ? undefined : message['content']
      const first = Array.isArray(content) ? record(content[0]) : undefined
      return first !== undefined && first['isError'] === true
    }

    /**
     * Whether this context currently names inventory files.
     * @param {object} state - the context's accumulated facts.
     * @returns {boolean} true only for a settled, successful, file-naming call.
     */
    function contributes(state) {
      return state.settled && state.role !== null && state.paths.length > 0
    }

    /**
     * One context per tool call, folding that call's render intent into a
     * contribution.
     *
     * `tool/call` is the start rather than `tool/result` because a mutation's
     * file identity can live only in the call view: `str_replace_editor`'s
     * insert presents a generic `kind: 'edit'` card whose files are its
     * call-time `locations`, and its result view names none. `tool/result` is
     * the update that decides whether the contribution counts at all — a call
     * that has not settled wrote nothing yet.
     *
     * `publication` is omitted: a tool call settles once, there is no
     * high-frequency delta here, and omission already means immediate.
     */
    const resourceCallDefinition = {
      kind: KIND,
      target: TARGET,
      match: (event) => {
        const callId = callIdOf(event)
        if (callId === undefined) return null
        return { id: callId, role: event.type === 'tool/call' ? 'start' : 'update' }
      },
      start: (_context, match) => {
        const event = match.event
        const classified = classifyToolEventView(match.view)
        return {
          callId: String(event.data.callId),
          toolName: event.data.name,
          role: classified === null ? null : classified.role,
          paths: classified === null ? [] : classified.paths,
          settled: false,
        }
      },
      update: (context, match) => {
        const state = context.state
        const event = match.event
        if (event.type !== 'tool/result') return state
        if (failed(event)) {
          return { ...state, role: null, paths: [], settled: true }
        }
        // The settled view is authoritative when it names files; otherwise the
        // call-time classification stands (the generic `kind: 'edit'` shape,
        // whose result view names no file).
        const classified = classifyToolEventView(match.view)
        if (classified === null) return { ...state, settled: true }
        return { ...state, role: classified.role, paths: classified.paths, settled: true }
      },
      buildViewNode: (context) => {
        const state = context.state
        if (state === undefined || !contributes(state)) return null
        const start = context.start
        const anchorSeq = start === undefined ? undefined : start.event.seq
        if (anchorSeq === undefined) return null
        return {
          key: context.key,
          kind: KIND,
          id: context.id,
          target: TARGET,
          anchorSeq,
          data: {
            callId: state.callId,
            toolName: state.toolName,
            role: state.role,
            paths: state.paths,
          },
        }
      },
    }

    // -------------------------------------------------------- session fold

    /**
     * Stable empty target, so an unfolded session and a folded-but-empty one
     * publish the same reference and the selector does not churn renders.
     */
    const EMPTY_SNAPSHOT = { produced: [], consulted: [] }

    function collect(drafts, node) {
      for (const path of node.data.paths) {
        const existing = drafts.get(path)
        if (existing === undefined) {
          drafts.set(path, { path, firstSeq: node.anchorSeq, toolNames: [node.data.toolName] })
          continue
        }
        if (!existing.toolNames.includes(node.data.toolName)) {
          existing.toolNames.push(node.data.toolName)
        }
      }
    }

    function freeze(drafts) {
      const entries = []
      for (const draft of drafts) {
        entries.push({ path: draft.path, firstSeq: draft.firstSeq, toolNames: draft.toolNames })
      }
      return entries
    }

    /** Keyed adapter folding contributing calls into the two lists. */
    class ResourcesViewBuilder {
      constructor() {
        this.nodes = new Map()
        this.empty = EMPTY_SNAPSHOT
      }

      replace(input) {
        this.nodes.clear()
        for (const node of input.nodes) this.nodes.set(node.key, node)
        return this.snapshot()
      }

      apply(input) {
        for (const node of input.upserts) this.nodes.set(node.key, node)
        return this.snapshot()
      }

      snapshot() {
        const ordered = [...this.nodes.values()]
          .sort((left, right) => left.anchorSeq - right.anchorSeq
            || left.key.localeCompare(right.key))
        const produced = new Map()
        const consulted = new Map()
        for (const node of ordered) {
          collect(node.data.role === 'produced' ? produced : consulted, node)
        }
        // A file the session wrote is a deliverable whether or not it was also
        // read on the way there, so `produced` owns every path it claims.
        // Listing it twice would report one file as two resources.
        for (const path of produced.keys()) consulted.delete(path)
        return { produced: freeze(produced.values()), consulted: freeze(consulted.values()) }
      }
    }

    const resourcesViewDefinition = {
      target: TARGET,
      create: () => new ResourcesViewBuilder(),
    }

    // -------------------------------------------------------- path display

    /**
     * Whether a reported path is absolute. One definition, shared by the
     * workspace comparison and the open resolver, because the two disagreeing
     * about what "absolute" means is how a relative path ends up flagged as
     * outside the workspace while still resolving inside it.
     * @param {string} path - the path as the tool reported it.
     * @returns {boolean} true for POSIX, drive-letter and UNC absolute paths.
     */
    function isAbsolutePath(path) {
      return path.startsWith('/') || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith('\\\\')
    }

    /** Trailing separators and separator style both vary; compare normalized. */
    function normalizeDir(value) {
      return value.replace(/[/\\]+$/, '').replaceAll('\\', '/')
    }

    /**
     * Whether a path is spelled in the Windows dialect, where case does not
     * distinguish files. Comparing case-sensitively there would flag a
     * workspace directory as outside over a drive-letter's case alone, and a
     * false alarm on this particular signal is worse than no signal.
     * @param {string} value - a normalized path.
     * @returns {boolean} true when the spelling is drive-letter or UNC.
     */
    function isWindowsPath(value) {
      return /^[A-Za-z]:/.test(value) || value.startsWith('//')
    }

    /**
     * Split a model-facing path into basename and leading directories. Both
     * separators are accepted because the path is whatever the tool reported.
     * @param {string} path - the entry path.
     * @returns {{ name: string, dir: string }} the basename and its prefix.
     */
    function splitPath(path) {
      const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
      return cut < 0
        ? { name: path, dir: '' }
        : { name: path.slice(cut + 1), dir: path.slice(0, cut) }
    }

    /**
     * How a directory reads against the session's own workspace.
     *
     * Two jobs. The first is noise removal: a ledger of one session is mostly
     * that session's own workspace, so the absolute prefix repeated on every
     * row says nothing — inside the workspace the remainder is enough, and the
     * root itself needs no path at all.
     *
     * The second is the more useful one. A path outside the workspace is here
     * because the session really did touch it, which means the permission mode
     * in force at the time allowed that: `workspace-write` confines WRITES to
     * the workspace and leaves reads unrestricted, and `danger-full-access`
     * confines neither. Leaving the reader to notice that by comparing path
     * spellings wastes the one fact this ledger is best placed to report, so
     * such a directory is flagged rather than merely spelled differently.
     * @param {string} dir - the entry's directory, as the tool reported it.
     * @param {string | undefined} cwd - the session workspace root, when known.
     * @returns {{ label: string, outside: boolean }} the label to show (empty
     *   means the workspace root itself) and whether it sits outside the workspace.
     */
    function describeDir(dir, cwd) {
      if (dir === '') return { label: '', outside: false }
      // A relative directory resolves against the session's own root — that is
      // what makes it relative — so it is inside by construction and already
      // spelled the short way. Comparing it against an absolute root would
      // report every relative path as outside the workspace.
      if (!isAbsolutePath(dir)) return { label: dir, outside: false }
      // With no workspace root there is nothing to be outside OF, so the path
      // stands unflagged rather than flagged on a guess.
      if (cwd === undefined || cwd === '') return { label: dir, outside: false }
      const base = normalizeDir(cwd)
      const here = normalizeDir(dir)
      const fold = isWindowsPath(base) || isWindowsPath(here)
      const left = fold ? here.toLowerCase() : here
      const right = fold ? base.toLowerCase() : base
      if (left === right) return { label: '', outside: false }
      return left.startsWith(`${right}/`)
        ? { label: here.slice(base.length + 1), outside: false }
        : { label: dir, outside: true }
    }

    /**
     * Resolve a workspace-relative path into the Host-facing spelling
     * `openPath` expects. Reimplemented rather than imported: the module loader
     * hands this file a `require` for host modules, and depending on a
     * non-public helper's path would tie the plugin to a version's internals
     * for a few lines of string work.
     * @param {string | undefined} cwd - session workspace root, when known.
     * @param {string} path - absolute or workspace-relative path.
     * @returns {string} an absolute path when a root is available, else the original.
     */
    function resolveWorkspacePath(cwd, path) {
      if (isAbsolutePath(path)) return path
      if (cwd === undefined || cwd === '') return path
      const base = cwd.replace(/[/\\]+$/, '')
      const rel = path.replace(/^[/\\]+/, '')
      return `${base}/${rel}`
    }

    /**
     * Group entries by directory, keeping the fold's order for both the groups
     * and the rows inside them.
     * @param {readonly object[]} entries - the published inventory entries.
     * @param {string | undefined} cwd - the session workspace root, when known.
     * @returns {readonly object[]} one group per directory, in first-seen order.
     */
    function toGroups(entries, cwd) {
      const groups = new Map()
      for (const entry of entries) {
        const split = splitPath(entry.path)
        const row = {
          path: entry.path,
          name: split.name,
          tools: entry.toolNames.join(' · '),
        }
        const existing = groups.get(split.dir)
        if (existing === undefined) {
          const described = describeDir(split.dir, cwd)
          groups.set(split.dir, {
            dir: split.dir,
            label: described.label,
            outside: described.outside,
            rows: [row],
          })
          continue
        }
        existing.rows.push(row)
      }
      return [...groups.values()]
    }

    /** Total rows across groups, which is what the section count reports. */
    function countRows(groups) {
      let total = 0
      for (const group of groups) total += group.rows.length
      return total
    }

    // -------------------------------------------------------------- styles

    const CLASS = {
      toggle: 'dsh-sres-toggle',
      panel: 'dsh-sres-panel',
      panelHead: 'dsh-sres-panelhead',
      panelTitle: 'dsh-sres-paneltitle',
      body: 'dsh-sres-body',
      section: 'dsh-sres-section',
      head: 'dsh-sres-head',
      title: 'dsh-sres-title',
      count: 'dsh-sres-count',
      groups: 'dsh-sres-groups',
      group: 'dsh-sres-group',
      dirRow: 'dsh-sres-dirrow',
      dir: 'dsh-sres-dir',
      outside: 'dsh-sres-outside',
      list: 'dsh-sres-list',
      entry: 'dsh-sres-entry',
      row: 'dsh-sres-row',
      folder: 'dsh-sres-folder',
      icon: 'dsh-sres-icon',
      name: 'dsh-sres-name',
      tools: 'dsh-sres-tools',
      empty: 'dsh-sres-empty',
      handle: 'dsh-sres-handle',
      headActions: 'dsh-sres-headactions',
      iconButton: 'dsh-sres-iconbtn',
      filterRow: 'dsh-sres-filterrow',
      filterInput: 'dsh-sres-filterinput',
      tree: 'dsh-sres-tree',
      mark: 'dsh-sres-mark',
      outputs: 'dsh-sres-outputs',
      twisty: 'dsh-sres-twisty',
      leafPad: 'dsh-sres-leafpad',
      meta: 'dsh-sres-meta',
      note: 'dsh-sres-note',
    }

    /** Panel width bounds, in CSS pixels; the drag clamps to them. */
    const WIDTH = { min: 240, max: 720, initial: 340 }

    /**
     * How the conversation makes room for the panel.
     *
     * The session header — its title, its utility row and the conversation tabs
     * — is left alone. Narrowing the whole column would have dragged all of it
     * inward, and that row is the app's, not this plugin's, to rearrange. What
     * gives up width is the scrolling body under it, which is the region a
     * reader is actually looking at.
     *
     * `margin-right` and not `padding-right`, because that body IS the scroll
     * container: padding sits inside the border box, so a padded body would keep
     * its scrollbar out at the far edge, underneath this panel. A margin shrinks
     * the border box instead and the scrollbar travels with it. The content
     * inside re-centres on its own — it is held by automatic margins — so
     * nothing has to be told where to go.
     *
     * `data-conversation-scroll` is an attribute the app puts there on purpose;
     * the class beside it is a build hash that changes with every release. The
     * width travels as a custom property on the document root, so nothing here
     * writes to a node the app owns and React has nothing to overwrite on its
     * next render.
     */
    const CONVERSATION_BODY = '[data-conversation-scroll]'
    const RESERVE_VAR = '--dsh-sres-reserve'

    /**
     * The channel this plugin's host half answers directory listings on.
     *
     * It must match the `CHANNEL` that half exports. The string is repeated
     * rather than imported because these are two modules on two sides of a wire:
     * the browser loads `client.js` alone and has no way to read the host entry.
     *
     * A listing needs a route of the plugin's own because the app's
     * `host.listDirectory` returns directories without their files — it backs the
     * directory picker, where a file is not a destination. Nothing else in the
     * RPC map reports file names.
     *
     * Whether this is reachable is not assumed. The desktop shell loads the app
     * over `file://` and forwards fetches through its own bridge rather than the
     * web server, and `/api` is the only route constant the app exports, so a
     * bridge built around that prefix would never carry this one. The first
     * listing is therefore also the test: when it fails, the panel says so and
     * falls back to the files this session touched, which need no channel at all.
     */
    const TREE_CHANNEL = '/dsh-session-resources'

    /**
     * Empty space between the conversation and the panel, in CSS pixels.
     *
     * The panel draws no dividing line, so this gap is what separates the two.
     * It is reserved beyond the panel's own width rather than added as padding
     * inside it, which keeps the rows' hover area from reaching over into the
     * space that is meant to read as empty.
     */
    const GAP = 12

    /**
     * Colours come from the app's own theme tokens, so light and dark follow
     * the host with no theme awareness here. `:hover` and `:focus-visible` are
     * why this is a stylesheet rather than inline styles.
     *
     * The panel is positioned absolutely against the overlay layer, which the
     * frame declares as `position: absolute; inset: 0` over itself — so "right
     * edge" means the frame's, not the viewport's, and a desktop window's title
     * bar and controls stay clear.
     *
     * The first rule is the only one that lands on the app's own markup, and it
     * sets one property to a variable that is zero until this panel has a width
     * to ask for. Everything after it is scoped to this plugin's classes.
     *
     * The fill and the left edge are the app's own answer for a docked region on
     * this side, copied rather than invented: its details column and the panel
     * inside it both carry `border-left: 1px solid --dsw-alias-border-l2` over
     * `--dsw-alias-bg-base`, and its sidebar carries the mirror of that. An
     * earlier version dropped the line, on the theory that a shared background
     * would read as one surface. It read as a list floating in the margin — the
     * line is what says "this is a place", and the app had already decided that.
     *
     * The scrollbar is quiet until the pointer is in the panel, which is the
     * app's sidebar pattern: rebind BOTH thumb tokens to transparent, because
     * rebinding one leaves the other painting the moment the pointer reaches the
     * bar. A resting bar here is unusually heavy — a file list overflows its
     * panel by a little, so the thumb comes out at two thirds of the track and
     * reads as a rule down the edge rather than as a position. `scrollbar-gutter`
     * holds the 8px whether or not the thumb is painted, so no row shifts when it
     * appears; the app keeps that reservation on the scrolling region for the same
     * reason.
     *
     * Every custom property here was read off the running app rather than
     * guessed, including the two this got wrong twice.
     *
     * Focus was a ring of `currentColor`, which inside a text field is the
     * near-black label colour and landed as a heavy black box. The obvious
     * replacement was `--dsw-alias-brand-primary`, which the app's shared `Input`
     * primitive uses — but measured in the running app that token is
     * `rgb(15, 17, 21)`, near-black again, so copying it would have changed
     * nothing visible. What actually reads as focus is
     * `--dsw-alias-state-business-primary` (a blue), which is what every control
     * in the app outlines with and what its own plugin-inventory SEARCH field
     * takes on its border together with a soft ring at 18% — the nearest
     * precedent to a filter box, so that is what this follows.
     */
    const STYLES = `
${CONVERSATION_BODY} { margin-right: var(${RESERVE_VAR}, 0px); }
.${CLASS.toggle} { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 26px; height: 26px; border-radius: 6px; border: none; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; padding: 0; }
.${CLASS.toggle}:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CLASS.toggle}[data-open='true'] { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CLASS.toggle}:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.${CLASS.panel} { position: absolute; top: 0; right: 0; bottom: 0; display: flex; flex-direction: column; box-sizing: border-box; background: var(--dsw-alias-bg-base); border-left: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-primary); --dsh-scrollbar-thumb: transparent; --dsh-scrollbar-thumb-hover: transparent; }
.${CLASS.panel}:hover, .${CLASS.panel}:focus-within { --dsh-scrollbar-thumb: var(--dsw-alias-scrollbar-bg-l1); --dsh-scrollbar-thumb-hover: var(--dsw-alias-scrollbar-hover-l1); }
.${CLASS.panel}[data-dragging='true'] { user-select: none; }
.${CLASS.handle} { position: absolute; top: 0; left: -4px; bottom: 0; width: 8px; cursor: col-resize; background: transparent; border: none; padding: 0; touch-action: none; }
.${CLASS.handle}::after { content: ''; position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); box-sizing: border-box; width: 12px; height: 32px; border-radius: 10px; background: var(--dsw-alias-button-floating-fill); border: 1px solid var(--dsw-alias-border-l2-darkmode-thin); opacity: 0; }
.${CLASS.panel}:hover .${CLASS.handle}::after, .${CLASS.handle}:hover::after, .${CLASS.handle}:focus-visible::after, .${CLASS.handle}[data-dragging='true']::after { opacity: 1; }
.${CLASS.handle}:hover::after, .${CLASS.handle}[data-dragging='true']::after { background: var(--dsw-alias-button-floating-hover); border-color: var(--dsw-alias-border-l3); }
.${CLASS.handle}:focus-visible { outline: none; }
.${CLASS.handle}:focus-visible::after { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: 1px; }
.${CLASS.panelHead} { display: flex; align-items: center; flex: 0 0 auto; box-sizing: border-box; padding: 14px 16px 10px; }
.${CLASS.panelTitle} { margin: 0; overflow: hidden; font-size: 14px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-primary); text-overflow: ellipsis; white-space: nowrap; }
.${CLASS.body} { flex: 1 1 auto; min-height: 0; overflow-y: auto; scrollbar-gutter: stable; padding: 10px 10px 16px 16px; font-size: 15px; }
.${CLASS.section} { margin-bottom: 16px; }
.${CLASS.head} { display: flex; align-items: baseline; gap: 6px; margin-bottom: 6px; }
.${CLASS.title} { font-size: 13px; line-height: 20px; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.${CLASS.count} { color: var(--dsw-alias-label-tertiary); font-size: 13px; line-height: 20px; }
.${CLASS.groups} { display: flex; flex-direction: column; gap: 10px; }
.${CLASS.group} { display: flex; flex-direction: column; gap: 2px; }
.${CLASS.dirRow} { display: flex; align-items: baseline; gap: 6px; padding: 0 8px; min-width: 0; }
.${CLASS.dir} { flex: 0 1 auto; color: var(--dsw-alias-label-secondary); font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.${CLASS.outside} { flex: 0 0 auto; font-size: 12px; line-height: 1.5; padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); cursor: help; }
.${CLASS.list} { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.${CLASS.entry} { display: flex; align-items: center; border-radius: 7px; border: 1px solid transparent; }
.${CLASS.entry}:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l2); }
.${CLASS.row} { flex: 1 1 auto; min-width: 0; display: flex; align-items: center; gap: 8px; padding: 4px 8px; border: none; border-radius: 6px; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.${CLASS.row}:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.${CLASS.folder} { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; margin-right: 4px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; opacity: 0; }
.${CLASS.entry}:hover .${CLASS.folder}, .${CLASS.folder}:focus-visible { opacity: 1; }
.${CLASS.folder}:hover { color: var(--dsw-alias-label-primary); }
.${CLASS.folder}:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.${CLASS.icon} { flex: 0 0 auto; display: inline-flex; align-items: center; color: var(--dsw-alias-label-secondary); }
.${CLASS.name} { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${CLASS.tools} { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.${CLASS.empty} { margin: 0; padding: 4px 0; font-size: 13px; line-height: 20px; color: var(--dsw-alias-label-tertiary); }
.${CLASS.headActions} { display: flex; align-items: center; gap: 2px; margin-left: auto; }
.${CLASS.iconButton} { display: inline-flex; align-items: center; justify-content: center; flex: 0 0 auto; width: 26px; height: 26px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary); cursor: pointer; }
.${CLASS.iconButton}:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CLASS.iconButton}:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.${CLASS.filterRow} { flex: 0 0 auto; display: flex; padding: 0 16px 8px; }
.${CLASS.filterInput} { flex: 1 1 auto; min-width: 0; box-sizing: border-box; height: 30px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; }
.${CLASS.filterInput}::placeholder { color: var(--dsw-alias-label-tertiary); }
.${CLASS.filterInput}:focus-visible { outline: none; border-color: var(--dsw-alias-state-business-primary); box-shadow: 0 0 0 2px color-mix(in srgb, var(--dsw-alias-state-business-primary) 18%, transparent); }
.${CLASS.tree} { display: flex; flex-direction: column; margin: 0; padding: 0; list-style: none; }
.${CLASS.outputs} { margin: 0 0 14px; padding: 0 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l2); }
.${CLASS.mark} { flex: 0 0 auto; width: 7px; height: 7px; border-radius: 50%; cursor: help; }
.${CLASS.mark}[data-role='produced'] { background: var(--dsw-alias-state-business-primary); }
.${CLASS.mark}[data-role='consulted'] { box-shadow: inset 0 0 0 1.5px var(--dsw-alias-label-tertiary); }
.${CLASS.twisty} { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 18px; height: 18px; color: var(--dsw-alias-label-tertiary); }
.${CLASS.leafPad} { flex: 0 0 auto; width: 18px; }
.${CLASS.meta} { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; white-space: nowrap; }
.${CLASS.note} { margin: 2px 0 8px; padding: 0 8px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
`

    /** Style element id, so a double mount cannot leave two copies behind. */
    const STYLE_ID = 'dsh-session-resources-styles'

    /**
     * Install the stylesheet, returning its disposer for `ctx.effect`.
     * @returns {() => void} removes the element this call added, and nothing else.
     */
    function installStyles() {
      const existing = document.getElementById(STYLE_ID)
      if (existing !== null) return () => { }
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = STYLES
      document.head.appendChild(element)
      return () => { element.remove() }
    }

    // ---------------------------------------------------------- open state

    /**
     * Whether the panel is open, shared by the header button and the panel.
     *
     * The two live in different slots — one session-scoped in the header row,
     * one root-scoped in the frame overlay — so neither can hold this for the
     * other, and a store outside both is what lets one control a surface it has
     * no parent-child relationship with. It is deliberately in-memory: a panel
     * that reopened itself on every reload would be a decision made for the
     * reader, not by them.
     * @returns {object} an ObservableSnapshot with `toggle`.
     */
    function createOpenState() {
      let open = false
      const listeners = new Set()
      return {
        getSnapshot: () => open,
        subscribe: (fn) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },
        toggle: () => {
          open = !open
          for (const fn of [...listeners]) fn()
        },
      }
    }

    /** Read an ObservableSnapshot the way React wants to be told about changes. */
    function useObservable(source) {
      return React.useSyncExternalStore(source.subscribe, source.getSnapshot)
    }

    /** A source that never changes, for when there is no session to observe. */
    const NO_SOURCE = { subscribe: () => () => { }, getSnapshot: () => undefined }

    /**
     * The current session's inventory and workspace root, read from root scope.
     *
     * The panel sits in a root-scoped slot, so no session props arrive: it
     * follows the session list's own current selection instead, which is the
     * same fact the sidebar highlights.
     * @param {object} sessions - `ctx.sessions`.
     * @returns {{ ready: boolean, cwd: string | undefined, inventory: object }} the view state.
     */
    function useCurrentInventory(sessions) {
      const list = useObservable(sessions.list)
      const id = list.current
      const session = id === undefined ? undefined : sessions.binding(id)?.session
      const source = React.useMemo(
        () => (session === undefined
          ? NO_SOURCE
          : { subscribe: fn => session.subscribe(fn), getSnapshot: () => session.getSnapshot() }),
        [session],
      )
      const snapshot = useObservable(source)
      const inventory = snapshot === undefined
        ? EMPTY_SNAPSHOT
        : snapshot.views.get(TARGET) ?? EMPTY_SNAPSHOT
      return {
        ready: id !== undefined,
        sessionId: id,
        cwd: id === undefined ? undefined : list.byId[id]?.cwd,
        inventory,
      }
    }

    /**
     * Where the conversation body starts, which is where this panel starts too.
     *
     * The panel belongs under the session header, beside the messages rather than
     * beside the header — so its top edge is the body's top edge, and the header
     * keeps its full width above both. Measuring the same element the stylesheet
     * narrows is what keeps the two agreeing: one number, read from one place.
     *
     * Keyed on `active` rather than measured once at mount, because this
     * component lives in a root-scoped slot: it mounts with the frame, before any
     * session and therefore before the conversation body exists.
     * @param {boolean} active - whether there is a session on screen to measure.
     * @returns {number | null} the top offset in CSS pixels relative to the
     *   overlay layer, or null while nothing has been measured.
     */
    function useContentTop(active) {
      const [top, setTop] = React.useState(null)
      React.useEffect(() => {
        if (!active) return undefined
        const measure = () => {
          const body = document.querySelector(CONVERSATION_BODY)
          const layer = document.querySelector('[data-shell-overlay]')
          if (body === null || layer === null) return
          const next = Math.max(0, Math.round(
            body.getBoundingClientRect().top - layer.getBoundingClientRect().top,
          ))
          setTop(prev => (prev === next ? prev : next))
        }
        measure()
        // One more frame, for the case where the header is mid-layout: the body
        // can exist with a stale rect on the tick this effect runs.
        const frame = requestAnimationFrame(measure)
        const observer = new ResizeObserver(measure)
        observer.observe(document.body)
        return () => {
          cancelAnimationFrame(frame)
          observer.disconnect()
        }
      }, [active])
      return top
    }

    /**
     * The workspace directory tree, one level at a time.
     *
     * Levels are fetched when a folder is first opened and then kept, so
     * collapsing and reopening costs nothing and the panel does not re-read a
     * directory the reader is toggling. That also means the tree can go stale,
     * which is why there is a reload rather than a promise of freshness — this
     * plugin has no file watcher, and inventing one to keep a sidebar current
     * would be a lot of machinery for a question a button answers.
     *
     * Keyed by session: switching sessions is a different workspace, so the whole
     * cache is dropped rather than merged.
     * @param {object} deps - the injected `connection` handle.
     * @param {string | undefined} sessionId - session whose workspace to read.
     * @param {string | undefined} cwd - its root, as the app reported it.
     * @param {boolean} active - whether the panel is on screen.
     * @returns {object} `{ root, levels, open, toggle, reload, state, error }`.
     */
    function useWorkspaceTree(deps, sessionId, cwd, active) {
      const [tree, setTree] = React.useState(() => ({ root: undefined, levels: new Map(), state: 'idle', error: '' }))
      const [open, setOpen] = React.useState(() => new Set())
      // Bumped by the reload button; the load effect keys on it.
      const [epoch, setEpoch] = React.useState(0)

      const request = React.useCallback(async (path, signal) => {
        const answer = await deps.connection.rpc.call(
          TREE_CHANNEL,
          'list',
          { sessionId, cwd, ...path === undefined ? {} : { path } },
          signal,
        )
        if (answer.ok !== true) throw new Error(answer.error.code)
        return answer.value
      }, [deps.connection, sessionId, cwd])

      // The root, and a reset whenever the session or the epoch changes.
      React.useEffect(() => {
        if (!active || sessionId === undefined) return undefined
        let live = true
        const controller = new AbortController()
        setTree({ root: undefined, levels: new Map(), state: 'loading', error: '' })
        setOpen(new Set())
        request(undefined, controller.signal).then(
          (level) => {
            if (!live) return
            setTree({
              root: level.path,
              levels: new Map([[level.path, { entries: level.entries, truncated: level.truncated }]]),
              state: 'ready',
              error: '',
            })
          },
          (error) => {
            if (!live) return
            // One failure at the root is the whole tree failing, and the caller
            // shows the session's own file list instead of an empty panel.
            setTree({ root: undefined, levels: new Map(), state: 'failed', error: String(error?.message ?? error) })
          },
        )
        return () => {
          live = false
          controller.abort()
        }
      }, [active, sessionId, epoch, request])

      const load = React.useCallback((path) => {
        setTree(prev => (prev.levels.has(path)
          ? prev
          : { ...prev, levels: new Map(prev.levels).set(path, { pending: true }) }))
        request(path, undefined).then(
          (level) => {
            setTree(prev => ({
              ...prev,
              levels: new Map(prev.levels).set(path, { entries: level.entries, truncated: level.truncated }),
            }))
          },
          (error) => {
            setTree(prev => ({
              ...prev,
              levels: new Map(prev.levels).set(path, { error: String(error?.message ?? error) }),
            }))
          },
        )
      }, [request])

      const toggle = React.useCallback((path) => {
        setOpen((prev) => {
          const next = new Set(prev)
          if (next.has(path)) next.delete(path)
          else next.add(path)
          return next
        })
        setTree((prev) => {
          if (prev.levels.has(path)) return prev
          // A level is fetched once, on the open that first needs it. Reading
          // `levels` here rather than in the click handler keeps the decision on
          // one copy of the state instead of a possibly stale closure.
          queueMicrotask(() => { load(path) })
          return prev
        })
      }, [load])

      const reload = React.useCallback(() => { setEpoch(value => value + 1) }, [])

      return { ...tree, open, toggle, reload }
    }

    /**
     * Tell the conversation column how much room to leave on its right.
     *
     * One custom property on the document root, which the stylesheet's first
     * rule reads. Writing a variable rather than styling the column directly is
     * what keeps this off the app's own nodes: React re-renders that column
     * freely, and anything set on the element itself would be a race.
     *
     * The cleanup removes the property outright, so unloading the plugin or
     * closing the last session gives the width straight back.
     * @param {number} reserve - width to hold, in CSS pixels; 0 to hold none.
     */
    function useConversationReserve(reserve) {
      React.useEffect(() => {
        const root = document.documentElement
        root.style.setProperty(RESERVE_VAR, `${reserve}px`)
        return () => { root.style.removeProperty(RESERVE_VAR) }
      }, [reserve])
    }

    /**
     * Panel width, and the drag that changes it.
     *
     * Pointer capture is what makes the drag survive leaving the handle: without
     * it the panel stops following the moment the cursor crosses into the
     * conversation, which is exactly where a widening drag goes. Arrow keys move
     * it too, so the handle is not pointer-only.
     * @returns {{ width: number, dragging: boolean, onPointerDown: Function, onKeyDown: Function }} the handle's wiring.
     */
    function useResizableWidth() {
      const [width, setWidth] = React.useState(WIDTH.initial)
      const [dragging, setDragging] = React.useState(false)
      // A ref, not the state value, is what the drag reads: a pointer handler
      // needs the width AS OF THIS FRAME, and a state setter's updater runs when
      // React decides to, not when the pointer moves.
      const widthRef = React.useRef(WIDTH.initial)

      // Rounded, not just clamped: a pointer reports fractional pixels, and the
      // width leaves here as a CSS length the conversation column pads by. A
      // whole number keeps that padding from landing mid-pixel.
      const apply = React.useCallback((next) => {
        const clamped = Math.round(Math.min(WIDTH.max, Math.max(WIDTH.min, next)))
        widthRef.current = clamped
        setWidth(clamped)
      }, [])

      const onPointerDown = React.useCallback((event) => {
        event.preventDefault()
        const handle = event.currentTarget
        const startX = event.clientX
        const startWidth = widthRef.current
        handle.setPointerCapture(event.pointerId)
        setDragging(true)
        // Dragging left widens: the cursor is holding the panel's left edge.
        const onMove = (move) => { apply(startWidth + (startX - move.clientX)) }
        const stop = () => {
          handle.removeEventListener('pointermove', onMove)
          handle.removeEventListener('pointerup', stop)
          handle.removeEventListener('pointercancel', stop)
          setDragging(false)
        }
        handle.addEventListener('pointermove', onMove)
        handle.addEventListener('pointerup', stop)
        handle.addEventListener('pointercancel', stop)
      }, [apply])

      const onKeyDown = React.useCallback((event) => {
        const step = event.key === 'ArrowLeft' ? 16 : event.key === 'ArrowRight' ? -16 : 0
        if (step === 0) return
        event.preventDefault()
        apply(widthRef.current + step)
      }, [apply])

      return { width, dragging, onPointerDown, onKeyDown }
    }

    // ----------------------------------------------------------- components

    /**
     * Icons are drawn here rather than copied from the app.
     *
     * The host's own panel-toggle glyph is a single 2151-character filled path
     * — its artwork, not a shared asset — so these follow the same visual
     * language (16px box, 1.2px strokes, `currentColor`) without lifting it.
     * `currentColor` is also what makes them theme-correct for free: they take
     * the colour of the row they sit in, so light and dark need no branch.
     */
    const svg = (size, children) => React.createElement(
      'svg',
      { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': 'true' },
      ...children,
    )
    const line = (d, width) => React.createElement('path', {
      d,
      stroke: 'currentColor',
      'stroke-width': width ?? 1.2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
    })

    /**
     * The toggle glyph: a panel outline with its right edge partitioned off —
     * the same idea as the host's sidebar control, mirrored for a right-hand
     * panel, so the button reads as "show/hide that side" rather than "files".
     */
    const PANEL_ICON = svg(16, [
      React.createElement('rect', {
        x: 1.9, y: 3.4, width: 12.2, height: 9.2, rx: 2,
        stroke: 'currentColor', 'stroke-width': 1.2,
      }),
      line('M10.2 3.4v9.2'),
    ])

    /**
     * The reveal-in-folder glyph: a folder outline. It stays a plain folder
     * rather than a folder-with-arrow, because the act is "show me where this
     * lives", and the app's own wording for it is equally plain.
     */
    /**
     * The folder, filled and two-tone, in the shape a desktop file manager uses.
     *
     * One glyph at three sizes: the kind a directory row is, and the thing both
     * "reveal this folder" buttons act on. An earlier version drew a thin outline
     * for the buttons and kept the filled one for rows, which made the same
     * object look like two — and at 15px that outline was a notched rectangle
     * nobody would read as a folder.
     *
     * It does not follow `currentColor`, and that is deliberate. These sit beside
     * multicolour file badges, where an outline reads as a lesser thing: a control
     * rather than a kind of file. The darker back plate carries the tab and the
     * lighter front face overlaps it, which is what keeps the shape legible small
     * — a single flat silhouette loses its tab by about this size.
     * @param {number} size - rendered box in CSS pixels.
     * @returns {object} the folder element.
     */
    const folderGlyph = size => React.createElement(
      'svg',
      { width: size, height: size, viewBox: '0 0 16 16', 'aria-hidden': 'true' },
      React.createElement('path', {
        fill: '#DDA032',
        d: 'M1.7 4.3a1.1 1.1 0 0 1 1.1-1.1h3.1l1.6 1.7h5.7a1.1 1.1 0 0 1 1.1 1.1v5.7a1.1 1.1 0 0 1-1.1 1.1H2.8a1.1 1.1 0 0 1-1.1-1.1z',
      }),
      React.createElement('path', {
        fill: '#F2C063',
        d: 'M1.7 6.9h12.6v4.9a1.1 1.1 0 0 1-1.1 1.1H2.8a1.1 1.1 0 0 1-1.1-1.1z',
      }),
    )

    /** A directory row's own icon, matching the file badges' optical size. */
    const DIR_ICON = folderGlyph(18)

    /** The reveal-in-folder control, in the header and at the end of a row. */
    const FOLDER_ICON = folderGlyph(16)

    /** Collapsed and expanded twisties: one glyph rotated, as a tree expects. */
    const TWISTY_CLOSED = svg(14, [line('M6.2 4.2 10 8l-3.8 3.8')])
    const TWISTY_OPEN = svg(14, [line('M4.2 6.2 8 10l3.8-3.8')])

    /**
     * Re-read the level: a circular arrow, open at the top with a head on it.
     * Drawn a touch heavier than the panel toggle because it sits at 16px beside a
     * filled folder, and a 1.2px stroke next to a solid shape reads as unfinished.
     */
    const RELOAD_ICON = svg(16, [
      line('M13.1 8a5.1 5.1 0 1 1-1.5-3.6', 1.5),
      line('M13.4 3.1v2.5h-2.5', 1.5),
    ])

    /**
     * File-type icons, in two kinds of art plus the table that picks between
     * them. Every block below is generated — see `assets/file-icons/README.md`.
     *
     * The badges are multicolour and carry their own contrast: a light page with
     * a coloured band reads as a distinct card on both themes, which is why they
     * are NOT recoloured to follow the row. The Lucide strokes are the opposite,
     * single-colour outlines that inherit the row's colour through
     * `currentColor`, and they cover the formats no badge was drawn for.
     *
     * Keys are the icon set manifest's own values — `'docx.svg'` is its `asset`
     * field, `FileText` its `fallback` — so every row here traces back to a line
     * there instead of to a name invented on this side. Nothing was transcribed:
     * 18 KB of path data copied by hand is 18 KB of chances to corrupt a curve.
     * No block carries an `id`, a `url(#…)` reference or a gradient, which is
     * what makes one element safe to render many times over.
     */
    const BADGE_ART = {
      'docx.svg': { box: '0 0 67 87', art: '<g><path fill="#E6E6DD" d="M47.195,0H2.234C0.989,0-0.03,1.02-0.03,2.995v82.449c0,0.535,1.02,1.555,2.264,1.555h62.077 c1.258,0,2.272-1.02,2.272-1.555v-65.28c0-1.082-0.148-1.432-0.401-1.685L48.153,0.402C47.9,0.147,47.557,0,47.195,0z"/></g><g><polygon fill="#D6D3C6" points="48.221,0.238 48.221,18.645 66.579,18.645 "/></g><g><path fill="#284C85" d="M64.311,86.999H2.234c-1.245,0-2.264-1.02-2.264-2.272V60.594h66.609v24.133 C66.579,85.979,65.568,86.999,64.311,86.999z"/></g><g><g><path fill="#FFFFFF" d="M17.365,73.432c0,1.295-0.138,2.396-0.41,3.305c-0.281,0.913-0.629,1.678-1.047,2.298 c-0.425,0.616-0.905,1.101-1.432,1.457c-0.531,0.353-1.045,0.616-1.538,0.795c-0.495,0.183-0.95,0.293-1.355,0.344 c-0.405,0.047-0.713,0.068-0.905,0.068H4.766V66.044h4.698c1.315,0,2.468,0.208,3.466,0.629c0.994,0.412,1.818,0.973,2.477,1.665 c0.654,0.692,1.147,1.486,1.47,2.366C17.204,71.592,17.365,72.497,17.365,73.432z M9.823,79.824c1.727,0,2.97-0.548,3.728-1.652 c0.76-1.108,1.141-2.706,1.141-4.805c0-0.646-0.072-1.295-0.228-1.929c-0.157-0.641-0.455-1.215-0.9-1.737 c-0.446-0.518-1.045-0.938-1.81-1.253c-0.767-0.323-1.752-0.48-2.969-0.48H7.302v11.849L9.823,79.824L9.823,79.824z"/></g><g><path fill="#FFFFFF" d="M32.813,73.801c0,1.313-0.162,2.473-0.493,3.483c-0.335,0.998-0.794,1.835-1.376,2.502 c-0.588,0.667-1.272,1.168-2.052,1.508c-0.782,0.34-1.644,0.51-2.577,0.51c-0.926,0-1.786-0.17-2.574-0.51 c-0.782-0.34-1.466-0.841-2.052-1.508c-0.588-0.667-1.043-1.504-1.376-2.502c-0.333-1.011-0.499-2.171-0.499-3.483 c0-1.321,0.17-2.48,0.499-3.479c0.332-0.998,0.786-1.831,1.376-2.489c0.588-0.667,1.27-1.177,2.052-1.524 c0.782-0.345,1.64-0.515,2.574-0.515c0.933,0,1.789,0.17,2.577,0.515c0.786,0.353,1.465,0.857,2.052,1.524 c0.582,0.667,1.047,1.491,1.376,2.489C32.652,71.315,32.813,72.476,32.813,73.801z M26.248,79.719 c0.521,0,1.024-0.099,1.495-0.307c0.472-0.212,0.896-0.543,1.271-1.007c0.374-0.471,0.665-1.087,0.875-1.844 c0.21-0.76,0.325-1.682,0.344-2.765c-0.013-1.066-0.125-1.972-0.331-2.715c-0.204-0.743-0.484-1.355-0.85-1.835 c-0.357-0.484-0.767-0.833-1.221-1.045c-0.467-0.213-0.948-0.319-1.461-0.319c-0.522,0-1.02,0.094-1.487,0.298 c-0.474,0.204-0.901,0.535-1.27,1.016c-0.376,0.471-0.669,1.083-0.879,1.835c-0.212,0.747-0.327,1.669-0.34,2.761 c0.013,1.063,0.125,1.967,0.323,2.719c0.212,0.752,0.493,1.364,0.85,1.84c0.361,0.479,0.771,0.819,1.232,1.041 C25.258,79.616,25.74,79.719,26.248,79.719z"/></g><g><path fill="#FFFFFF" d="M46.964,80.104c-0.582,0.562-1.234,0.986-1.97,1.271c-0.736,0.284-1.521,0.425-2.372,0.425 c-0.931,0-1.786-0.17-2.574-0.51c-0.777-0.34-1.466-0.837-2.052-1.508c-0.586-0.663-1.047-1.5-1.372-2.498 c-0.329-1.011-0.497-2.171-0.497-3.483c0-1.321,0.163-2.48,0.497-3.479c0.327-0.998,0.786-1.831,1.372-2.489 c0.588-0.667,1.274-1.177,2.068-1.524c0.782-0.345,1.645-0.519,2.562-0.519c0.848,0,1.632,0.145,2.373,0.425 c0.734,0.284,1.389,0.709,1.965,1.274l-1.759,1.571c-0.349-0.407-0.743-0.705-1.173-0.892c-0.433-0.188-0.879-0.276-1.342-0.276 c-0.522,0-1.024,0.098-1.496,0.298c-0.474,0.199-0.896,0.535-1.27,1.011c-0.372,0.476-0.665,1.083-0.875,1.835 c-0.211,0.752-0.327,1.674-0.345,2.766c0.018,1.058,0.126,1.967,0.332,2.719c0.203,0.752,0.488,1.359,0.85,1.835 c0.356,0.48,0.767,0.82,1.226,1.041c0.463,0.225,0.942,0.331,1.457,0.331c0.507,0,0.985-0.093,1.427-0.271 c0.444-0.191,0.854-0.488,1.22-0.896L46.964,80.104z"/></g></g><g enable-background="new "><path fill="#284C85" d="M50.507,21.381l-6.578,24.667h-5.848l-4.206-16.086c-0.227-0.871-0.352-1.775-0.401-2.719h-0.058 c-0.106,1.104-0.255,2.005-0.45,2.719l-4.301,16.086h-6.066l-6.578-24.667h5.769L25.452,38.1c0.161,0.735,0.271,1.657,0.34,2.77 h0.11c0.049-0.871,0.212-1.823,0.488-2.855l4.588-16.645h5.595l4.171,16.849c0.17,0.671,0.307,1.546,0.396,2.617h0.085 c0.042-0.926,0.161-1.827,0.361-2.71l3.578-16.755h5.34v0.011H50.507z"/></g><g enable-background="new "><path fill="#FFFFFF" d="M62.354,81.222h-3.641l-2.581-4.774c-0.098-0.174-0.191-0.493-0.289-0.943h-0.033 c-0.056,0.226-0.166,0.548-0.34,0.969l-2.59,4.749h-3.672l4.621-7.2l-4.222-7.188h3.74l2.143,4.396 c0.175,0.357,0.323,0.757,0.446,1.186h0.036c0.132-0.383,0.293-0.803,0.48-1.232l2.37-4.358h3.424l-4.346,7.137L62.354,81.222z"/></g>' },
      'html.svg': { box: '0 0 67 87', art: '<path fill="#E6E6DD" d="M47.4,0H2.5C1.2,0,0.2,1,0.2,3v82.5c0,0.5,1,1.6,2.3,1.6h62.1c1.2,0,2.3-1,2.3-1.6V20.2c0-1.1-0.1-1.4-0.4-1.7L48.4,0.4C48.1,0.1,47.8,0,47.4,0z"/><polygon fill="#D6D3C6" points="48.2,0.2 48.2,18.6 66.6,18.6"/><text x="33.5" y="45" text-anchor="middle" fill="#E44D26" font-family="Consolas, \'Courier New\', monospace" font-size="20" font-weight="900">&lt;/&gt;</text><path fill="#E44D26" d="M64.5,87H2.5C1.2,87,0.2,86,0.2,84.7V60.6h66.6v24.1C66.8,86,65.8,87,64.5,87z"/><text x="33.5" y="79" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Impact, \'Helvetica Neue\', sans-serif" font-size="13" font-weight="900" letter-spacing="0.5">HTML</text>' },
      'jpg.svg': { box: '0 0 1024 1024', art: '<path d="M675.82396 0H146.67196C131.94396 0 119.99996 11.984 119.99996 35.216v970.496C119.99996 1012.024 131.94396 1024 146.67196 1024h730.648c14.736 0 26.68-11.976 26.68-18.288v-768.4c0-12.728-1.688-16.824-4.68-19.84L687.16796 4.696A16.112 16.112 0 0 0 675.82396 0z" fill="#E9E9E0"></path><path d="M685.20796 2.76v216.672h216.04z" fill="#D9D7CA"></path><path d="M263.35196 263.88a83.552 83.304 90 1 0 166.608 0 83.552 83.304 90 1 0-166.608 0Z" fill="#F3D55B"></path><path d="M119.99996 713.144h784V512L721.67196 338.288l-191.44 210.28-99.968-100.256z" fill="#26B99A"></path><path d="M877.31996 1024H146.67196A26.72 26.72 0 0 1 119.99996 997.24V713.144h784v284.104A26.72 26.72 0 0 1 877.31996 1024z" fill="#14A085"></path><path d="M392.14396 779.888v143.504c0 8.672-1.584 15.968-4.744 21.872a39.184 39.184 0 0 1-12.704 14.24 50.584 50.584 0 0 1-18.328 7.496c-6.912 1.432-14 2.144-21.32 2.144-3.664 0-7.944-0.384-12.832-1.136a106.736 106.736 0 0 1-15.2-3.504 163.104 163.104 0 0 1-15.08-5.368c-4.832-2-8.896-4.24-12.216-6.752l12.704-20.232c1.664 1.152 4.024 2.376 7.112 3.616 3.064 1.248 6.432 2.416 10.096 3.496 3.648 1.104 7.48 2.032 11.472 2.864 3.992 0.84 7.728 1.24 11.208 1.24 8.808 0 15.824-1.72 21.056-5.112 5.232-3.408 8.008-9.224 8.352-17.376V779.888h30.424zM466.67196 967.896h-29.92V783.632h52.832c7.808 0 15.536 1.24 23.176 3.76 7.64 2.504 14.488 6.24 20.56 11.24a58.456 58.456 0 0 1 14.72 18.128c3.736 7.072 5.608 15.016 5.608 23.872 0 9.344-1.576 17.8-4.736 25.376-3.16 7.592-7.568 13.968-13.216 19.136-5.656 5.16-12.472 9.168-20.44 11.992-7.976 2.832-16.792 4.24-26.424 4.24h-22.184v66.52h0.024z m0-161.496v73h27.424c3.648 0 7.256-0.624 10.848-1.888 3.568-1.24 6.856-3.28 9.84-6.12 2.992-2.832 5.392-6.792 7.216-11.864 1.832-5.088 2.736-11.384 2.736-18.864 0-3-0.416-6.488-1.24-10.368a29.52 29.52 0 0 0-5.104-11.248c-2.592-3.592-6.2-6.592-10.848-9-4.664-2.432-10.808-3.64-18.448-3.64h-22.424zM721.67196 872.888v71.232a53.792 53.792 0 0 1-12.832 11.872 77.216 77.216 0 0 1-31.152 11.856c-5.576 0.872-11.088 1.28-16.568 1.28-10.984 0-21.064-2-30.288-6a67.84 67.84 0 0 1-24.176-17.752c-6.88-7.832-12.312-17.664-16.2-29.496-3.896-11.832-5.848-25.504-5.848-41s1.952-29.128 5.848-40.864c3.888-11.768 9.296-21.536 16.2-29.368a69.056 69.056 0 0 1 24.304-17.888c9.304-4.088 19.368-6.12 30.168-6.12 9.968 0 19.264 1.656 27.904 5a67.8 67.8 0 0 1 23.176 14.976l-20.696 18.504c-3.992-4.832-8.568-8.336-13.72-10.488a40.736 40.736 0 0 0-15.952-3.264c-6.152 0-12.008 1.168-17.568 3.504-5.576 2.336-10.552 6.296-14.944 11.864-4.416 5.584-7.856 12.776-10.336 21.632-2.488 8.84-3.832 19.648-4 32.488 0.168 12.512 1.456 23.336 3.864 32.496 2.408 9.168 5.728 16.664 9.976 22.504 4.24 5.832 9.056 10.168 14.456 13a36.256 36.256 0 0 0 17.096 4.232c1.808 0 4.256-0.128 7.344-0.376 3.048-0.256 6.144-0.664 9.216-1.248a58.184 58.184 0 0 0 8.848-2.376c2.832-1 4.896-2.408 6.224-4.24v-45.496h-31.16v-20.504h60.824v0.04z" fill="#FFFFFF"></path>' },
      'json.svg': { box: '0 0 67 87', art: '<path fill="#E6E6DD" d="M47.4,0H2.5C1.2,0,0.2,1,0.2,3v82.5c0,0.5,1,1.6,2.3,1.6h62.1c1.2,0,2.3-1,2.3-1.6V20.2c0-1.1-0.1-1.4-0.4-1.7L48.4,0.4C48.1,0.1,47.8,0,47.4,0z"/><polygon fill="#D6D3C6" points="48.2,0.2 48.2,18.6 66.6,18.6"/><text x="33.5" y="49" text-anchor="middle" fill="#0E42D2" font-family="Consolas, \'Courier New\', monospace" font-size="34" font-weight="700">{ }</text><path fill="#0E42D2" d="M64.5,87H2.5C1.2,87,0.2,86,0.2,84.7V60.6h66.6v24.1C66.8,86,65.8,87,64.5,87z"/><text x="33.5" y="79" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Impact, \'Helvetica Neue\', sans-serif" font-size="13" font-weight="900" letter-spacing="0.5">JSON</text>' },
      'md.svg': { box: '0 0 67 87', art: '<path fill="#E6E6DD" d="M47.4,0H2.5C1.2,0,0.2,1,0.2,3v82.5c0,0.5,1,1.6,2.3,1.6h62.1c1.2,0,2.3-1,2.3-1.6V20.2c0-1.1-0.1-1.4-0.4-1.7L48.4,0.4C48.1,0.1,47.8,0,47.4,0z"/><polygon fill="#D6D3C6" points="48.2,0.2 48.2,18.6 66.6,18.6"/><text x="33.5" y="47" text-anchor="middle" fill="#083FA1" font-family="Arial Black, Impact, \'Helvetica Neue\', sans-serif" font-size="30" font-weight="900">M</text><path fill="#083FA1" d="M64.5,87H2.5C1.2,87,0.2,86,0.2,84.7V60.6h66.6v24.1C66.8,86,65.8,87,64.5,87z"/><text x="33.5" y="79" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Impact, \'Helvetica Neue\', sans-serif" font-size="15" font-weight="900" letter-spacing="1">MD</text>' },
      'pdf.svg': { box: '0 0 67 87', art: '<path fill="#E6E6DD" d="M47.421,0H2.464C1.209,0,0.196,1.019,0.196,2.991v82.454C0.196,85.979,1.209,87,2.464,87h62.072 c1.249,0,2.269-1.021,2.269-1.556V20.16c0-1.081-0.143-1.428-0.399-1.683L48.381,0.398C48.126,0.144,47.779,0,47.421,0z"/><polygon fill="#D6D3C6" points="48.213,0.233 48.213,18.641 66.57,18.641 "/><path fill="#B24948" d="M20.353,51.773L20.353,51.773c-0.535,0-1.051-0.176-1.498-0.508c-1.614-1.21-1.831-2.563-1.727-3.484 c0.282-2.523,3.398-5.171,9.267-7.872c2.334-5.12,4.55-11.429,5.869-16.702c-1.542-3.375-3.043-7.751-1.954-10.323 c0.389-0.899,0.871-1.59,1.761-1.887c0.353-0.118,1.249-0.268,1.576-0.268c0.777,0,1.463,1.005,1.954,1.629 c0.456,0.585,1.489,1.82-0.584,10.568c2.09,4.324,5.051,8.73,7.882,11.747c2.035-0.367,3.783-0.559,5.204-0.559 c2.424,0,3.896,0.566,4.494,1.735c0.499,0.969,0.296,2.095-0.605,3.356c-0.864,1.214-2.054,1.851-3.438,1.851 c-1.882,0-4.078-1.194-6.523-3.549c-4.392,0.92-9.527,2.566-13.671,4.385c-1.3,2.757-2.534,4.973-3.691,6.605 C23.084,50.732,21.712,51.773,20.353,51.773z M24.481,43.807c-3.311,1.868-4.667,3.399-4.762,4.261 c-0.015,0.144-0.053,0.515,0.673,1.079C20.62,49.07,21.964,48.455,24.481,43.807z M45.603,36.908 c1.262,0.974,1.571,1.466,2.396,1.466c0.365,0,1.398-0.013,1.88-0.683c0.224-0.324,0.321-0.533,0.353-0.647 c-0.195-0.099-0.443-0.305-1.824-0.305C47.631,36.738,46.646,36.773,45.603,36.908z M34.029,26.683 c-1.105,3.841-2.568,7.993-4.142,11.749c3.243-1.261,6.763-2.362,10.072-3.138C37.86,32.857,35.777,29.817,34.029,26.683z M33.088,13.536c-0.151,0.052-2.058,2.729,0.151,4.996C34.711,15.245,33.156,13.511,33.088,13.536z"/><path fill="#B24948" d="M64.536,87H2.464c-1.255,0-2.269-1.021-2.269-2.273V60.588h66.609v24.139C66.805,85.979,65.787,87,64.536,87 z"/><g><path fill="#FFFFFF" d="M17.056,82.34h-2.541V66.688h4.488c0.66,0,1.319,0.104,1.967,0.319c0.647,0.214,1.228,0.531,1.746,0.955 c0.516,0.424,0.935,0.936,1.253,1.535c0.316,0.604,0.478,1.281,0.478,2.032c0,0.789-0.138,1.509-0.406,2.156 c-0.268,0.642-0.642,1.186-1.126,1.621c-0.476,0.438-1.058,0.776-1.731,1.021c-0.682,0.239-1.425,0.363-2.241,0.363h-1.897 L17.056,82.34L17.056,82.34L17.056,82.34z M17.056,68.614v6.203h2.328c0.306,0,0.614-0.051,0.922-0.156 c0.299-0.103,0.582-0.28,0.837-0.519c0.255-0.241,0.457-0.578,0.614-1.011c0.157-0.431,0.236-0.966,0.236-1.601 c0-0.255-0.042-0.55-0.106-0.882c-0.072-0.332-0.216-0.651-0.438-0.952c-0.223-0.309-0.522-0.563-0.921-0.766 c-0.393-0.206-0.916-0.309-1.57-0.309h-1.91L17.056,68.614L17.056,68.614L17.056,68.614z"/><path fill="#FFFFFF" d="M40.037,74.078c0,1.287-0.138,2.388-0.418,3.302c-0.273,0.915-0.62,1.679-1.043,2.294 c-0.418,0.618-0.902,1.105-1.432,1.462c-0.522,0.35-1.041,0.617-1.535,0.794c-0.49,0.178-0.941,0.287-1.354,0.342 c-0.408,0.048-0.705,0.068-0.909,0.068H27.44V66.688h4.698c1.313,0,2.471,0.208,3.464,0.629c0.992,0.417,1.823,0.974,2.477,1.665 c0.654,0.692,1.144,1.483,1.47,2.365C39.874,72.229,40.037,73.138,40.037,74.078z M32.495,80.47c1.726,0,2.966-0.552,3.726-1.654 c0.758-1.105,1.141-2.704,1.141-4.803c0-0.65-0.07-1.296-0.225-1.936c-0.158-0.635-0.459-1.21-0.903-1.731 c-0.444-0.516-1.052-0.936-1.81-1.255c-0.767-0.313-1.754-0.481-2.967-0.481H29.98v11.856h2.515V80.47z"/><path fill="#FFFFFF" d="M46.306,68.614v4.935h6.521v1.741h-6.521v7.05h-2.585V66.688h9.764v1.931L46.306,68.614L46.306,68.614z"/></g>' },
      'pptx.svg': { box: '0 0 67 87', art: '<path fill="#E6E6DD" d="M47.4,0H2.5C1.2,0,0.2,1,0.2,3v82.5c0,0.5,1,1.6,2.3,1.6h62.1c1.2,0,2.3-1,2.3-1.6V20.2c0-1.1-0.1-1.4-0.4-1.7L48.4,0.4C48.1,0.1,47.8,0,47.4,0z"/><polygon fill="#D6D3C6" points="48.2,0.2 48.2,18.6 66.6,18.6"/><text x="33.5" y="47" text-anchor="middle" fill="#B7472A" font-family="Arial Black, Impact, \'Helvetica Neue\', sans-serif" font-size="34" font-weight="900">P</text><path fill="#B7472A" d="M64.5,87H2.5C1.2,87,0.2,86,0.2,84.7V60.6h66.6v24.1C66.8,86,65.8,87,64.5,87z"/><text x="33.5" y="79" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Impact, \'Helvetica Neue\', sans-serif" font-size="14" font-weight="900" letter-spacing="0.5">PPT</text>' },
      'txt.svg': { box: '0 0 67 87', art: '<path fill="#E6E6DD" d="M47.4,0H2.5C1.2,0,0.2,1,0.2,3v82.5c0,0.5,1,1.6,2.3,1.6h62.1c1.2,0,2.3-1,2.3-1.6V20.2c0-1.1-0.1-1.4-0.4-1.7L48.4,0.4C48.1,0.1,47.8,0,47.4,0z"/><polygon fill="#D6D3C6" points="48.2,0.2 48.2,18.6 66.6,18.6"/><rect x="14" y="30" width="35" height="3" rx="1.5" fill="#646A73"/><rect x="14" y="38" width="30" height="3" rx="1.5" fill="#646A73"/><rect x="14" y="46" width="33" height="3" rx="1.5" fill="#646A73"/><path fill="#646A73" d="M64.5,87H2.5C1.2,87,0.2,86,0.2,84.7V60.6h66.6v24.1C66.8,86,65.8,87,64.5,87z"/><text x="33.5" y="79" text-anchor="middle" fill="#FFFFFF" font-family="Arial Black, Impact, \'Helvetica Neue\', sans-serif" font-size="15" font-weight="900" letter-spacing="1">TXT</text>' },
      'xlsx.svg': { box: '0 0 67 87', art: '<g><path fill="#E6E6DD" d="M47.418,0H2.463C1.218,0,0.199,1.02,0.199,2.992v82.45c0,0.538,1.019,1.557,2.264,1.557h62.078 c1.249,0,2.269-1.019,2.269-1.557v-65.28c0-1.079-0.146-1.425-0.403-1.687L48.384,0.401C48.124,0.144,47.78,0,47.418,0z"/></g><g><polygon fill="#D6D3C6" points="47.904,0 47.904,18.049 65.815,18.049 "/></g><g><path fill="#247238" d="M64.613,86.995H2.391c-1.254,0-2.273-1.027-2.273-2.281V60.447h66.764v24.267 C66.882,85.968,65.865,86.995,64.613,86.995z"/></g><g enable-background="new "><path fill="#247238" d="M19.859,43.326l9.079-12.965l-8.7-12.201h8.133l4.456,6.913l4.691-6.913h7.821l-8.533,11.92l9.318,13.246 h-8.174l-5.124-7.796l-5.162,7.796H19.859L19.859,43.326z"/></g><g enable-background="new "><path fill="#FFFFFF" d="M8.852,80.231l4.619-7.05l-4.184-6.461h3.19l2.706,4.342l2.655-4.342H21l-4.205,6.563l4.619,6.951h-3.292 l-2.994-4.678l-3.002,4.678H8.852V80.231z"/><path fill="#FFFFFF" d="M22.89,80.231V66.832h2.729v11.122h6.786v2.277H22.89z"/><path fill="#FFFFFF" d="M33.653,75.839l2.659-0.261c0.155,0.892,0.482,1.549,0.971,1.962c0.488,0.418,1.146,0.627,1.975,0.627 c0.878,0,1.543-0.184,1.987-0.559c0.443-0.371,0.669-0.806,0.669-1.301c0-0.319-0.094-0.593-0.281-0.818 c-0.188-0.227-0.516-0.418-0.98-0.585c-0.318-0.11-1.048-0.311-2.188-0.593c-1.463-0.362-2.486-0.806-3.074-1.334 c-0.832-0.742-1.243-1.651-1.243-2.722c0-0.687,0.191-1.33,0.584-1.932c0.388-0.597,0.953-1.054,1.685-1.364 c0.737-0.316,1.625-0.474,2.661-0.474c1.697,0,2.973,0.371,3.83,1.117c0.856,0.742,1.309,1.735,1.352,2.977l-2.729,0.12 c-0.115-0.695-0.367-1.194-0.751-1.497c-0.386-0.308-0.959-0.457-1.727-0.457c-0.794,0-1.416,0.158-1.866,0.486 c-0.29,0.209-0.435,0.49-0.435,0.841c0,0.319,0.139,0.593,0.407,0.818c0.345,0.29,1.181,0.593,2.505,0.904 c1.331,0.315,2.314,0.64,2.949,0.973c0.636,0.337,1.135,0.793,1.493,1.373s0.537,1.301,0.537,2.153 c0,0.772-0.213,1.497-0.644,2.171c-0.432,0.678-1.037,1.182-1.826,1.51c-0.784,0.328-1.766,0.49-2.938,0.49 c-1.711,0-3.02-0.393-3.938-1.182C34.379,78.495,33.833,77.349,33.653,75.839z"/><path fill="#FFFFFF" d="M45.564,80.231l4.619-7.05l-4.188-6.461h3.19l2.712,4.342l2.653-4.342h3.16l-4.201,6.563l4.617,6.951 h-3.293l-2.993-4.678l-3.007,4.678h-3.27V80.231z"/></g>' },
    }

    const STROKE_ART = {
      BookOpen: '<path d="M12 7v14"></path><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"></path>',
      Braces: '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1"></path><path d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1"></path>',
      File: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path>',
      FileArchive: '<path d="M13.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v11.5"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M8 12v-1"></path><path d="M8 18v-2"></path><path d="M8 7V6"></path><circle cx="8" cy="20" r="2"></circle>',
      FileCode: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M10 12.5 8 15l2 2.5"></path><path d="m14 12.5 2 2.5-2 2.5"></path>',
      FileImage: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><circle cx="10" cy="12" r="2"></circle><path d="m20 17-1.296-1.296a2.41 2.41 0 0 0-3.408 0L9 22"></path>',
      FileMusic: '<path d="M11.65 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v10.35"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M8 20v-7l3 1.474"></path><circle cx="6" cy="20" r="2"></circle>',
      FileSpreadsheet: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M8 13h2"></path><path d="M14 13h2"></path><path d="M8 17h2"></path><path d="M14 17h2"></path>',
      FileText: '<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"></path><path d="M14 2v5a1 1 0 0 0 1 1h5"></path><path d="M10 9H8"></path><path d="M16 13H8"></path><path d="M16 17H8"></path>',
      Film: '<rect width="18" height="18" x="3" y="3" rx="2"></rect><path d="M7 3v18"></path><path d="M3 7.5h4"></path><path d="M3 12h18"></path><path d="M3 16.5h4"></path><path d="M17 3v18"></path><path d="M17 7.5h4"></path><path d="M17 16.5h4"></path>',
      Globe: '<circle cx="12" cy="12" r="10"></circle><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"></path><path d="M2 12h20"></path>',
      Presentation: '<path d="M2 3h20"></path><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"></path><path d="m7 21 5-5 5 5"></path>',
    }

    /**
     * The page, folded corner and bottom band that the set's own `txt`, `md`,
     * `html`, `json` and `pptx` badges all share, read back out of `txt.svg`.
     * Code badges are built from these rather than drawn, so they are siblings
     * of the set's document badges and not a second visual language.
     */
    const PAGE_SHELL = {
      page: 'M47.4,0H2.5C1.2,0,0.2,1,0.2,3v82.5c0,0.5,1,1.6,2.3,1.6h62.1c1.2,0,2.3-1,2.3-1.6V20.2c0-1.1-0.1-1.4-0.4-1.7L48.4,0.4C48.1,0.1,47.8,0,47.4,0z',
      corner: '48.2,0.2 48.2,18.6 66.6,18.6',
      band: 'M64.5,87H2.5C1.2,87,0.2,86,0.2,84.7V60.6h66.6v24.1C66.8,86,65.8,87,64.5,87z',
    }

    /**
     * One badge per language. The manifest folds every language into a single
     * `code` family, which is right for a document app and wrong here: in a
     * session ledger nearly every row is code, so one shared glyph for all of
     * them carries no information.
     *
     * The label does the distinguishing, not the colour. Four of these languages
     * are conventionally blue, and at 16px four blues are one blue — but `PY`,
     * `TS`, `TSX` and `JSX` are four different shapes at any size. The colour
     * rides along as a second signal, which is also how the set's own `docx`,
     * `md` and `xlsx` badges are built: a big mark in the middle over a coloured
     * band.
     */
    const CODE_BADGES = [
      { name: 'js', label: 'JS', colour: '#B8860B',
        ext: ['js', 'mjs', 'cjs'] },
      { name: 'ts', label: 'TS', colour: '#3178C6',
        ext: ['ts', 'mts', 'cts'] },
      { name: 'jsx', label: 'JSX', colour: '#1B7F9E',
        ext: ['jsx'] },
      { name: 'tsx', label: 'TSX', colour: '#2B6CB0',
        ext: ['tsx'] },
      { name: 'py', label: 'PY', colour: '#3572A5',
        ext: ['py', 'pyi', 'pyw'] },
      { name: 'go', label: 'GO', colour: '#0B7285',
        ext: ['go'] },
      { name: 'rs', label: 'RS', colour: '#AB4B1E',
        ext: ['rs'] },
      { name: 'java', label: 'JAVA', colour: '#A2661C',
        ext: ['java'] },
      { name: 'kt', label: 'KT', colour: '#6A3DE8',
        ext: ['kt', 'kts'] },
      { name: 'swift', label: 'SW', colour: '#D9421F',
        ext: ['swift'] },
      { name: 'c', label: 'C', colour: '#5A6B8C',
        ext: ['c', 'h'] },
      { name: 'cpp', label: 'C++', colour: '#00599C',
        ext: ['cpp', 'cc', 'cxx', 'hpp', 'hh'] },
      { name: 'cs', label: 'C#', colour: '#68217A',
        ext: ['cs'] },
      { name: 'rb', label: 'RB', colour: '#A41E11',
        ext: ['rb'] },
      { name: 'php', label: 'PHP', colour: '#4F5B93',
        ext: ['php'] },
      { name: 'sh', label: 'SH', colour: '#3E8E1E',
        ext: ['sh', 'bash', 'zsh', 'fish'] },
      { name: 'ps', label: 'PS', colour: '#01579B',
        ext: ['ps1', 'psm1', 'bat', 'cmd'] },
      { name: 'sql', label: 'SQL', colour: '#B45309',
        ext: ['sql'] },
      { name: 'css', label: 'CSS', colour: '#663399',
        ext: ['css', 'scss', 'sass', 'less'] },
      { name: 'vue', label: 'VUE', colour: '#2F855A',
        ext: ['vue'] },
      { name: 'svelte', label: 'SV', colour: '#D63A00',
        ext: ['svelte'] },
      { name: 'lua', label: 'LUA', colour: '#2C2D72',
        ext: ['lua'] },
    ]

    /**
     * `label` and `colour` are compile-time constants, checked by the generator
     * to be 1-4 capitals and a `#RRGGBB` value, so neither can carry markup into
     * the string below.
     * @param {string} label - the band's text, 1 to 4 capitals.
     * @param {string} colour - the band and centre-glyph fill, as `#RRGGBB`.
     * @returns {{ box: string, art: string }} a badge in the set's page style.
     */
    function codeBadge(label, colour) {
      // Sized for the row, not for a preview. A 67x87 page drawn at 16px leaves
      // the bottom band about four pixels tall, so anything written inside it is
      // under three pixels and reads as a smudge — which is why the band here
      // carries no text and the mark goes in the middle at a size that survives.
      const size = label.length >= 3 ? 26 : 34
      return {
        box: '0 0 67 87',
        art: `<path fill="#E6E6DD" d="${PAGE_SHELL.page}"/>`
          + `<polygon fill="#D6D3C6" points="${PAGE_SHELL.corner}"/>`
          + `<text x="33.5" y="48" text-anchor="middle" fill="${colour}"`
          + ` font-family="Arial Black, Impact, 'Helvetica Neue', sans-serif"`
          + ` font-size="${size}" font-weight="900">${label}</text>`
          + `<path fill="${colour}" d="${PAGE_SHELL.band}"/>`,
      }
    }

    for (const badge of CODE_BADGES) BADGE_ART[`code:${badge.name}`] = codeBadge(badge.label, badge.colour)

    /**
     * `dangerouslySetInnerHTML` is the honest tool here. These strings are
     * compile-time constants in this file, generated from SVG files vendored in
     * this package — no value from a session, a tool or a model can reach them.
     * The alternative is transcribing every path into a `createElement` tree,
     * which trades a reviewed generator for hand-copied geometry.
     * @param {{ box: string, art: string }} badge - viewBox and inner markup.
     * @returns {object} the badge element, at its own palette.
     */
    function badgeIcon(badge) {
      return React.createElement('svg', {
        width: 20,
        height: 20,
        viewBox: badge.box,
        'aria-hidden': 'true',
        dangerouslySetInnerHTML: { __html: badge.art },
      })
    }

    /**
     * @param {string} art - inner markup of a 24x24 Lucide glyph.
     * @returns {object} the stroke element, inheriting the row's colour.
     */
    function strokeIcon(art) {
      return React.createElement('svg', {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        'stroke-width': 1.8,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'aria-hidden': 'true',
        dangerouslySetInnerHTML: { __html: art },
      })
    }

    /**
     * Families and their extensions, lifted from the icon set's manifest and
     * then split per language for code. It already pairs each family with a
     * badge and a stroke to fall back to, and that pairing is a design decision
     * worth carrying across rather than re-deciding here — which also means a
     * family with no badge (`audio`, `video`, `archive`, `ebook`) is the manifest
     * saying none was drawn, not an omission.
     *
     * The generator checks that no extension the manifest mapped changed its
     * fallback on the way over: a code badge may change the picture a row shows,
     * never which family it belongs to.
     */
    const FAMILIES = [
      { key: 'pdf', badge: 'pdf.svg', stroke: 'FileText',
        ext: ['pdf'] },
      { key: 'word', badge: 'docx.svg', stroke: 'FileText',
        ext: ['doc', 'docx', 'wps', 'odt'] },
      { key: 'excel', badge: 'xlsx.svg', stroke: 'FileSpreadsheet',
        ext: ['xls', 'xlsx', 'csv', 'et', 'ods', 'xlsm', 'tsv', 'parquet'] },
      { key: 'ppt', badge: 'pptx.svg', stroke: 'Presentation',
        ext: ['ppt', 'pptx', 'dps', 'odp'] },
      { key: 'svg', stroke: 'FileCode',
        ext: ['svg'] },
      { key: 'image', badge: 'jpg.svg', stroke: 'FileImage',
        ext: ['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'tiff', 'tif', 'ico', 'avif'] },
      { key: 'audio', stroke: 'FileMusic',
        ext: ['mp3', 'wav', 'm4a', 'flac', 'aac', 'ogg', 'wma', 'amr'] },
      { key: 'video', stroke: 'Film',
        ext: ['mp4', 'avi', 'mov', 'mkv', 'wmv', 'flv', 'webm', 'm4v', 'mpeg'] },
      { key: 'archive', stroke: 'FileArchive',
        ext: ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'tgz', 'zst'] },
      { key: 'data', badge: 'json.svg', stroke: 'Braces',
        ext: ['json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'jsonc', 'json5', 'ndjson', 'cfg', 'conf', 'env', 'properties', 'lock'] },
      { key: 'web', badge: 'html.svg', stroke: 'Globe',
        ext: ['html', 'htm', 'mhtml'] },
      { key: 'ebook', stroke: 'BookOpen',
        ext: ['epub', 'mobi', 'azw3'] },
      { key: 'code', stroke: 'FileCode',
        ext: ['pl', 'r', 'rake', 'gradle'] },
      { key: 'markdown', badge: 'md.svg', stroke: 'FileText',
        ext: ['md', 'markdown', 'mdx'] },
      { key: 'text', badge: 'txt.svg', stroke: 'FileText',
        ext: ['txt', 'log', 'rtf', 'tex'] },
      { key: 'code-js', badge: 'code:js', stroke: 'FileCode',
        ext: ['js', 'mjs', 'cjs'] },
      { key: 'code-ts', badge: 'code:ts', stroke: 'FileCode',
        ext: ['ts', 'mts', 'cts'] },
      { key: 'code-jsx', badge: 'code:jsx', stroke: 'FileCode',
        ext: ['jsx'] },
      { key: 'code-tsx', badge: 'code:tsx', stroke: 'FileCode',
        ext: ['tsx'] },
      { key: 'code-py', badge: 'code:py', stroke: 'FileCode',
        ext: ['py', 'pyi', 'pyw'] },
      { key: 'code-go', badge: 'code:go', stroke: 'FileCode',
        ext: ['go'] },
      { key: 'code-rs', badge: 'code:rs', stroke: 'FileCode',
        ext: ['rs'] },
      { key: 'code-java', badge: 'code:java', stroke: 'FileCode',
        ext: ['java'] },
      { key: 'code-kt', badge: 'code:kt', stroke: 'FileCode',
        ext: ['kt', 'kts'] },
      { key: 'code-swift', badge: 'code:swift', stroke: 'FileCode',
        ext: ['swift'] },
      { key: 'code-c', badge: 'code:c', stroke: 'FileCode',
        ext: ['c', 'h'] },
      { key: 'code-cpp', badge: 'code:cpp', stroke: 'FileCode',
        ext: ['cpp', 'cc', 'cxx', 'hpp', 'hh'] },
      { key: 'code-cs', badge: 'code:cs', stroke: 'FileCode',
        ext: ['cs'] },
      { key: 'code-rb', badge: 'code:rb', stroke: 'FileCode',
        ext: ['rb'] },
      { key: 'code-php', badge: 'code:php', stroke: 'FileCode',
        ext: ['php'] },
      { key: 'code-sh', badge: 'code:sh', stroke: 'FileCode',
        ext: ['sh', 'bash', 'zsh', 'fish'] },
      { key: 'code-ps', badge: 'code:ps', stroke: 'FileCode',
        ext: ['ps1', 'psm1', 'bat', 'cmd'] },
      { key: 'code-sql', badge: 'code:sql', stroke: 'FileCode',
        ext: ['sql'] },
      { key: 'code-css', badge: 'code:css', stroke: 'FileCode',
        ext: ['css', 'scss', 'sass', 'less'] },
      { key: 'code-vue', badge: 'code:vue', stroke: 'FileCode',
        ext: ['vue'] },
      { key: 'code-svelte', badge: 'code:svelte', stroke: 'FileCode',
        ext: ['svelte'] },
      { key: 'code-lua', badge: 'code:lua', stroke: 'FileCode',
        ext: ['lua'] },
    ]

    /**
     * Extension to its ready-made element. Each family's icon is built once,
     * here, rather than per row: a session with two hundred entries would
     * otherwise rebuild the same element two hundred times.
     */
    const ICON_BY_EXT = new Map()
    for (const family of FAMILIES) {
      const badge = family.badge === undefined ? undefined : BADGE_ART[family.badge]
      const icon = badge === undefined ? strokeIcon(STROKE_ART[family.stroke]) : badgeIcon(badge)
      for (const ext of family.ext) ICON_BY_EXT.set(ext, icon)
    }

    /** What a name with no recognized format gets. */
    const GENERIC_ICON = strokeIcon(STROKE_ART.File)

    /**
     * The icon for one file name.
     *
     * A leading dot is a name, not an extension: `.gitignore` and `.env` have no
     * format after the dot to report, so a dot at position zero falls through to
     * the generic page rather than reading `gitignore` as a type.
     * @param {string} name - the file's basename.
     * @returns {object} the icon element for its family.
     */
    function iconFor(name) {
      const dot = name.lastIndexOf('.')
      if (dot <= 0) return GENERIC_ICON
      return ICON_BY_EXT.get(name.slice(dot + 1).toLowerCase()) ?? GENERIC_ICON
    }

    /** Indentation per tree level, in CSS pixels. */
    const INDENT = 14

    /**
     * What this session produced, pinned above the tree.
     *
     * The tree already contains these files — they are on disk like everything
     * else — so this repeats them on purpose. A directory listing answers "what
     * is here"; it cannot answer "what did this conversation just make", and that
     * second question is the one a reader has right after a turn finishes.
     * Hunting for the answer among two hundred sibling files is the work this
     * removes.
     *
     * Only produced, not consulted: the section is about output. What the session
     * merely read is still marked in the tree, where it costs a dot.
     * @param {object} props - rows, openers and copy.
     * @returns {object | null} the section, or null when this session made nothing.
     */
    function OutputList(props) {
      if (props.rows.length === 0) return null
      return React.createElement(
        'section',
        { className: CLASS.outputs },
        React.createElement(
          'div',
          { className: CLASS.head },
          React.createElement('h3', { className: CLASS.title }, props.t('output.title')),
          React.createElement('span', { className: CLASS.count }, props.t('section.count', { count: String(props.rows.length) })),
        ),
        React.createElement(
          'ul',
          { className: CLASS.tree },
          props.rows.map(row => React.createElement(
            'li',
            { key: row.path, className: CLASS.entry },
            React.createElement(
              'button',
              {
                type: 'button',
                className: CLASS.row,
                title: row.path,
                onClick: () => { props.onOpenFile(row.path) },
              },
              React.createElement('span', { className: CLASS.leafPad }),
              React.createElement('span', { className: CLASS.icon }, iconFor(row.name)),
              React.createElement('span', { className: CLASS.name }, row.name),
            ),
            props.onRevealDir === undefined
              ? null
              : React.createElement(
                'button',
                {
                  type: 'button',
                  className: CLASS.folder,
                  'aria-label': props.showInFolder(row.name),
                  title: props.showInFolder(row.name),
                  onClick: () => { props.onRevealDir(splitPath(row.path).dir) },
                },
                FOLDER_ICON,
              ),
          )),
        ),
      )
    }

    /**
     * Flatten the loaded levels into the rows to draw, depth first.
     *
     * Only opened folders contribute children, so the walk visits exactly what is
     * on screen. A folder that is open but still arriving contributes one
     * placeholder row instead of nothing, because a folder that swallows a click
     * and shows no change reads as broken.
     * @param {object} tree - the hook's `{ root, levels, open }`.
     * @param {string} path - directory to walk.
     * @param {number} depth - indentation level of its children.
     * @param {object[]} out - accumulator, mutated.
     */
    function walkLevels(tree, path, depth, out) {
      const level = tree.levels.get(path)
      if (level === undefined) return
      if (level.pending === true) {
        out.push({ kind: 'pending', path: `${path}\u0000pending`, depth })
        return
      }
      if (level.error !== undefined) {
        out.push({ kind: 'error', path: `${path}\u0000error`, depth, reason: level.error })
        return
      }
      if (level.entries.length === 0) {
        out.push({ kind: 'empty', path: `${path}\u0000empty`, depth })
        return
      }
      for (const entry of level.entries) {
        out.push({ kind: 'entry', ...entry, depth })
        if (entry.type === 'directory' && tree.open.has(entry.path)) {
          walkLevels(tree, entry.path, depth + 1, out)
        }
      }
      if (level.truncated === true) {
        out.push({ kind: 'truncated', path: `${path}\u0000more`, depth, shown: level.entries.length })
      }
    }

    /**
     * The workspace tree.
     *
     * Filtering collapses the tree into a flat result list rather than pruning
     * branches: the box says "filter", and a reader who typed a name wants the
     * matches, not the shape of the folders around them. It reaches only what has
     * been loaded, which is honest — an unopened folder's contents are not on this
     * side to search, and pretending otherwise would mean walking the whole disk
     * on every keystroke.
     * @param {object} props - tree state, provenance, openers and copy.
     * @returns {object} the tree list.
     */
    function WorkspaceTree(props) {
      const tree = props.tree
      const t = props.t
      const filter = props.filter.trim().toLowerCase()

      const rows = React.useMemo(() => {
        if (tree.root === undefined) return []
        if (filter === '') {
          const out = []
          walkLevels(tree, tree.root, 0, out)
          return out
        }
        const hits = []
        for (const [, level] of tree.levels) {
          for (const entry of level.entries ?? []) {
            if (entry.name.toLowerCase().includes(filter)) hits.push({ kind: 'entry', ...entry, depth: 0, flat: true })
          }
        }
        return hits.sort((left, right) => left.name.localeCompare(right.name))
      }, [tree, filter])

      if (rows.length === 0) {
        return React.createElement(
          'p',
          { className: CLASS.empty },
          filter === '' ? t('tree.empty') : t('tree.noMatch'),
        )
      }

      return React.createElement(
        'ul',
        { className: CLASS.tree, role: 'tree', 'aria-label': t('tree.aria') },
        rows.map((row) => {
          const pad = { paddingLeft: 8 + row.depth * INDENT }
          if (row.kind !== 'entry') {
            const text = row.kind === 'pending'
              ? t('tree.loading')
              : row.kind === 'error'
                ? t('tree.error', { reason: row.reason })
                : row.kind === 'truncated'
                  ? t('tree.truncated', { count: String(row.shown) })
                  : t('tree.empty')
            return React.createElement(
              'li',
              { key: row.path, className: CLASS.note, style: pad },
              text,
            )
          }
          const directory = row.type === 'directory'
          const expanded = tree.open.has(row.path)
          const mark = props.markFor(row.path)
          return React.createElement(
            'li',
            { key: row.path, className: CLASS.entry, role: 'treeitem', 'aria-expanded': directory ? expanded : undefined },
            React.createElement(
              'button',
              {
                type: 'button',
                className: CLASS.row,
                style: pad,
                title: row.path,
                'aria-label': directory
                  ? t(expanded ? 'tree.collapse' : 'tree.expand', { name: row.name })
                  : undefined,
                onClick: () => { (directory ? props.onToggle : props.onOpenFile)(row.path) },
              },
              directory && row.flat !== true
                ? React.createElement('span', { className: CLASS.twisty }, expanded ? TWISTY_OPEN : TWISTY_CLOSED)
                : React.createElement('span', { className: CLASS.leafPad }),
              React.createElement('span', { className: CLASS.icon }, directory ? DIR_ICON : iconFor(row.name)),
              React.createElement('span', { className: CLASS.name }, row.name),
              // A dot, not the tool names. Which tools touched a file is worth
              // keeping and was not worth the width it took beside the filename
              // the reader came for, so it moves into the dot's tooltip.
              mark === undefined
                ? null
                : React.createElement('span', {
                  className: CLASS.mark,
                  'data-role': mark.role,
                  title: props.t(`mark.${mark.role}`, { tools: mark.tools }),
                }),
            ),
            props.onRevealDir === undefined
              ? null
              : React.createElement(
                'button',
                {
                  type: 'button',
                  className: CLASS.folder,
                  'aria-label': props.showInFolder(row.name),
                  title: props.showInFolder(row.name),
                  // A folder reveals itself; a file reveals the folder holding it.
                  onClick: () => { props.onRevealDir(directory ? row.path : splitPath(row.path).dir) },
                },
                FOLDER_ICON,
              ),
          )
        }),
      )
    }

    function Section(props) {
      const groups = props.groups
      const openFile = props.openFile
      const openDir = props.openDir
      return React.createElement(
        'section',
        { className: CLASS.section },
        React.createElement(
          'div',
          { className: CLASS.head },
          React.createElement('h3', { className: CLASS.title }, props.title),
          groups.length > 0 ? React.createElement('span', { className: CLASS.count }, props.count) : null,
        ),
        groups.length === 0
          ? React.createElement('p', { className: CLASS.empty }, props.empty)
          : React.createElement(
            'div',
            { className: CLASS.groups },
            groups.map(group => React.createElement(
              'div',
              { key: group.dir, className: CLASS.group },
              group.label === '' && !group.outside
                ? null
                : React.createElement(
                  'div',
                  { className: CLASS.dirRow },
                  React.createElement('span', { className: CLASS.dir, title: group.dir }, group.label),
                  group.outside
                    ? React.createElement(
                      'span',
                      { className: CLASS.outside, title: props.outsideTitle },
                      props.outsideTag,
                    )
                    : null,
                ),
              React.createElement(
                'ul',
                { className: CLASS.list },
                group.rows.map(row => React.createElement(
                  'li',
                  { key: row.path, className: CLASS.entry },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: CLASS.row,
                      title: row.path,
                      onClick: () => { openFile(row.path) },
                    },
                    React.createElement('span', { className: CLASS.icon }, iconFor(row.name)),
                    React.createElement('span', { className: CLASS.name }, row.name),
                    React.createElement('span', { className: CLASS.tools }, row.tools),
                  ),
                  // Only when the deployment can actually reach a desktop. The
                  // app hides its own folder shortcut on the same condition
                  // rather than offering a control that cannot work, and a
                  // browser on another machine must not be able to make the
                  // host's desktop open windows.
                  openDir === undefined
                    ? null
                    : React.createElement(
                      'button',
                      {
                        type: 'button',
                        className: CLASS.folder,
                        'aria-label': props.showInFolder(row.name),
                        title: props.showInFolder(row.name),
                        onClick: () => { openDir(group.dir) },
                      },
                      FOLDER_ICON,
                    ),
                )),
              ),
            )),
          ),
      )
    }

    /**
     * The produced/consulted pair, for the deployments where no directory can be
     * listed. It needs nothing from the Host — the paths were folded out of tool
     * events already in the session log — which is exactly why it is the fallback.
     * @param {object} props - inventory, workspace root, opener and copy.
     * @returns {object} both sections, or one empty notice when neither has rows.
     */
    function ResourcesSections(props) {
      const t = props.t
      const cwd = props.cwd
      const inventory = props.inventory
      const produced = React.useMemo(() => toGroups(inventory.produced, cwd), [inventory.produced, cwd])
      const consulted = React.useMemo(() => toGroups(inventory.consulted, cwd), [inventory.consulted, cwd])

      if (produced.length === 0 && consulted.length === 0) {
        return React.createElement('p', { className: CLASS.empty }, t('empty.all'))
      }
      const shared = {
        openFile: props.openFile,
        // Undefined, not a no-op: the sections read its absence as "this
        // deployment has no desktop to reveal anything on" and leave the control
        // out entirely.
        openDir: props.openDir,
        showInFolder: name => t('row.showInFolder', { name }),
        outsideTag: t('tag.outside'),
        outsideTitle: t('tag.outside.title'),
      }
      return React.createElement(
        React.Fragment,
        null,
        React.createElement(Section, {
          ...shared,
          title: t('section.produced'),
          groups: produced,
          empty: t('empty.produced'),
          count: t('section.count', { count: countRows(produced) }),
        }),
        React.createElement(Section, {
          ...shared,
          title: t('section.consulted'),
          groups: consulted,
          empty: t('empty.consulted'),
          count: t('section.count', { count: countRows(consulted) }),
        }),
      )
    }

    /**
     * Build the frame-overlay panel: a region to the right of the conversation
     * body, starting under the session header, that asks the body for the width
     * it occupies so nothing is covered and the header is not disturbed.
     * @param {object} deps - `openState`, `sessions`, `workspaces`, `connection`
     *   and the bound translate.
     * @returns {Function} the component registered into `shell.overlay`.
     */
    function createPanel(deps) {
      return function ResourcesPanel(props) {
        // The framework injects `t` for a registration declaring `locale`, and
        // that injected one is what re-renders on a locale switch. The bound
        // fallback only guards against a host that injects nothing, where stale
        // copy beats a crash.
        const t = props?.t ?? deps.t
        const open = useObservable(deps.openState)
        const current = useCurrentInventory(deps.sessions)
        const size = useResizableWidth()
        const shown = open && current.ready
        const top = useContentTop(shown)
        const tree = useWorkspaceTree(deps, current.sessionId, current.cwd, shown)
        const [filter, setFilter] = React.useState('')
        // Collapsed reserves nothing, because the control that reopens it is in
        // the session header and does not depend on this surface being on screen.
        useConversationReserve(shown ? size.width + GAP : 0)
        const cwd = current.cwd
        const openFile = React.useCallback(
          (path) => {
            // An open that fails stays silent: the native app raises its own
            // dialog when a path is unusable, and a row in a ledger is not the
            // place to report it.
            void deps.workspaces.openPath(resolveWorkspacePath(cwd, path)).catch(() => { })
          },
          [cwd],
        )
        // Whether this deployment can reach a desktop at all, on the app's own
        // two conditions: the Host says it has one, and this page is the local
        // one. A browser on another machine asking the Host to open a window
        // would be opening it on somebody else's screen.
        const description = useObservable(deps.connection.hostDescription)
        const canReveal = deps.connection.isLoopback && description?.canOpenPath === true
        const openDir = React.useMemo(
          () => (canReveal
            // '.' is how the app spells the workspace root for this same act,
            // and a group with no directory of its own IS the root.
            ? dir => { openFile(dir === '' ? '.' : dir) }
            : undefined),
          [canReveal, openFile],
        )

        /**
         * What this session did to each file, keyed by the path the tree shows.
         *
         * This is the one thing the tree cannot read off disk, and the reason the
         * ledger machinery stays: a directory listing says a file exists, while
         * this says the session wrote it. Paths are compared case-folded because
         * the inventory's spelling comes from whatever a tool reported and the
         * listing's from the filesystem, and on Windows those differ freely.
         */
        const marksByPath = React.useMemo(() => {
          const map = new Map()
          const add = (entries, role) => {
            for (const entry of entries) {
              const key = resolveWorkspacePath(cwd, entry.path).replaceAll('\\', '/').toLowerCase()
              map.set(key, { role, tools: entry.toolNames.join(' · ') })
            }
          }
          // Consulted first so produced overwrites it: a file this session wrote
          // is a deliverable whether or not it was also read on the way there,
          // which is the same rule the two lists follow.
          add(current.inventory.consulted, 'consulted')
          add(current.inventory.produced, 'produced')
          return map
        }, [current.inventory, cwd])
        const markFor = React.useCallback(
          path => marksByPath.get(path.replaceAll('\\', '/').toLowerCase()),
          [marksByPath],
        )

        /** The produced files, as rows for the section pinned above the tree. */
        const outputs = React.useMemo(
          () => current.inventory.produced.map(entry => ({
            path: resolveWorkspacePath(cwd, entry.path),
            name: splitPath(entry.path).name,
          })),
          [current.inventory.produced, cwd],
        )
        // Rendering nothing while closed keeps the overlay layer empty, so a
        // closed panel costs no layout and cannot intercept a click.
        if (!shown) return null
        return React.createElement(
          'aside',
          {
            className: CLASS.panel,
            'aria-label': t('list.aria'),
            'data-dragging': size.dragging ? 'true' : undefined,
            style: { top: top ?? 0, width: size.width },
          },
          React.createElement('button', {
            type: 'button',
            className: CLASS.handle,
            'data-dragging': size.dragging ? 'true' : undefined,
            'aria-label': t('panel.resize'),
            title: t('panel.resize'),
            onPointerDown: size.onPointerDown,
            onKeyDown: size.onKeyDown,
          }),
          // No rule under the heading and no close button beside it: the app's
          // details column needs a close affordance because clicking a tool row
          // is its only way in, whereas this surface has a button in the session
          // header that is both the way in and the way out.
          React.createElement(
            'div',
            { className: CLASS.panelHead },
            React.createElement('h2', { className: CLASS.panelTitle }, t('panel.title')),
            React.createElement(
              'div',
              { className: CLASS.headActions },
              tree.state !== 'ready' ? null : React.createElement(
                'button',
                {
                  type: 'button',
                  className: CLASS.iconButton,
                  'aria-label': t('tree.reload'),
                  title: t('tree.reload'),
                  onClick: tree.reload,
                },
                RELOAD_ICON,
              ),
              openDir === undefined ? null : React.createElement(
                'button',
                {
                  type: 'button',
                  className: CLASS.iconButton,
                  'aria-label': t('tree.openRoot'),
                  title: t('tree.openRoot'),
                  onClick: () => { openDir('') },
                },
                FOLDER_ICON,
              ),
            ),
          ),
          // The filter belongs to the tree; with no tree there is nothing on this
          // side to filter, so it does not appear over the fallback list.
          tree.state !== 'ready' ? null : React.createElement(
            'div',
            { className: CLASS.filterRow },
            React.createElement('input', {
              type: 'search',
              className: CLASS.filterInput,
              value: filter,
              placeholder: t('tree.filter'),
              'aria-label': t('tree.filter'),
              onChange: (event) => { setFilter(event.target.value) },
            }),
          ),
          tree.state === 'ready'
            ? React.createElement(
              'div',
              { className: CLASS.body, role: 'region', 'aria-label': t('tree.aria') },
              // Hidden while filtering: the filter is a way to find one file in
              // the tree, and a pinned list above the results would be answering
              // a question the reader has stopped asking.
              filter.trim() === '' ? React.createElement(OutputList, {
                t,
                rows: outputs,
                onOpenFile: openFile,
                onRevealDir: openDir,
                showInFolder: name => t('row.showInFolder', { name }),
              }) : null,
              React.createElement(WorkspaceTree, {
                t,
                tree,
                filter,
                markFor,
                onToggle: tree.toggle,
                onOpenFile: openFile,
                onRevealDir: openDir,
                showInFolder: name => t('row.showInFolder', { name }),
              }),
            )
            : React.createElement(
              'div',
              { className: CLASS.body, role: 'region', 'aria-label': t('list.aria') },
              tree.state === 'loading'
                ? React.createElement('p', { className: CLASS.empty }, t('tree.loading'))
                : React.createElement(
                  React.Fragment,
                  null,
                  // Not silence, and not an error dialog either. The tree needs a
                  // directory read this deployment may not serve; when it cannot,
                  // the panel says which list this is and shows the one that
                  // needs nothing from the Host.
                  React.createElement('p', { className: CLASS.note }, t('tree.unavailable')),
                  React.createElement(ResourcesSections, {
                    t,
                    cwd,
                    openFile,
                    openDir,
                    inventory: current.inventory,
                  }),
                ),
            ),
        )
      }
    }

    /**
     * Build the session-header button that opens and closes the panel.
     *
     * It sits in the utility row beside the app's own `Session log`, which is
     * where this app already keeps the controls that reveal something about the
     * current session. A panel-mounted button could only be reached while the
     * panel was open, so the way in has to live outside it.
     * @param {object} deps - `openState` and the bound translate.
     * @returns {Function} the component registered into the header utility row.
     */
    function createToggle(deps) {
      return function ResourcesToggle(props) {
        const t = props?.t ?? deps.t
        const open = useObservable(deps.openState)
        return React.createElement(
          'button',
          {
            type: 'button',
            className: CLASS.toggle,
            'data-open': open ? 'true' : 'false',
            // The host's own panel controls name the ACT, not the control: its
            // sidebar button reads "收起侧边栏" while expanded, and carries
            // `aria-label` alone — no `aria-pressed`, no `title`. Following that
            // keeps one convention in the header instead of two.
            'aria-label': open ? t('panel.close') : t('panel.open'),
            onClick: () => { deps.openState.toggle() },
          },
          PANEL_ICON,
        )
      }
    }

    // ------------------------------------------------------------ plugin

    exports.name = NS
    /**
     * Required services: the slot registry, locale, both conversation
     * registries, and the two the opener needs — `sessions` for the current
     * selection and its workspace root, `workspaces` for the Host open route.
     */
    exports.inject = [
      'slots', 'locale', 'conversationEvents', 'conversationViews', 'sessions', 'workspaces',
      // For the two facts that decide whether revealing a folder is offered at
      // all: whether the Host has a desktop, and whether this page is the local one.
      'connection',
    ]

    /**
     * Register the dictionaries, the stylesheet, the per-call Definition, the
     * view target, the header button and the panel. Each registration rides its
     * service's effect wrapper, so unloading the plugin removes all of them.
     * @param {object} ctx - client root context.
     */
    exports.apply = function (ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-resources: dictionaries')
      ctx.effect(() => installStyles(), 'session-resources: stylesheet')
      const t = ctx.locale.bind(NS)
      const openState = createOpenState()

      ctx.conversationEvents.register(resourceCallDefinition)
      ctx.conversationViews.register(resourcesViewDefinition)

      // Both registrations go through `inject` so each waits on the declaration
      // its owning package makes, leaves with this plugin's fiber, and
      // reinstalls after a declaration collapse and redeclaration.
      ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({
        name: 'conversation.session.header.utilities',
        id: NS,
        order: 20,
        locale: NS,
      }, createToggle({ openState, t })))

      // `shell.overlay` rather than `details`: that column is a single-seat
      // slot, so taking it would replace the app's own tool-detail panel instead
      // of sitting beside it. The overlay seat is additive, and the conversation
      // still makes room because the stylesheet asks it to.
      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: NS,
        order: 20,
        locale: NS,
      }, createPanel({
        openState,
        t,
        sessions: ctx.sessions,
        workspaces: ctx.workspaces,
        connection: ctx.connection,
      })))
    }

    // The loader takes the factory's RETURN value as the plugin exports
    // (`module.exports = ...` alone yields undefined and fails the mount).
    return exports
  },
})
