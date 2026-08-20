/**
 * main-session -- sidebar entry
 *
 * Registers a fixed 「主会话」button in the sidebar footer
 * (`sidebar.footer.action`), opening the system-level main session
 * (session id `main-session`) when clicked. The main agent is created at
 * Host plugin activation, so the entry always has a live session to open.
 *
 * Layout note: the footer action slot is also used by the Cordis plugin
 * panel (a full-row 42px component). To avoid flex-row squeezing, this entry
 * renders as a full-width block row of the same height, so the two stack
 * vertically instead of colliding.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contracts.ts'

/** Stable entry id for the sidebar main-session button. */
export const MAIN_SESSION_ENTRY_ID = 'main-session-entry'

/** The system-level main session id (must match the Host plugin). */
export const MAIN_SESSION_SESSION_ID = 'main-session'

// ============================================================
// Plugin entry
// ============================================================

/**
 * Register the sidebar footer entry that opens the main session.
 * Resolves `sessions` dynamically; when unavailable the entry is skipped
 * entirely (never breaks the footer slot).
 * @param ctx - client root context.
 */
export function applyMainSessionEntry(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as {
    open(sessionId: string): void
    refreshList?(): void
  } | undefined
  if (sessions === undefined) return

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: MAIN_SESSION_ENTRY_ID,
    order: 100,
    inject: () => ({ sessions }),
  }, MainSessionEntry))
}

// ============================================================
// Entry component
// ============================================================

interface EntryProps {
  sessions: {
    open(sessionId: string): void
    refreshList?(): void
  }
}

export function MainSessionEntry({ sessions }: EntryProps): JSX.Element {
  const openMainSession = (): void => {
    // Refresh the session list first so a freshly created main session is
    // discovered, then open it. Swallow errors — the entry must never break
    // the footer slot.
    try {
      sessions.refreshList?.()
    } catch { /* ignore */ }
    try {
      sessions.open(MAIN_SESSION_SESSION_ID)
    } catch (err) {
      console.warn('[main-session-entry] open failed:', err)
    }
  }

  return (
    <div className="mse-row">
      <button
        type="button"
        className="mse-button"
        title="主会话（统一入口）"
        onClick={openMainSession}
      >
        <span className="mse-icon" aria-hidden>⌂</span>
        <span className="mse-label">主会话</span>
      </button>
      <style>{`
        .mse-row {
          flex: none;
          width: 100%;
          min-width: 0;
          display: block;
          box-sizing: border-box;
          padding: 0 2px;
        }
        .mse-button {
          display: flex; align-items: center; gap: 8px;
          width: 100%; height: 36px;
          padding: 0 10px 0 8px;
          border: none;
          border-radius: 12px;
          background: transparent;
          color: var(--dsw-alias-label-primary);
          font-size: 14px; font-weight: 500;
          cursor: pointer;
          font-family: inherit;
        }
        .mse-button:hover { background: var(--dsw-alias-interactive-bg-hover); }
        .mse-icon {
          color: var(--dsw-alias-state-business-primary);
          font-size: 15px;
          flex: none;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
        }
        .mse-label { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
      `}</style>
    </div>
  )
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface Element {}
  }
}
