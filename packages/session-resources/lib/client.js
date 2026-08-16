/**
 * dsh-plugin-session-resources — browser half.
 *
 * A Resources tab beside Conversation and Trajectory listing two things about
 * one session: the files it PRODUCED and the files it CONSULTED. Both are
 * folded from render intent the tool events already carry, so nothing here
 * scans a disk, sends a request, or asks the model for anything.
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
    /** After Trajectory (10): the inventory summarizes a session, so it reads last. */
    const VIEW_ORDER = 20

    // ---------------------------------------------------------------- copy

    const zh = {
      'view.resources': '资源',
      'section.produced': '产出',
      'section.consulted': '来源',
      'section.count': '{count} 个文件',
      'empty.all': '本会话还没有产生文件资源',
      'empty.produced': '暂无产出文件',
      'empty.consulted': '暂无来源文件',
      'list.aria': '会话文件资源',
      'tag.outside': '工作区外',
      'tag.outside.title': '这个目录不在本会话的工作区内。它出现在这里，是因为本会话确实动过它 —— 当时的权限模式允许如此。',
    }

    const en = {
      'view.resources': 'Resources',
      'section.produced': 'Produced',
      'section.consulted': 'Sources',
      'section.count': '{count} files',
      'empty.all': 'This session has produced no file resources yet',
      'empty.produced': 'No produced files',
      'empty.consulted': 'No source files',
      'list.aria': 'Session file resources',
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
     * tool nobody has written yet join this inventory by declaring what it
     * does.
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

    // ---------------------------------------------------------------- view

    const CLASS = {
      root: 'dsh-sres-root',
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
      row: 'dsh-sres-row',
      name: 'dsh-sres-name',
      tools: 'dsh-sres-tools',
      empty: 'dsh-sres-empty',
    }

    /**
     * Colours come from the app's own theme tokens, so light and dark follow
     * the host with no theme awareness here. `:hover` and `:focus-visible` are
     * why this is a stylesheet rather than inline styles.
     */
    const STYLES = `
.${CLASS.root} { display: flex; flex-direction: column; gap: 24px; height: 100%; overflow-y: auto; padding: 16px 20px 24px; box-sizing: border-box; color: var(--dsw-alias-label-primary); font-size: 13px; }
.${CLASS.section} { display: flex; flex-direction: column; gap: 8px; }
.${CLASS.head} { display: flex; align-items: baseline; gap: 8px; }
.${CLASS.title} { margin: 0; font-size: 13px; font-weight: 600; }
.${CLASS.count} { color: var(--dsw-alias-label-secondary); font-size: 12px; }
.${CLASS.groups} { display: flex; flex-direction: column; gap: 10px; }
.${CLASS.group} { display: flex; flex-direction: column; gap: 2px; }
.${CLASS.dirRow} { display: flex; align-items: baseline; gap: 6px; padding: 0 8px; min-width: 0; }
.${CLASS.dir} { flex: 0 1 auto; color: var(--dsw-alias-label-secondary); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; direction: rtl; text-align: left; }
.${CLASS.outside} { flex: 0 0 auto; font-size: 11px; line-height: 1.5; padding: 0 6px; border-radius: 999px; border: 1px solid var(--dsw-alias-border-l2); color: var(--dsw-alias-label-secondary); cursor: help; }
.${CLASS.list} { display: flex; flex-direction: column; gap: 2px; margin: 0; padding: 0; list-style: none; }
.${CLASS.row} { display: flex; align-items: baseline; gap: 8px; width: 100%; padding: 6px 8px; border-radius: 8px; border: 1px solid transparent; background: transparent; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.${CLASS.row}:hover { background: var(--dsw-alias-interactive-bg-hover); border-color: var(--dsw-alias-border-l2); }
.${CLASS.row}:focus-visible { outline: 2px solid var(--dsw-alias-border-focus); outline-offset: -1px; }
.${CLASS.name} { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 500; }
.${CLASS.tools} { flex: 0 0 auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.${CLASS.empty} { margin: 0; color: var(--dsw-alias-label-secondary); }
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

    /**
     * Module-scope so the selector identity stays stable across renders. The
     * fallback is the builder's shared empty snapshot.
     */
    const selectResources = snapshot => snapshot.views.get(TARGET) ?? EMPTY_SNAPSHOT

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

    function Section(props) {
      const groups = props.groups
      const openFile = props.openFile
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
                  { key: row.path },
                  React.createElement(
                    'button',
                    {
                      type: 'button',
                      className: CLASS.row,
                      title: row.path,
                      onClick: () => { openFile(row.path) },
                    },
                    React.createElement('span', { className: CLASS.name }, row.name),
                    React.createElement('span', { className: CLASS.tools }, row.tools),
                  ),
                )),
              ),
            )),
          ),
      )
    }

    /**
     * The Resources tab.
     * @param {object} props - the view runtime share (`useSession`), the locale
     *   seat (`t`), and this plugin's injected face (`openFile`, `cwd`).
     * @returns {object} the two sections, or one empty notice when neither has rows.
     */
    function SessionResourcesView(props) {
      const t = props.t
      const cwd = props.cwd
      const openFile = props.openFile
      const snapshot = props.useSession(selectResources)
      const produced = React.useMemo(() => toGroups(snapshot.produced, cwd), [snapshot.produced, cwd])
      const consulted = React.useMemo(() => toGroups(snapshot.consulted, cwd), [snapshot.consulted, cwd])

      if (produced.length === 0 && consulted.length === 0) {
        return React.createElement(
          'div',
          { className: CLASS.root },
          React.createElement('p', { className: CLASS.empty }, t('empty.all')),
        )
      }
      return React.createElement(
        'div',
        { className: CLASS.root, role: 'region', 'aria-label': t('list.aria') },
        React.createElement(Section, {
          title: t('section.produced'),
          groups: produced,
          openFile,
          outsideTag: t('tag.outside'),
          outsideTitle: t('tag.outside.title'),
          empty: t('empty.produced'),
          count: t('section.count', { count: countRows(produced) }),
        }),
        React.createElement(Section, {
          title: t('section.consulted'),
          groups: consulted,
          openFile,
          outsideTag: t('tag.outside'),
          outsideTitle: t('tag.outside.title'),
          empty: t('empty.consulted'),
          count: t('section.count', { count: countRows(consulted) }),
        }),
      )
    }

    // ------------------------------------------------------------ plugin

    /**
     * Resolve a workspace-relative path into the Host-facing spelling
     * `openPath` expects. Reimplemented rather than imported: the module loader
     * hands this file a `require` for host modules, and depending on a
     * non-public helper's path would tie the plugin to a version's internals
     * for eleven lines of string work.
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

    exports.name = NS
    /**
     * Required services: the slot, both conversation registries, locale, and
     * the two the opener needs — `sessions` for the workspace root a relative
     * path resolves against, `workspaces` for the Host open route.
     */
    exports.inject = ['slots', 'locale', 'conversationEvents', 'conversationViews', 'sessions', 'workspaces']

    /**
     * Register the dictionaries, the stylesheet, the per-call Definition, the
     * view target and the tab. Each registration rides its service's effect
     * wrapper, so unloading the plugin removes all of them.
     * @param {object} ctx - client root context.
     */
    exports.apply = function (ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'session-resources: dictionaries')
      ctx.effect(() => installStyles(), 'session-resources: stylesheet')
      // Registration-time text (the tab label) reads through the bound
      // translate as a thunk, so it follows the active locale without
      // re-registration.
      const t = ctx.locale.bind(NS)
      ctx.conversationEvents.register(resourceCallDefinition)
      ctx.conversationViews.register(resourcesViewDefinition)
      // Through `inject` so the registration waits on the declaration the
      // conversation package owns, leaves with this plugin's fiber, and
      // reinstalls after a declaration collapse and redeclaration.
      ctx.slots.inject('conversation.view', () => ctx.slots.register({
        name: 'conversation.view',
        id: NS,
        order: VIEW_ORDER,
        locale: NS,
        label: () => t('view.resources'),
        /**
         * The view-slot owner share carries only the cross-view inspect
         * handoff — no opener — so this face supplies one, derived exactly the
         * way the chat view derives its own: resolve against the session's
         * workspace root, then hand the path to the Host. An open that fails
         * stays silent here; the native app raises its own dialog when a path
         * is unusable, and a row is not the place to report it.
         * @param {string} sessionId - the session this view instance renders.
         * @returns {object} the injected face this plugin's component reads.
         */
        inject: (sessionId) => {
          const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd
          return {
            cwd,
            openFile: (path) => {
              void ctx.workspaces.openPath(resolveWorkspacePath(cwd, path)).catch(() => { })
            },
          }
        },
      }, SessionResourcesView))
    }

    // The loader takes the factory's RETURN value as the plugin exports
    // (`module.exports = ...` alone yields undefined and fails the mount).
    return exports
  },
})
