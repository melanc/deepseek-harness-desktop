/**
 * archive-confirm -- confirmation overlay
 *
 * Renders a confirmation dialog in the `shell.overlay` slot whenever the
 * workspace browser requests archiving a session. The bridge (owned by the
 * apply closure) holds the pending request; this component subscribes to it
 * and settles it (confirm → archive proceeds, cancel → archive dropped).
 */

import { useSyncExternalStore } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/** Pending-confirmation observable passed through inject. */
export interface PendingArchiveSource {
  getSnapshot(): { sessionId: string } | undefined
  subscribe(listener: () => void): () => void
}

/** Bridge shared by the RPC guard and this overlay. */
export interface ArchiveConfirmBridge {
  /** Observable pending state (undefined when idle). */
  source: PendingArchiveSource
  /** Present a confirmation; resolves true when confirmed, false when cancelled. */
  open(sessionId: string): Promise<boolean>
  /** Settle the current pending as confirmed. */
  confirm(): void
  /** Settle the current pending as cancelled. */
  cancel(): void
}

export type ArchiveConfirmOverlayProps = PropsRuntime<'shell.overlay'> & {
  bridge: ArchiveConfirmBridge
}

export function ArchiveConfirmOverlay({ bridge }: ArchiveConfirmOverlayProps): JSX.Element | null {
  const pending = useSyncExternalStore(
    bridge.source.subscribe,
    bridge.source.getSnapshot,
    bridge.source.getSnapshot,
  )

  if (pending === undefined) return null
  return (
    <div className="ac-overlay" role="dialog" aria-modal="true" aria-label="归档会话确认">
      <button
        type="button"
        className="ac-mask"
        aria-label="取消归档"
        onClick={() => bridge.cancel()}
      />
      <section className="ac-panel">
        <h1 className="ac-title">归档会话</h1>
        <p className="ac-body">
          确定要归档该会话吗？归档后它将从会话列表中隐藏（日志与数据保留，可随时取消归档恢复）。
        </p>
        <div className="ac-actions">
          <Button variant="outline" onClick={() => bridge.cancel()}>取消</Button>
          <Button variant="primary" onClick={() => bridge.confirm()}>确认归档</Button>
        </div>
      </section>
      <style>{`
        .ac-overlay { position: fixed; z-index: 1000; inset: 0; display: flex; align-items: center; justify-content: center; }
        .ac-mask { position: absolute; inset: 0; background: rgba(0,0,0,0.5); border: none; cursor: default; }
        .ac-panel { position: relative; width: 360px; max-width: calc(100vw - 32px); background: var(--dsw-alias-bg-base, #1e1e1e); border: 1px solid var(--dsw-alias-border-l2, #333); border-radius: 12px; padding: 20px; box-shadow: var(--dsw-shadow-lv3, 0 8px 24px rgba(0,0,0,0.4)); }
        .ac-title { margin: 0 0 8px; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary, #eee); }
        .ac-body { margin: 0 0 20px; font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-secondary, #bbb); }
        .ac-actions { display: flex; justify-content: flex-end; gap: 8px; }
      `}</style>
    </div>
  )
}
