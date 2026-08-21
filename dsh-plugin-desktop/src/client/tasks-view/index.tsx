/**
 * tasks-view -- 会话页「输入」tab
 *
 * Registers a third `conversation.view` tab (after 对话/轨迹): 输入.
 * It records every user input message in the session — each user message
 * is listed newest-first with its timestamp and text, giving the user a
 * lightweight "input log" of what they asked in this session.
 *
 * Data source: `api.sessions.history({ sessionId })` (the same RPC the
 * conversation surface pages with), filtering `user/message` events whose
 * source is the user (not plugin-injected traffic from message-channels or
 * the main session).
 */

import { useEffect, useRef, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '../contracts.ts'

/** Stable view id for the inputs tab. */
export const TASKS_VIEW_ID = 'inputs'

// ============================================================
// Data types (loose projection of session.history)
// ============================================================

interface HistoryEvent {
  event: {
    type: string
    seq?: number
    time?: number
    data?: {
      role?: string
      content?: Array<{ type?: string; text?: string }>
      source?: { kind?: string; plugin?: string }
    }
  }
}

interface HistoryResult {
  events?: HistoryEvent[]
  hasMore?: boolean
}

interface SessionsApi {
  history(request: { sessionId: string; maxMessages?: number }): Promise<{
    result: { ok: boolean; value?: HistoryResult; error?: { message?: string } }
  }>
}

// ============================================================
// Plugin entry
// ============================================================

/**
 * Register the tasks view tab. Resolves `connection` dynamically so the
 * bundle stays loadable in compositions without the conversation surface.
 * @param ctx - client root context.
 */
export function applyTasksView(ctx: ClientContext): void {
  ctx.slots.inject('conversation.view', () => ctx.slots.register({
    name: 'conversation.view',
    id: TASKS_VIEW_ID,
    order: 20,
    label: () => '输入',
    inject: (sessionId: string) => {
      const connection = ctx.get('connection') as { api?: { sessions?: SessionsApi } } | undefined
      if (connection?.api?.sessions === undefined) {
        throw new Error(`tasks-view: connection api unavailable for session "${sessionId}"`)
      }
      return {
        sessionId,
        history: connection.api.sessions,
      }
    },
  }, TasksView))
}

// ============================================================
// Tasks view component
// ============================================================

interface TasksViewProps {
  sessionId: string
  history: SessionsApi
}

interface TaskItem {
  seq: number
  time: number
  text: string
}

/** Extract text from a user message's content blocks. */
function messageText(data: HistoryEvent['event']['data']): string {
  const content = data?.content
  if (!Array.isArray(content)) return ''
  return content
    .filter((block) => block?.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
}

/** Load user messages from session history, newest-first. */
async function loadUserMessages(history: SessionsApi, sessionId: string): Promise<TaskItem[]> {
  const response = await history.history({ sessionId, maxMessages: 200 })
  if (!response.result.ok || response.result.value === undefined) {
    throw new Error(response.result.error?.message ?? 'failed to load history')
  }
  const events = response.result.value.events ?? []
  const tasks: TaskItem[] = []
  for (const entry of events) {
    const ev = entry.event
    if (ev.type !== 'user/message') continue
    const sourceKind = ev.data?.source?.kind
    // Only genuine user inputs — skip plugin-injected traffic.
    if (sourceKind !== 'user') continue
    const text = messageText(ev.data)
    if (!text.trim()) continue
    tasks.push({
      seq: ev.seq ?? 0,
      time: ev.time ?? 0,
      text,
    })
  }
  // Newest first (history is oldest-first).
  return tasks.sort((a, b) => b.time - a.time || b.seq - a.seq)
}

/** Format an epoch ms timestamp as local date + time. */
function formatTime(epochMs: number): string {
  if (epochMs <= 0) return ''
  const d = new Date(epochMs)
  const pad = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function TasksView({ sessionId, history }: TasksViewProps): JSX.Element {
  const [tasks, setTasks] = useState<TaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const loadedRef = useRef<string | null>(null)

  useEffect(() => {
    // Reload when the session changes; a session-scoped effect keeps it simple.
    if (loadedRef.current === sessionId) return
    loadedRef.current = sessionId
    let cancelled = false
    setLoading(true)
    setError(null)
    loadUserMessages(history, sessionId)
      .then((items) => {
        if (cancelled) return
        setTasks(items)
        setLoading(false)
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
        setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId])

  return (
    <div className="tv-root">
      <div className="tv-header">
        <span className="tv-title">输入记录</span>
        <span className="tv-count">{tasks.length} 条</span>
      </div>
      {loading && <div className="tv-empty">加载中…</div>}
      {!loading && error !== null && <div className="tv-error">{error}</div>}
      {!loading && error === null && tasks.length === 0 && (
        <div className="tv-empty">暂无输入记录</div>
      )}
      {!loading && error === null && tasks.length > 0 && (
        <ul className="tv-list">
          {tasks.map((task) => (
            <li key={task.seq} className="tv-item">
              <div className="tv-time">{formatTime(task.time)}</div>
              <div className="tv-text">{task.text}</div>
            </li>
          ))}
        </ul>
      )}
      <style>{`
        .tv-root { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 16px 20px; gap: 12px; overflow: hidden; }
        .tv-header { display: flex; align-items: baseline; gap: 8px; flex: none; }
        .tv-title { font-size: 14px; font-weight: 600; color: var(--dsw-alias-label-primary, #eee); }
        .tv-count { font-size: 12px; color: var(--dsw-alias-label-caption, #999); }
        .tv-list { list-style: none; margin: 0; padding: 0; flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; }
        .tv-item { border: 1px solid var(--dsw-alias-border-l1, #333); border-radius: 8px; padding: 10px 12px; background: var(--dsw-alias-bg-layer-1, #222); }
        .tv-time { font-size: 11px; color: var(--dsw-alias-label-caption, #999); margin-bottom: 4px; font-variant-numeric: tabular-nums; }
        .tv-text { font-size: 13px; line-height: 1.6; color: var(--dsw-alias-label-primary, #eee); white-space: pre-wrap; word-break: break-word; }
        .tv-empty { color: var(--dsw-alias-label-tertiary, #777); font-size: 13px; padding: 24px 0; text-align: center; }
        .tv-error { color: var(--dsw-alias-state-error-primary, #f66); font-size: 13px; }
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
