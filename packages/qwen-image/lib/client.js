/**
 * dsh-plugin-qwen-image — browser half.
 *
 * Makes pasting an image WORK on a deployment whose conversation model is
 * text-only, which is the deployment this whole package exists for.
 *
 * What normally happens: the composer accepts the pasted image into its own
 * image rail, the user sends, and the HOST refuses the entire request —
 * "Model … does not support image input" — because the request now carries an
 * image part the session's route cannot take. The image was never the problem;
 * putting it in the conversation was.
 *
 * So this half takes the paste before the app sees it. A capture-phase listener
 * claims the event, stops it from reaching the composer at all, and hands the
 * bytes to this package's host half, which saves them in the session workspace
 * and tells the model an image is waiting. The conversation itself stays pure
 * text, so the request goes through, and `qwen_image` does the looking.
 *
 * Two things it deliberately does NOT do. It does not write to the composer —
 * no injected `[image] path` line, no draft the user did not type; the input
 * stays exactly what they wrote. And it does not claim a paste it cannot
 * complete: the channel is probed first, and until that probe succeeds the
 * app's own paste handling is left completely alone.
 *
 * Loaded by the DSH web app through this package's `dsh.client` declaration
 * (see package.json). Hand-written plain JS on purpose: the module loader hands
 * the factory a `require` for host-provided modules, so there is nothing to
 * bundle and installing never asks for build permission.
 */
window.__ModuleLoader__.load({
  id: 'dsh-plugin-qwen-image',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')

    /** Dictionary namespace, slot entry id and plugin name; prefixed so no bare word is taken. */
    const NS = 'qwen-image'

    /**
     * The channel this package's host half answers on.
     *
     * Repeated rather than imported: these are two modules on two sides of a
     * wire, and the browser loads this file alone with no way to read the host
     * entry. It must match the `CHANNEL` that half exports.
     */
    const CHANNEL = '/dsh-qwen-image'

    // ---------------------------------------------------------------- copy

    const zh = {
      'dock.label': '待读图片',
      'dock.hint': '已保存，发送后模型会用 qwen_image 读取',
      'dock.busy': '正在保存…',
      'dock.remove': '移除 {name}',
      'dock.error': '无法保存粘贴的图片：{reason}',
      'dock.reason.tooLarge': '超出本部署的图片大小上限',
      'dock.reason.rejected': '本部署不接受这种图片格式',
      'dock.reason.unwritable': '工作区无法写入',
      'dock.reason.unknown': '{code}',
    }

    const en = {
      'dock.label': 'Waiting to be read',
      'dock.hint': 'Saved; on send the model reads it with qwen_image',
      'dock.busy': 'Saving…',
      'dock.remove': 'Remove {name}',
      'dock.error': 'Could not save the pasted image: {reason}',
      'dock.reason.tooLarge': 'over this deployment\'s image size limit',
      'dock.reason.rejected': 'this deployment does not accept that image format',
      'dock.reason.unwritable': 'the workspace could not be written to',
      'dock.reason.unknown': '{code}',
    }

    // ------------------------------------------------------------- clipboard

    /**
     * Image types this plugin handles, matching the host half's own table.
     *
     * A type outside this set is left to the app: the host would refuse it
     * anyway, and refusing it here after having already cancelled the paste
     * would lose the image entirely.
     */
    const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']

    /**
     * The accepted image files carried by a paste or drop.
     *
     * `getAsFile()` must run inside the event dispatch — a DataTransfer is
     * neutered the moment the handler returns — so this is called synchronously
     * and only the resulting File objects are used afterwards.
     * @param {DataTransfer | null} transfer - the event's data transfer.
     * @returns {File[]} the accepted image files, in clipboard order.
     */
    function imageFilesOf(transfer) {
      if (transfer === null || transfer === undefined) return []
      const files = []
      for (const item of Array.from(transfer.items ?? [])) {
        if (item.kind !== 'file') continue
        const file = item.getAsFile()
        if (file !== null && ACCEPTED_TYPES.includes(file.type)) files.push(file)
      }
      return files
    }

    /**
         * The plain text a paste or drop also carries, if any.
         *
         * A mixed payload — an image AND text, which copying from a document
         * produces — must not lose its text half. See {@link handOverText} for what
         * happens to it.
         * @param {DataTransfer | null} transfer - the event's data transfer.
         * @returns {string} the text, or `''`.
         */
    function textOf(transfer) {
      if (transfer === null || transfer === undefined) return ''
      return transfer.getData('text/plain') ?? ''
    }

    /**
     * Give the app back the text half of a claimed paste.
     *
     * Claiming a paste cancels it whole, so a mixed payload would lose its text
     * unless it is handed over deliberately. This re-dispatches the SAME text as
     * a text-only paste, which the app then handles through its normal path.
     *
     * This is not the plugin writing to the composer. The characters are the
     * user's own clipboard contents going where the user aimed them; nothing is
     * composed, formatted, or added. (Injecting a path into the draft is exactly
     * what this plugin refuses to do.)
     *
     * It cannot loop: the replacement transfer carries no files, so the capture
     * listener sees nothing to claim and stands aside.
     * @param {EventTarget | null} target - the element the original paste hit.
     * @param {string} text - the text to hand over; `''` does nothing.
     */
    function handOverText(target, text) {
      if (text === '' || !(target instanceof Element)) return
      const clean = new DataTransfer()
      clean.setData('text/plain', text)
      target.dispatchEvent(new ClipboardEvent('paste', {
        clipboardData: clean, bubbles: true, cancelable: true, composed: true,
      }))
    }

    /**
     * The composer's scroll region, which the app marks for its own purposes.
     *
     * A data attribute rather than a class: the class beside it is a build hash
     * that changes with every release. Used to keep this listener from claiming
     * a paste into some other field — a rename box, a search input — where the
     * user meant that field's own behaviour.
     */
    const COMPOSER = '[data-input-scroll]'

    /**
     * @param {EventTarget | null} target - the event target.
     * @returns {boolean} whether it sits inside the composer.
     */
    function inComposer(target) {
      return target instanceof Element && target.closest(COMPOSER) !== null
    }

    /**
     * Base64 for one file, through the platform's own decoder.
     *
     * FileReader rather than a hand-rolled loop over an ArrayBuffer: chunking
     * `String.fromCharCode(...bytes)` to stay under the argument limit is the
     * kind of code that works until someone pastes a larger screenshot.
     * @param {File} file - the image to encode.
     * @returns {Promise<string>} the base64 payload, without the data-URL prefix.
     */
    function toBase64(file) {
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const result = String(reader.result ?? '')
          const comma = result.indexOf(',')
          if (comma < 0) {
            reject(new Error('unreadable'))
            return
          }
          resolve(result.slice(comma + 1))
        }
        reader.onerror = () => { reject(reader.error ?? new Error('unreadable')) }
        reader.readAsDataURL(file)
      })
    }

    /** Human byte size, matching what the host half reports. */
    function formatBytes(bytes) {
      if (typeof bytes !== 'number' || !Number.isFinite(bytes)) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
    }

    // ----------------------------------------------------------------- state

    /** Stable empty list, so a session with no pastes does not churn renders. */
    const EMPTY = []

    /**
     * The waiting images, per session, as this page knows them.
     *
     * Per session and not one flat list, because the panel is read while a
     * session is selected and pasting into one conversation must not put a chip
     * on another. The host half is the source of truth — it owns what the model
     * is told — and this mirrors it: a paste appends optimistically so the chip
     * appears at once, and {@link replace} reconciles against the host's answer.
     * @returns {object} an ObservableSnapshot with mutators.
     */
    function createPasteState() {
      let value = { bySession: new Map(), busy: 0, error: '' }
      const listeners = new Set()
      const emit = () => { for (const fn of [...listeners]) fn() }

      /** Object URLs belong to this page; dropping an entry must release its own. */
      function release(entries, keep) {
        for (const entry of entries) {
          if (entry.preview === undefined) continue
          if (keep !== undefined && keep.some(other => other.path === entry.path)) continue
          URL.revokeObjectURL(entry.preview)
        }
      }

      function write(sessionId, entries) {
        const bySession = new Map(value.bySession)
        if (entries.length === 0) bySession.delete(sessionId)
        else bySession.set(sessionId, entries)
        value = { ...value, bySession }
        emit()
      }

      return {
        getSnapshot: () => value,
        subscribe: (fn) => {
          listeners.add(fn)
          return () => { listeners.delete(fn) }
        },

        /** @returns {ReadonlyArray<object>} one session's waiting entries. */
        entriesOf: sessionId => (sessionId === undefined
          ? EMPTY
          : value.bySession.get(sessionId) ?? EMPTY),

        /** Append one just-stashed entry. */
        add(sessionId, entry) {
          write(sessionId, [...this.entriesOf(sessionId), entry])
        },

        /**
         * Reconcile against the host's list, keeping previews this page holds.
         *
         * The host does not know about object URLs — it reports paths, names and
         * sizes — so a reconcile that took its answer verbatim would blank every
         * thumbnail. Matching by path keeps the preview for entries that survive
         * and releases it for those that do not.
         */
        replace(sessionId, entries) {
          const previous = this.entriesOf(sessionId)
          const merged = entries.map((entry) => {
            const held = previous.find(other => other.path === entry.path)
            return held?.preview === undefined ? entry : { ...entry, preview: held.preview }
          })
          release(previous, merged)
          write(sessionId, merged)
        },

        /** Forget one entry locally; the host is told separately. */
        remove(sessionId, path) {
          const previous = this.entriesOf(sessionId)
          const kept = previous.filter(entry => entry.path !== path)
          if (kept.length === previous.length) return
          release(previous, kept)
          write(sessionId, kept)
        },

        /** Mark one in-flight stash, so the dock can say something is happening. */
        beginWork() {
          value = { ...value, busy: value.busy + 1, error: '' }
          emit()
        },

        /** Settle one in-flight stash, recording a failure reason when it failed. */
        endWork(error) {
          value = { ...value, busy: Math.max(0, value.busy - 1), error: error ?? '' }
          emit()
        },

        /** Clear a failure the reader has had a chance to see. */
        clearError() {
          if (value.error === '') return
          value = { ...value, error: '' }
          emit()
        },
      }
    }

    /** Read an ObservableSnapshot the way React wants to be told about changes. */
    function useObservable(source) {
      return React.useSyncExternalStore(source.subscribe, source.getSnapshot)
    }

    // ------------------------------------------------------------- transport

    /**
     * One RPC round trip, with the app's result envelope unwrapped.
     * @param {object} connection - the client connection service.
     * @param {string} endpoint - the channel endpoint to call.
     * @param {object} payload - the request payload.
     * @param {AbortSignal | undefined} signal - caller cancellation.
     * @returns {Promise<object>} the value, or a rejection carrying the error code.
     */
    async function callChannel(connection, endpoint, payload, signal) {
      const answer = await connection.rpc.call(CHANNEL, endpoint, payload, signal)
      if (answer.ok !== true) {
        const error = new Error(answer.error?.message ?? answer.error?.code ?? 'failed')
        error.code = answer.error?.code
        error.detail = answer.error?.message
        throw error
      }
      return answer.value
    }

    /**
     * Turn a channel failure into copy a reader can act on.
     *
     * The closed-set code says which KIND of failure it was but not what to do
     * about it, and the two that a user can actually act on — too large, wrong
     * format — both arrive as `bad-request`. So the host's own message is
     * consulted for those, and anything unrecognized keeps the code rather than
     * inventing a diagnosis.
     * @param {Error & { code?: string, detail?: string }} error - the rejection.
     * @param {Function} t - the bound translator.
     * @returns {string} the reason phrase.
     */
    function describeFailure(error, t) {
      const detail = error.detail ?? ''
      if (/limit|larger/i.test(detail)) return t('dock.reason.tooLarge')
      if (/accept|image type/i.test(detail)) return t('dock.reason.rejected')
      if (error.code === 'directory-unreadable') return t('dock.reason.unwritable')
      return t('dock.reason.unknown', { code: error.code ?? 'error' })
    }

    // ----------------------------------------------------------- interception

    /**
     * Claim image pastes and drops for this plugin.
     *
     * Capture phase on `document`, which is what puts this ahead of the app: its
     * own handling is a React `onPaste` on the composer's textarea and a
     * document-level `drop`, both of which run later than a capture listener
     * here.
     *
     * The listener is installed only after the channel answers a probe. Until
     * then — and forever, on a deployment that composes no host half — the app's
     * native paste is untouched, because a plugin that cancels a paste it cannot
     * complete has destroyed the user's clipboard for nothing.
     * @param {object} deps - `{ connection, sessions, state, t, logger }`.
     * @returns {() => void} a disposer removing both listeners.
     */
    function installInterception(deps) {
      /**
       * Save one batch of images, newest last.
       *
       * Sequential rather than parallel: the host stamps a filename from the
       * clock plus a short salt, and a batch is small, so ordering the writes
       * keeps the stash order equal to the paste order for free.
       * @param {File[]} files - the accepted images.
       * @param {string} sessionId - the session that pasted them.
       * @param {string | undefined} cwd - its workspace root, as the app reports it.
       */
      async function stash(files, sessionId, cwd) {
        for (const file of files) {
          deps.state.beginWork()
          // The preview is created before the round trip so the thumbnail can
          // appear with the chip; it is released by the state when the entry goes.
          let preview
          try {
            preview = URL.createObjectURL(file)
            const data = await toBase64(file)
            const value = await callChannel(deps.connection, 'stash', {
              sessionId,
              ...cwd === undefined ? {} : { cwd },
              mediaType: file.type,
              name: file.name,
              data,
            }, undefined)
            deps.state.add(sessionId, {
              path: value.path,
              name: value.name,
              bytes: value.bytes,
              preview,
            })
            deps.state.endWork(undefined)
          } catch (error) {
            if (preview !== undefined) URL.revokeObjectURL(preview)
            deps.state.endWork(describeFailure(error, deps.t))
            deps.logger?.warn?.(`qwen-image: could not stash a pasted image: ${String(error)}`)
          }
        }
      }

      /**
       * Take the event over, or leave it entirely alone.
       *
       * All three of `preventDefault`, `stopPropagation` and
       * `stopImmediatePropagation` are used: the first stops the browser's own
       * insertion, and the other two stop the app's handlers from running at
       * all, which is the actual goal — the app must never intake this image,
       * because intaking it is what makes the Host refuse the request later.
       * @param {Event} event - the event being claimed.
       * @param {File[]} files - the files to stash.
       * @param {string} text - text to hand back to the app, or `''`.
       */
      function claim(event, files, text) {
        const list = deps.sessions.list.getSnapshot()
        const sessionId = list?.current
        // With no selected session there is nowhere to stash, so the app keeps
        // the paste and its own message about it.
        if (sessionId === undefined) return
        const target = event.target
        event.preventDefault()
        event.stopPropagation()
        event.stopImmediatePropagation()
        handOverText(target, text)
        void stash(files, sessionId, list.byId?.[sessionId]?.cwd)
      }

      const onPaste = (event) => {
        if (event.defaultPrevented) return
        if (!inComposer(event.target)) return
        const files = imageFilesOf(event.clipboardData)
        // A mixed paste is claimed too, and its text is handed straight back, so
        // pasting a screenshot beside a sentence behaves like pasting either one
        // alone. Leaving mixed payloads to the app would have been simpler, but
        // it fails LATE — the app accepts the image and the Host then refuses the
        // whole request, which reads as this plugin being broken.
        if (files.length > 0) claim(event, files, textOf(event.clipboardData))
      }

      /*
       * Drop is not restricted to the composer, because the app's own handling is
       * not either: it listens on `document`, so dropping anywhere in the window
       * adds the image. Matching that scope keeps the two consistent.
       *
       * Unlike paste, a drop carrying text is left entirely to the app. Dropping
       * FILES never carries text, so the mixed case here means dragged page
       * content — rare, and re-dispatching a drop would have to reproduce the
       * drag state machine the app is in the middle of, which is not worth it for
       * a payload nobody assembles on purpose.
       */
      const onDrop = (event) => {
        if (event.defaultPrevented) return
        if (textOf(event.dataTransfer) !== '') return
        const files = imageFilesOf(event.dataTransfer)
        if (files.length > 0) claim(event, files, '')
      }

      document.addEventListener('paste', onPaste, true)
      document.addEventListener('drop', onDrop, true)
      return () => {
        document.removeEventListener('paste', onPaste, true)
        document.removeEventListener('drop', onDrop, true)
      }
    }

    // -------------------------------------------------------------- styles

    const CLASS = {
      dock: 'dsh-qwi-dock',
      label: 'dsh-qwi-label',
      list: 'dsh-qwi-list',
      chip: 'dsh-qwi-chip',
      thumb: 'dsh-qwi-thumb',
      glyph: 'dsh-qwi-glyph',
      name: 'dsh-qwi-name',
      size: 'dsh-qwi-size',
      remove: 'dsh-qwi-remove',
      busy: 'dsh-qwi-busy',
      error: 'dsh-qwi-error',
    }

    const STYLE_ID = 'dsh-plugin-qwen-image-styles'

    /**
     * One stylesheet for the dock strip.
     *
     * The width is not this plugin's invention. The conversation root declares
     * `--dsh-composer-card-max-width`, `--dsh-composer-side-clearance` and
     * `--dsh-composer-dock-inset` precisely so entries in this slot can line up,
     * and its own note fixes the relation: a dock entry is the input card minus
     * four insets, while the input card alone is content + 32px. The shipped
     * todo, goal and queue entries all resolve to that same column, so this
     * follows the identical formula rather than a padding that happens to look
     * right at one viewport width.
     *
     * Every custom property is one the app itself uses, read off the running app
     * rather than guessed — including the focus colour, which is
     * `--dsw-alias-state-business-primary` (a blue) and NOT
     * `--dsw-alias-brand-primary`, which measures near-black and would read as no
     * focus ring at all.
     */
    const STYLES = `
.${CLASS.dock} { box-sizing: border-box; flex: none; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin: 0 auto; width: calc(100% - var(--dsh-composer-side-clearance) * 2 - var(--dsh-composer-dock-inset) * 4); max-width: calc(var(--dsh-composer-card-max-width) - var(--dsh-composer-dock-inset) * 4); padding: 0 0 6px; }
.${CLASS.label} { flex: 0 0 auto; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.${CLASS.list} { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0; padding: 0; list-style: none; }
.${CLASS.chip} { display: inline-flex; align-items: center; gap: 6px; max-width: 260px; height: 28px; padding: 0 4px 0 0; box-sizing: border-box; border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; background: var(--dsw-alias-bg-base); color: var(--dsw-alias-label-primary); font-size: 13px; }
.${CLASS.thumb} { flex: 0 0 auto; width: 26px; height: 26px; border-radius: 7px 0 0 7px; object-fit: cover; display: block; }
.${CLASS.glyph} { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 26px; height: 26px; color: var(--dsw-alias-label-secondary); }
.${CLASS.name} { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.${CLASS.size} { flex: 0 0 auto; color: var(--dsw-alias-label-tertiary); font-size: 12px; }
.${CLASS.remove} { flex: 0 0 auto; display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary); cursor: pointer; }
.${CLASS.remove}:hover { background: var(--dsw-alias-interactive-bg-hover); color: var(--dsw-alias-label-primary); }
.${CLASS.remove}:focus-visible { outline: 1px solid var(--dsw-alias-state-business-primary); outline-offset: -1px; }
.${CLASS.busy} { flex: 0 0 auto; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.${CLASS.error} { flex: 1 1 100%; margin: 0; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-secondary); }
`

    /**
     * Install the stylesheet once per page.
     * @returns {() => void} a disposer that removes it, or a no-op when another
     *   copy of this plugin already installed it.
     */
    function installStyles() {
      if (document.getElementById(STYLE_ID) !== null) return () => { }
      const element = document.createElement('style')
      element.id = STYLE_ID
      element.textContent = STYLES
      document.head.append(element)
      return () => { element.remove() }
    }

    /** A 14px image glyph, for an entry whose bytes this page no longer holds. */
    function imageGlyph() {
      return React.createElement(
        'svg',
        { className: CLASS.glyph, width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': true },
        React.createElement('rect', {
          x: 1.75, y: 2.75, width: 12.5, height: 10.5, rx: 2,
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.4,
        }),
        React.createElement('circle', { cx: 5.75, cy: 6.25, r: 1.1, fill: 'currentColor' }),
        React.createElement('path', {
          d: 'M2.5 12l3.4-3.4 2.3 2.3 2-2 3.3 3.3',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, strokeLinecap: 'round', strokeLinejoin: 'round',
        }),
      )
    }

    /** A 10px dismiss glyph. */
    function closeGlyph() {
      return React.createElement(
        'svg',
        { width: 10, height: 10, viewBox: '0 0 10 10', 'aria-hidden': true },
        React.createElement('path', {
          d: 'M1.5 1.5l7 7M8.5 1.5l-7 7',
          fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round',
        }),
      )
    }

    // ---------------------------------------------------------------- dock

    /** How often the host's list is re-read while anything is waiting, in ms. */
    const POLL_MS = 2500

    /**
     * The strip above the composer listing what is waiting to be read.
     *
     * It renders nothing at all when nothing waits, which is the normal state —
     * this plugin adds no permanent furniture to the input region. What it shows
     * is not a draft and not an attachment rail: the composer's own value is
     * untouched, and these chips describe files that already live in the
     * workspace.
     * @param {object} deps - `{ state, sessions, connection, t, logger }`.
     * @returns {Function} the dock component.
     */
    function createDock(deps) {
      return function QwenImagePasteDock(props) {
        // Slot props carry the bound translator; the closure's is the fallback
        // for a host that renders this without the locale seat.
        const t = props?.t ?? deps.t
        const snapshot = useObservable(deps.state)
        const list = useObservable(deps.sessions.list)
        const sessionId = list?.current
        const cwd = sessionId === undefined ? undefined : list.byId?.[sessionId]?.cwd
        const entries = deps.state.entriesOf(sessionId)

        /*
         * Re-read the host's list: once when the session changes, then while
         * anything is waiting.
         *
         * Polling, narrowly. The host forgets an entry when `qwen_image` reads
         * it, and this page has no way to be told — the channel is
         * request/response, and the alternative was folding tool events to guess
         * at it. So the loop runs ONLY while this session has waiting entries and
         * stops as soon as the list empties, which is also what makes a chip
         * disappear shortly after the model has looked.
         */
        const waiting = entries.length > 0
        React.useEffect(() => {
          if (sessionId === undefined) return undefined
          let live = true
          const controller = new AbortController()
          const read = async () => {
            try {
              const value = await callChannel(
                deps.connection, 'list', { sessionId, ...cwd === undefined ? {} : { cwd } }, controller.signal,
              )
              if (!live) return
              deps.state.replace(sessionId, Array.isArray(value?.entries) ? value.entries : [])
            } catch {
              // A failed reconcile leaves the optimistic list standing. It is the
              // better error: the chips describe files that really were saved, and
              // dropping them here would tell the user their paste was lost.
            }
          }
          void read()
          const timer = waiting ? setInterval(() => { void read() }, POLL_MS) : undefined
          return () => {
            live = false
            controller.abort()
            if (timer !== undefined) clearInterval(timer)
          }
        }, [sessionId, cwd, waiting])

        const dismiss = React.useCallback((path) => {
          if (sessionId === undefined) return
          deps.state.remove(sessionId, path)
          void callChannel(deps.connection, 'drop', { sessionId, path }, undefined)
            .catch(() => {
              // The chip is already gone locally and the host's own copy expires
              // on its own bound; a failed dismissal is not worth a message.
            })
        }, [sessionId])

        if (entries.length === 0 && snapshot.busy === 0 && snapshot.error === '') return null

        const rows = entries.map(entry => React.createElement(
          'li',
          { key: entry.path, className: CLASS.chip, title: `${entry.name} · ${entry.path}` },
          entry.preview === undefined
            ? imageGlyph()
            : React.createElement('img', { className: CLASS.thumb, src: entry.preview, alt: '' }),
          React.createElement('span', { className: CLASS.name }, entry.name),
          React.createElement('span', { className: CLASS.size }, formatBytes(entry.bytes)),
          React.createElement(
            'button',
            {
              type: 'button',
              className: CLASS.remove,
              onClick: () => { dismiss(entry.path) },
              'aria-label': t('dock.remove', { name: entry.name }),
              title: t('dock.remove', { name: entry.name }),
            },
            closeGlyph(),
          ),
        ))

        const children = [
          React.createElement(
            'span',
            { key: 'label', className: CLASS.label, title: t('dock.hint') },
            t('dock.label'),
          ),
          React.createElement('ul', { key: 'list', className: CLASS.list }, rows),
        ]
        if (snapshot.busy > 0) {
          children.push(React.createElement('span', { key: 'busy', className: CLASS.busy }, t('dock.busy')))
        }
        if (snapshot.error !== '') {
          children.push(React.createElement(
            'p',
            { key: 'error', className: CLASS.error, role: 'status' },
            t('dock.error', { reason: snapshot.error }),
          ))
        }
        return React.createElement('div', { className: CLASS.dock }, children)
      }
    }

    // -------------------------------------------------------------- plugin

    exports.name = NS
    /**
     * Required services: the slot registry and locale for the strip, `sessions`
     * for the current selection and its workspace root, and `connection` for the
     * channel that carries the bytes.
     */
    exports.inject = ['slots', 'locale', 'sessions', 'connection']

    /**
     * Register the dictionaries, the stylesheet, the dock entry, and — only once
     * the channel has answered — the paste interception.
     * @param {object} ctx - client root context.
     */
    exports.apply = function (ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'qwen-image: dictionaries')
      ctx.effect(() => installStyles(), 'qwen-image: stylesheet')
      const t = ctx.locale.bind(NS)
      const state = createPasteState()

      ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
        name: 'conversation.input.dock',
        id: NS,
        // After the shipped entries (todo 0, goal 10, queue 20): this strip is
        // about what the NEXT message carries, so it belongs nearest the composer.
        order: 30,
        locale: NS,
      }, createDock({ state, sessions: ctx.sessions, connection: ctx.connection, t, logger: ctx.logger })))

      /*
       * Probe before intercepting.
       *
       * The desktop shell loads the app over `file://` and forwards fetches
       * through its own bridge rather than the web server, and `/api` is the only
       * route constant the app exports — so a bridge built around that prefix
       * would never carry this channel. On such a build the probe fails and the
       * app's own paste handling is left exactly as it was, which is the only
       * honest outcome: cancelling a paste this plugin cannot complete would
       * destroy the clipboard for nothing.
       */
      ctx.effect(() => {
        let dispose
        const controller = new AbortController()
        void callChannel(ctx.connection, 'probe', {}, controller.signal)
          .then(() => {
            if (controller.signal.aborted) return
            dispose = installInterception({
              connection: ctx.connection,
              sessions: ctx.sessions,
              state,
              t,
              logger: ctx.logger,
            })
          })
          .catch((error) => {
            ctx.logger?.info?.(
              `qwen-image: the paste channel is unreachable (${String(error?.code ?? error)}); `
              + 'leaving the app\'s own paste handling alone',
            )
          })
        return () => {
          controller.abort()
          dispose?.()
        }
      }, 'qwen-image: paste interception')
    }

    // The loader takes the factory's RETURN value as the plugin exports
    // (`module.exports = ...` alone yields undefined and fails the mount).
    return exports
  },
})
