/**
 * dsh-plugin-session-resources — host half.
 *
 * Deliberately empty. The whole feature is browser chrome: it folds render
 * intent that tool events already carry into two file lists and shows them in
 * a conversation tab. Nothing here reaches a model request, touches the
 * filesystem, or opens a port.
 *
 * This entry exists because a profile composes packages through loader rows,
 * and a row needs a module to mount. The row is what carries the package into
 * the composition, which is what makes the web app read its `dsh.client`
 * declaration and load `lib/client.js`. Removing the row removes the tab.
 */

/** Provides no host-side behavior; see the module comment. */
export function apply() {}

/** Loader entry id, matching the row this package's bundle patch inserts. */
export const name = 'session-resources'
