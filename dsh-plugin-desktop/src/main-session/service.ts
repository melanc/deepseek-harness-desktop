/**
 * main-session -- MainSessionService
 *
 * Owns the system-level main session agent and its orchestration surface:
 *
 * - **Agent lifecycle**: lazily creates (or resumes) the `main-session`
 *   root agent on first use, keeps it registered, and disposes it with the
 *   plugin. The agent is created through the registered agent factory
 *   (`ctx.agents.create`), so it participates in the ordinary DSH loop.
 * - **Workspace enumeration**: lists workspace-attached sessions from the
 *   workspace registry (`ctx.workspaceRegistry`) merged with live agents,
 *   enriching each with title/activity.
 * - **Messaging**: sends a message to any target session via
 *   `agent.followup(createUserMessage(...))` — the same injection path the
 *   message-channels dispatcher uses.
 * - **Reply wait**: waits for the target session's next assistant message
 *   (polling `session.deriveMessages()`) and returns its text, so the main
 *   session can collect results from workspace sessions.
 *
 * The service is provided as `ctx.mainSession` and the three orchestration
 * tools are registered scoped to the main agent only (see tools.ts).
 */

import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import {
  MAIN_SESSION_ID,
  LOG_TAG,
  DEFAULT_REPLY_SUMMARY_CHARS,
  type ListSessionsResult,
  type SendMessageResult,
  type AwaitReplyResult,
  type CreateWorkspaceSessionResult,
  type WorkspaceSessionView,
} from './types.ts'

// ============================================================
// Constants
// ============================================================

/** Poll interval while waiting for a target session to produce a reply. */
const REPLY_POLL_INTERVAL_MS = 500

/** Default max wait for a workspace session reply. */
const DEFAULT_REPLY_TIMEOUT_MS = 5 * 60 * 1000

// ============================================================
// Service
// ============================================================

export interface MainSessionDeps {
  /** Create or resume the main agent. */
  ensureAgent(): Promise<AgentHandle>
  /** Resolve a live agent by session id. */
  getAgent(sessionId: string): Agent | undefined
  /** List all live agents (excluding none; the service filters the main id). */
  listLiveAgents(): Agent[]
  /** Enumerate workspace-attached session ids (workspace registry). */
  listWorkspaceSessionIds(): string[]
  /** Resolve workspace display info for a session. */
  workspaceOf(sessionId: string): { id: string; name: string } | undefined
  /** Resolve a session title. */
  titleOf(sessionId: string): Promise<string | undefined>
  /** Read the last activity time for a session. */
  lastActiveOf(sessionId: string): number | undefined
  /** Count surface messages for a session (activity heuristic). */
  messageCountOf(sessionId: string): number
  /**
   * Create a workspace session: ensure the workspace exists (creating the
   * folder under the default workspace root when no path is given), create
   * an agent rooted at the workspace path, attach it to the workspace, and
   * optionally dispatch the initial task.
   */
  createWorkspaceSession(options: {
    workspacePath?: string
    workspaceTitle?: string
    task?: string
    sessionId?: string
  }): Promise<{
    sessionId: string
    workspaceId?: string
    error?: string
  }>
}

export class MainSessionService {
  private readonly deps: MainSessionDeps
  private agentHandle: AgentHandle | undefined
  private ensuring: Promise<AgentHandle> | undefined

  constructor(deps: MainSessionDeps) {
    this.deps = deps
  }

  /** The main agent, creating/resuming it on first access. */
  async getMainAgent(): Promise<AgentHandle> {
    if (this.agentHandle !== undefined) return this.agentHandle
    this.ensuring ??= this.deps.ensureAgent().then((handle) => {
      this.agentHandle = handle
      return handle
    })
    return this.ensuring
  }

  /** Whether the main agent is currently live. */
  isMainAgentLive(): boolean {
    return this.deps.getAgent(MAIN_SESSION_ID) !== undefined
  }

  /** Dispose the main agent (called on plugin teardown). */
  async disposeMainAgent(): Promise<void> {
    const handle = this.agentHandle
    this.agentHandle = undefined
    this.ensuring = undefined
    if (handle !== undefined) {
      await handle.dispose().catch((err: unknown) => {
        console.error(`${LOG_TAG} main agent dispose failed:`, err)
      })
    }
  }

  // ── Workspace enumeration ──────────────────────────────────────────────

  /** Enumerate all workspace-attached and ungrouped sessions. */
  async listSessions(): Promise<ListSessionsResult> {
    const ids = this.deps.listWorkspaceSessionIds()
    const liveIds = new Set<string>(
      this.deps.listLiveAgents().map((a) => a.id as unknown as string),
    )

    // Workspace-attached sessions (registry order).
    const sessions: WorkspaceSessionView[] = []
    const seen = new Set<string>()
    for (const id of ids) {
      if (seen.has(id)) continue
      seen.add(id)
      sessions.push(await this.viewOf(id, liveIds.has(id)))
    }

    // Ungrouped: live agents not attached to any workspace, excluding the
    // main session itself.
    const ungrouped: WorkspaceSessionView[] = []
    for (const agent of this.deps.listLiveAgents()) {
      if (agent.id === MAIN_SESSION_ID) continue
      if (seen.has(agent.id)) continue
      seen.add(agent.id)
      ungrouped.push(await this.viewOf(agent.id, true))
    }
    ungrouped.sort((a, b) => (b.lastActiveAt ?? 0) - (a.lastActiveAt ?? 0))

    return { sessions, ungrouped, complete: true }
  }

  /** Build one session view. */
  private async viewOf(sessionId: string, live: boolean): Promise<WorkspaceSessionView> {
    const ws = this.deps.workspaceOf(sessionId)
    const title = await this.deps.titleOf(sessionId).catch(() => undefined)
    const lastActiveAt = this.deps.lastActiveOf(sessionId)
    return {
      sessionId,
      ...ws === undefined ? {} : { workspaceId: ws.id, workspaceName: ws.name },
      ...title === undefined ? {} : { title },
      live,
      ...lastActiveAt === undefined ? {} : { lastActiveAt },
      messageCount: this.deps.messageCountOf(sessionId),
    }
  }

  // ── Messaging ──────────────────────────────────────────────────────────

  /**
   * Send a message to a target session via followup injection.
   *
   * The target must have a live agent (created/resumed by the user's
   * workspace UI or by this service). The message is injected as a
   * next-turn input with a plugin source so the transcript attributes it
   * to the main session.
   */
  sendMessage(sessionId: string, message: string): SendMessageResult {
    const agent = this.deps.getAgent(sessionId)
    if (agent === undefined) {
      return {
        success: false,
        error: `Session ${sessionId} has no live agent (is it open in a workspace?)`,
      }
    }
    try {
      const userMessage = createUserMessage({
        content: [{ type: 'text', text: message }],
        source: { kind: 'plugin', plugin: 'main-session' },
      })
      agent.followup(userMessage)
      return { success: true }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  /**
   * Create a workspace session (ensuring the workspace exists), attach it to
   * the workspace, and optionally dispatch the initial task to it.
   *
   * This lets the main session create a dedicated worker session on demand:
   * "create a session for workspace X and give it task Y". When
   * `workspacePath` is omitted, the workspace folder is created under the
   * DSH default workspace root.
   */
  async createWorkspaceSession(
    options: {
      workspacePath?: string
      workspaceTitle?: string
      task?: string
      sessionId?: string
    },
  ): Promise<CreateWorkspaceSessionResult> {
    try {
      const created = await this.deps.createWorkspaceSession({
        ...(options.workspacePath === undefined ? {} : { workspacePath: options.workspacePath }),
        ...(options.workspaceTitle === undefined ? {} : { workspaceTitle: options.workspaceTitle }),
        ...(options.task === undefined ? {} : { task: options.task }),
        ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
      })
      if (created.error !== undefined) {
        return { success: false, error: created.error }
      }
      return {
        success: true,
        sessionId: created.sessionId,
        ...(created.workspaceId === undefined ? {} : { workspaceId: created.workspaceId }),
      }
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      }
    }
  }

  /**
   * Wait for a target session's next assistant reply after a message was
   * injected. Records the surface seq before waiting, then polls the target
   * agent's derived messages until a new assistant message appears or the
   * timeout elapses.
   */
  async awaitReply(
    sessionId: string,
    options: { timeoutMs?: number; afterSeq?: number; maxReplyChars?: number } = {},
  ): Promise<AwaitReplyResult> {
    const agent = this.deps.getAgent(sessionId)
    if (agent === undefined) {
      return { sessionId, timedOut: false, error: `Session ${sessionId} has no live agent` }
    }

    const afterSeq = options.afterSeq ?? agent.session.seq
    const timeoutMs = options.timeoutMs ?? DEFAULT_REPLY_TIMEOUT_MS
    const maxChars = options.maxReplyChars ?? DEFAULT_REPLY_SUMMARY_CHARS
    const ws = this.deps.workspaceOf(sessionId)
    const startedAt = Date.now()

    while (true) {
      const text = this.readNewestAssistantText(agent, afterSeq)
      if (text !== null) {
        return {
          sessionId,
          summary: summarize(text, maxChars),
          ...ws === undefined ? {} : { workspaceId: ws.id, workspaceName: ws.name },
          timedOut: false,
        }
      }
      if (Date.now() - startedAt > timeoutMs) {
        return { sessionId, timedOut: true }
      }
      await sleep(REPLY_POLL_INTERVAL_MS)
    }
  }

  /** Read the newest assistant text block appended after `afterSeq`, if any. */
  private readNewestAssistantText(agent: Agent, afterSeq: number): string | null {
    const newestAssistantEvent = agent.session.events.findLast(
      (e) => e.type === 'assistant/message',
    )
    if (newestAssistantEvent === undefined || newestAssistantEvent.seq <= afterSeq) {
      return null
    }
    const messages = agent.session.deriveMessages()
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message === undefined || message.role !== 'assistant') continue
      const text = extractText(message.content)
      if (!text.trim()) continue
      return text
    }
    return null
  }

  // ── Internals ──────────────────────────────────────────────────────────
}

// ============================================================
// Module helpers
// ============================================================

/** Extract concatenated text from ContentBlock[] (text blocks only). */
export function extractText(content: readonly unknown[]): string {
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

/** Promise-based sleep. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Summarize a reply for the main session: truncate to `maxChars` with an
 * ellipsis and a pointer that the full result lives in the workspace
 * session. The main session reports outcome, not transcripts.
 */
export function summarize(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}…（完整结果见工作区会话）`
}

/** Brand a raw session id (identity helper, mirrors dsh-session's brand). */
export function sessionIdOf(value: string): SessionId {
  return value as SessionId
}
