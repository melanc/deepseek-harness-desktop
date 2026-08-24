/**
 * main-session -- workspace completion callback
 *
 * The missing half of the dispatch flow: instead of the main session
 * *polling* a workspace session (`workspace_await_reply`), the workspace
 * session *pushes* its result back when its turn actually finishes.
 *
 * A workspace agent is an ordinary DSH agent: while it works it emits
 * `step/start`, `assistant/chunk`, `tool/call`, `assistant/message`, … and
 * finally a `turn/end` carrying the settle reason (`completed` / `error` /
 * `max-tokens`). That `turn/end` is the authoritative "this delegation
 * finished" signal — exactly what the main session should react to, once,
 * instead of waking on every intermediate `assistant/message` and asking the
 * worker "are you done yet?" over and over.
 *
 * This module is a pure coordinator: it takes an observed `turn/end`,
 * consults the dispatch ledger (the session-activity store, where
 * `sendMessage` / `createWorkspaceSession` already wrote a `running` row),
 * and — only when that session actually has an in-flight delegation — reads
 * the finished assistant text, records the terminal ledger row, and injects a
 * one-line summary back into the main session as a next-turn input. The main
 * session's persona then reports that one summary and says nothing else.
 *
 * Sessions with no `running` ledger row (a workspace session the user opened
 * and drove by hand) are ignored: their `turn/end` is not the main session's
 * business.
 */

import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import {
  MAIN_SESSION_PLUGIN,
  type SessionActivity,
  type SessionActivityStatus,
} from './types.ts'
import { summarize } from './service.ts'

// ============================================================
// Structural views (no dependency on unpublished DSH types)
// ============================================================

/** The subset of a session event the callback needs to classify a finish. */
export interface TurnEndEvent {
  readonly type: string
  readonly data?: { reason?: { kind?: string } }
}

/** The subset of a session the callback needs to read the final text. */
export interface CompletionSessionView {
  readonly events: ReadonlyArray<{
    readonly type: string
    readonly seq: number
  }>
  deriveMessages(): ReadonlyArray<{
    readonly role: string
    readonly content: readonly unknown[]
  }>
}

/** The subset of an agent the callback needs to wake the main session. */
export interface CompletionAgentView {
  readonly id: string
  followup(message: unknown): void
}

/**
 * Dependencies injected by the host (see `index.ts`). Kept as a plain
 * interface so the coordinator is unit-testable without a live Cordis root.
 */
export interface CompletionCallbackDeps {
  /**
   * Whether the session id names the main session itself. The main session's
   * own turns must never be echoed back into itself.
   */
  isMainSession(sessionId: string): boolean
  /**
   * Resolve the newest in-flight (`running`) delegation for a session, or
   * undefined when the session has none.
   */
  latestRunningTask(sessionId: string): Promise<string | undefined>
  /**
   * Resolve the workspace display info for a session (for the jump pointer).
   */
  workspaceOf(sessionId: string): { id: string; name: string } | undefined
  /**
   * Record the terminal row for a delegation.
   */
  recordFinish(
    sessionId: string,
    task: string,
    status: Exclude<SessionActivityStatus, 'running'>,
    summary?: string,
    workspace?: { id: string; name: string },
  ): void
  /**
   * Inject a message into the main session and wake it for a report turn.
   */
  notifyMainSession(message: string): void
}

/**
 * A completion observation that produced a report, or null when the event
 * was not a workspace turn ending (or belonged to a non-delegated session).
 */
export interface CompletionReport {
  readonly sessionId: string
  readonly task?: string
  readonly status: SessionActivityStatus
  readonly summary?: string
}

// ============================================================
// Coordinator
// ============================================================

/**
 * React to one observed session event. Only `turn/end` of a *non-main*
 * session that currently has a `running` delegation triggers work:
 *
 * 1. map the settle reason to a ledger status (`completed` / `failed`,
 *    anything else with an assistant reply → `completed`, otherwise `failed`);
 * 2. read the finished assistant text and summarize it;
 * 3. record the terminal ledger row;
 * 4. inject a one-line summary into the main session.
 *
 * @returns the report produced, or null when the event is ignored.
 */
export async function handleSessionEvent(
  event: TurnEndEvent,
  sessionId: string,
  session: CompletionSessionView,
  deps: CompletionCallbackDeps,
): Promise<CompletionReport | null> {
  if (event.type !== 'turn/end') return null
  if (deps.isMainSession(sessionId)) return null

  const task = await deps.latestRunningTask(sessionId)
  if (task === undefined) return null

  const text = readNewestAssistantText(session)
  const summary = text === null ? undefined : summarize(text, 800)

  // A turn with an assistant reply is reported as completed (its text is the
  // outcome), even on an error/max-tokens settle; a turn with no surface
  // reply at all is a failure.
  const status: SessionActivityStatus =
    summary === undefined ? 'failed' : 'completed'

  const workspace = deps.workspaceOf(sessionId)
  deps.recordFinish(sessionId, task, status, summary, workspace)

  deps.notifyMainSession(renderReportNotification({
    sessionId,
    task,
    status,
    ...(summary === undefined ? {} : { summary }),
    ...(workspace === undefined ? {} : { workspace }),
  }))

  return {
    sessionId,
    task,
    status,
    ...(summary === undefined ? {} : { summary }),
  }
}

/**
 * Render the one-line notification the main session receives as a followup.
 * This is a user-visible trigger for the main session's *report* turn, not
 * the report itself — the main session's persona turns it into the final
 * one-sentence summary shown to the user.
 */
export function renderReportNotification(report: {
  sessionId: string
  task?: string
  status: SessionActivityStatus
  summary?: string
  workspace?: { id: string; name: string }
}): string {
  const where = report.workspace === undefined
    ? report.sessionId
    : `${report.workspace.name}（${report.sessionId}）`
  const outcome = report.status === 'completed'
    ? report.summary === undefined
      ? '已完成'
      : `已完成：${report.summary}`
    : '执行失败'
  return `【工作区完成】${where} 的任务${report.task === undefined ? '' : `「${report.task}」`}${outcome}。请向用户简洁汇报结果（一句话：谁完成了什么、结论如何、完整结果在工作区会话查看）。`
}

/**
 * Read the newest assistant text block on the session surface, or null when
 * there is none. Mirrors `MainSessionService.readNewestAssistantText` so the
 * callback can run standalone.
 */
export function readNewestAssistantText(session: CompletionSessionView): string | null {
  const messages = session.deriveMessages()
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message === undefined || message.role !== 'assistant') continue
    const text = extractText(message.content)
    if (text.trim() === '') continue
    return text
  }
  return null
}

/** Extract concatenated text from a content block list (text blocks only). */
function extractText(content: readonly unknown[]): string {
  if (!Array.isArray(content)) return ''
  return content
    .filter((block): block is { type: 'text'; text: string } =>
      typeof block === 'object' && block !== null &&
      (block as { type?: unknown }).type === 'text' &&
      typeof (block as { text?: unknown }).text === 'string',
    )
    .map((block) => block.text)
    .join('\n')
}

/** Build a plugin-sourced user message for the main session followup. */
export function buildNotificationMessage(text: string): UserMessage {
  return createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: MAIN_SESSION_PLUGIN },
  })
}

// Re-export for consumers/tests.
export type { SessionActivity }
