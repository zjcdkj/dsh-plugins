/**
 * dsh-plugin-session-resources — host half.
 *
 * This used to be empty, because the panel folded render intent that tool events
 * already carry and needed nothing from the Host. A workspace directory listing
 * is different: only the Host can read a directory, and the app's own
 * `host.listDirectory` cannot help. That route backs the directory picker and
 * drops every non-directory entry on purpose — "Only rows a browser could enter
 * contend for the window" (`packages/host/directory-picker-browse`). No other
 * route in the RPC map returns file names.
 *
 * So this half answers on a channel of its own. `connection.rpc.handle` is the
 * supported way to add one: it puts the channel behind the same request fence the
 * `/api` route uses and ties the registration to this plugin's fiber. The one
 * reserved alternative, `intercept('/api', ...)`, is a single global seat already
 * held by the API gateway.
 *
 * The listing is fenced two ways. `authority: 'loopback'` means only a page on
 * this machine can call at all. Inside that, every path is resolved against the
 * asking session's own workspace root and checked with `fs.contains`, so a
 * caller cannot walk out of the workspace by sending `..` or an absolute path
 * somewhere else. The session's root is read from the session store here rather
 * than accepted from the caller — a root supplied by the caller would make the
 * fence decorative.
 */

/**
 * The channel this plugin answers on.
 *
 * One segment, matching the pattern both halves enforce
 * (`/^\/[A-Za-z0-9._~-]+$/`); a nested path is rejected at registration. It
 * carries the package name because a duplicate prefix route fails the boot
 * rather than shadowing, so a collision would be somebody else's outage.
 */
export const CHANNEL = '/dsh-session-resources'

/**
 * Most entries returned for one directory.
 *
 * A workspace can contain a `node_modules` with tens of thousands of children,
 * and a panel cannot show them anyway. The cap is per directory rather than per
 * tree because the browser asks one level at a time; `truncated` tells the panel
 * to say so instead of quietly presenting a partial listing as complete.
 */
const MAX_ENTRIES = 500

/** Loader entry id, matching the row this package's bundle patch inserts. */
export const name = 'session-resources'

/**
 * `connection` is required because the channel has nowhere to live without it,
 * and `sessions` because the workspace root that fences every listing is read
 * from there. A profile that composes no web app never applies this half, which
 * is correct: there is no browser to answer.
 *
 * `fs` is deliberately NOT here. It is an optional capability, so it is read at
 * call time and its absence is reported as an error the panel can show, rather
 * than as a boot that waits forever for something this deployment never loads.
 */
export const inject = ['connection', 'sessions']

/** The app's error vocabulary is a closed set; these are the two shapes used. */
const badRequest = message => ({ ok: false, error: { code: 'bad-request', message, details: { issues: [] } } })
const unreadable = (message, path) => ({ ok: false, error: { code: 'directory-unreadable', message, details: { path } } })

/**
 * Register the listing channel.
 * @param {object} ctx - host plugin context, with `connection` in place.
 */
export function apply(ctx) {
    /**
     * One directory level inside one session's workspace.
     * @param {object} payload - `{ sessionId, cwd, path }`; an absent path means
     *   the root, and `cwd` is only consulted for a session that is not attached.
     * @param {AbortSignal} signal - carries the caller's departure into the backend.
     * @returns {Promise<object>} an RpcResult with the level, or a closed-set error.
     */
    async function list(payload, signal) {
        const sessionId = payload?.sessionId
        if (typeof sessionId !== 'string' || sessionId === '') {
            return badRequest('session-resources: list needs a sessionId')
        }
        const asked = payload?.path
        if (asked !== undefined && typeof asked !== 'string') {
            return badRequest('session-resources: path must be a string when present')
        }

        /*
         * Where the tree is rooted, preferring the Host's own record over the
         * caller's.
         *
         * `sessions.get` answers for ATTACHED sessions only — "undefined when no
         * live session has that id" — and this panel is most useful on a session
         * just reopened from history, which is cold. So a cold session's root
         * comes from the caller, which received it from this same Host through
         * `session.list`. That is a smaller concession than it looks: the channel
         * is loopback-only, and the page calling it is the app, which already
         * displays these paths and can already ask the Host to open any of them.
         * The containment check below is the part that carries the weight — it is
         * what stops a relative `..` from walking out of whichever root is used.
         */
        const live = ctx.sessions.get(sessionId)?.header?.cwd
        const claimed = payload?.cwd
        const root = typeof live === 'string' && live !== '' ? live : claimed
        if (typeof root !== 'string' || root === '') {
            return badRequest(`session-resources: session ${JSON.stringify(sessionId)} has no workspace root`)
        }

        const fs = ctx.get('fs')
        if (fs === undefined) {
            return unreadable('session-resources: this deployment composes no filesystem service', root)
        }

        try {
            const rootTarget = await fs.resolve(root, { signal })
            const target = asked === undefined || asked === ''
                ? rootTarget
                : await fs.resolve(asked, { cwd: root, signal })
            if (!fs.contains(rootTarget, target)) {
                return badRequest('session-resources: path is outside the session workspace')
            }
            const children = await fs.listDir(target, signal)
            // Directories first, then the backend's own stable name order within each
            // group — a reader looking for a folder should not have to scan past files.
            const ordered = [
                ...children.filter(child => child.type === 'directory'),
                ...children.filter(child => child.type !== 'directory'),
            ]
            const entries = ordered.slice(0, MAX_ENTRIES).map(child => ({
                name: child.name,
                type: child.type,
                path: fs.processPath(child.target),
                ...child.size === undefined ? {} : { size: child.size },
            }))
            return {
                ok: true,
                value: {
                    root: fs.processPath(rootTarget),
                    path: fs.processPath(target),
                    entries,
                    truncated: ordered.length > entries.length,
                },
            }
        } catch (error) {
            const code = error?.code
            if (code === 'FS_ABORTED') {
                return { ok: false, error: { code: 'cancelled', message: 'session-resources: listing abandoned', details: {} } }
            }
            // Every other filesystem failure is one thing to the reader: this level
            // could not be read. The backend's own code rides along in the message so
            // a permission denial is still distinguishable from a missing directory.
            return unreadable(
                `session-resources: ${typeof code === 'string' ? code : 'listing failed'}`,
                typeof asked === 'string' && asked !== '' ? asked : root,
            )
        }
    }

    ctx.connection.rpc.handle(CHANNEL, async (endpoint, payload, signal) => {
        if (endpoint === 'list') return await list(payload, signal)
        // Kept from the reachability probe: the browser half calls it once to decide
        // whether a tree is available at all, which matters because the desktop
        // shell forwards fetches through its own bridge rather than the web server.
        if (endpoint === 'probe') {
            return { ok: true, value: { channel: CHANNEL, services: { fs: ctx.get('fs') !== undefined } } }
        }
        // The code has to come from the app's closed set, and `details` is required
        // per code. An invented code would fail the browser's response parse and
        // surface as a transport error instead of this message.
        return badRequest(`session-resources: unknown endpoint ${JSON.stringify(endpoint)}`)
    }, { authority: 'loopback' })
}
