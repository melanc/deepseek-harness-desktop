/**
 * archive-confirm -- 归档会话二次确认
 *
 * Wraps the workspace `archiveSession` RPC so archiving a session asks for
 * confirmation first. The browser's archive action is non-destructive (the
 * log and workspace slot remain; the row just hides), but it is easy to hit
 * by accident, so the desktop adds a confirmation overlay (`shell.overlay`).
 *
 * The wrap happens at the API boundary: `connection.api.workspace
 * .archiveSession` is replaced with a guarded version that parks the request
 * in a pending-confirmation holder and only calls through once the user
 * confirms. The overlay component receives the holder through inject and
 * renders while a request is pending. The original method is restored on
 * plugin disposal.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contracts.ts'
import { ArchiveConfirmOverlay } from './overlay.tsx'
import type { ArchiveConfirmBridge } from './overlay.tsx'

/** Stable overlay id for the archive confirmation. */
export const ARCHIVE_CONFIRM_OVERLAY_ID = 'archive-confirm'

/** Minimal projection of the workspace RPC channel we wrap. */
interface WorkspaceArchiveApi {
  archiveSession(request: { sessionId: string }): Promise<{ result: { ok: boolean } }>
}

/** Minimal projection of the connection handle. */
interface ConnectionWithWorkspace {
  api?: { workspace?: WorkspaceArchiveApi }
}

/** One pending archive confirmation (settled by the overlay). */
interface PendingArchive {
  sessionId: string
  resolve: () => void
  reject: () => void
}

/** Minimal observable: snapshot + subscribe (no store engine needed). */
interface PendingSource {
  getSnapshot(): PendingArchive | undefined
  subscribe(listener: () => void): () => void
}

/** Build the pending-confirmation holder shared by guard and overlay. */
function createPendingBridge(): ArchiveConfirmBridge {
  let pending: PendingArchive | undefined
  const listeners = new Set<() => void>()
  const notify = (): void => { for (const listener of listeners) listener() }
  const source: PendingSource = {
    getSnapshot: () => pending,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
  }
  return {
    source,
    open: (sessionId) => {
      return new Promise<boolean>((resolve) => {
        // A second archive while one is pending: settle the first as
        // cancelled, then present the new request.
        if (pending !== undefined) pending.reject()
        pending = {
          sessionId,
          resolve: () => { pending = undefined; notify(); resolve(true) },
          reject: () => { pending = undefined; notify(); resolve(false) },
        }
        notify()
      })
    },
    confirm: () => {
      const current = pending
      current?.resolve()
    },
    cancel: () => {
      const current = pending
      current?.reject()
    },
  }
}

/**
 * Install the archive confirmation: wrap the RPC and register the overlay.
 * @param ctx - client root context.
 */
export function applyArchiveConfirm(ctx: ClientContext): void {
  const bridge = createPendingBridge()

  // Wrap the archive RPC at the API boundary. The workspace browser calls
  // through this same channel, so every archive request passes the guard.
  ctx.effect(() => {
    const connection = ctx.get('connection') as unknown as ConnectionWithWorkspace | undefined
    const workspace = connection?.api?.workspace
    if (workspace === undefined || typeof workspace.archiveSession !== 'function') {
      return () => {}
    }

    const original = workspace.archiveSession.bind(workspace)
    const guarded: WorkspaceArchiveApi['archiveSession'] = async (request) => {
      const confirmed = await bridge.open(request.sessionId)
      if (!confirmed) {
        // Cancelled: mirror the RPC failure shape so the caller's catch
        // swallows it (the browser logs a non-fatal console diagnostic).
        return { result: { ok: false } }
      }
      return original(request)
    }
    workspace.archiveSession = guarded

    return () => {
      if (workspace.archiveSession === guarded) {
        workspace.archiveSession = original
      }
    }
  }, 'dsh-plugin-desktop: archive confirmation guard')

  // Register the confirmation dialog in the shell overlay slot.
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: ARCHIVE_CONFIRM_OVERLAY_ID,
    order: 5,
    inject: () => ({ bridge }),
  }, ArchiveConfirmOverlay))
}
