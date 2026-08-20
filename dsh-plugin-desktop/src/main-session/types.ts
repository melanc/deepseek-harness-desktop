/**
 * main-session -- shared types
 *
 * Contracts for the system-level main session feature: session enumeration
 * views, outbound message requests, and reply waits. The main session is a
 * root DSH agent (fixed session id) that can manage all workspace sessions:
 * list them, send them messages, and collect their results.
 */

// ============================================================
// Session enumeration
// ============================================================

/** One workspace session view returned to the main session. */
export interface WorkspaceSessionView {
  /** Session id (stable identity). */
  readonly sessionId: string
  /** Workspace id / display title when the session is workspace-attached. */
  readonly workspaceId?: string
  /** Workspace title (from the workspace registry) when available. */
  readonly workspaceName?: string
  /** Session title (from the session-query title provider). */
  readonly title?: string
  /** Whether a live agent is currently registered for this session. */
  readonly live: boolean
  /** Last activity epoch ms (from the session header). */
  readonly lastActiveAt?: number
  /** Count of messages on the session surface (cheap heuristic for activity). */
  readonly messageCount?: number
}

/** Result of enumerating all workspace sessions. */
export interface ListSessionsResult {
  /** All workspace-attached sessions (workspace registry order). */
  readonly sessions: WorkspaceSessionView[]
  /** Sessions not attached to any workspace (ungrouped). */
  readonly ungrouped: WorkspaceSessionView[]
  /** Whether enumeration completed without persistence errors. */
  readonly complete: boolean
}

// ============================================================
// Outbound message
// ============================================================

/** Request to send a message to a target session. */
export interface SendMessageRequest {
  /** Target session id (workspace session or any live session). */
  readonly sessionId: string
  /** Message body text. */
  readonly message: string
}

/** Result of sending a message to a target session. */
export interface SendMessageResult {
  readonly success: boolean
  readonly messageId?: string
  readonly error?: string
}

// ============================================================
// Reply wait
// ============================================================

/**
 * Result of waiting for a target session's next assistant reply.
 *
 * The main session is a concise dispatcher: it reports execution progress
 * and a **summary** of the result, never the full transcript. The full
 * result stays in the workspace session — the main session points the user
 * there via the workspace info fields.
 */
export interface AwaitReplyResult {
  readonly sessionId: string
  /**
   * Summarized assistant text (truncated to `maxReplyChars`, default
   * {@link DEFAULT_REPLY_SUMMARY_CHARS}). Enough to report progress/outcome,
   * not a full transcript.
   */
  readonly summary?: string
  /** Workspace the session belongs to (jump target for the user). */
  readonly workspaceId?: string
  readonly workspaceName?: string
  /** True when the wait timed out without a new assistant message. */
  readonly timedOut: boolean
  readonly error?: string
}

// ============================================================
// Workspace session creation
// ============================================================

/** Request to create a new workspace session and dispatch a task to it. */
export interface CreateWorkspaceSessionRequest {
  /**
   * Workspace directory path (absolute). When omitted, a workspace folder
   * is created under the DSH default workspace root
   * (`~/.dsh/workspaces/<workspaceTitle>/`).
   */
  readonly workspacePath?: string
  /** Workspace display title (used when the workspace is new). */
  readonly workspaceTitle?: string
  /** Initial task message dispatched to the new session. */
  readonly task?: string
  /** Optional session id (defaults to a generated uuid). */
  readonly sessionId?: string
}

/** Result of creating a workspace session. */
export interface CreateWorkspaceSessionResult {
  readonly success: boolean
  /** The created (or reused) workspace session id. */
  readonly sessionId?: string
  /** Workspace id the session was attached to. */
  readonly workspaceId?: string
  readonly error?: string
}

// ============================================================
// Constants
// ============================================================

/** Fixed session id for the system-level main session. */
export const MAIN_SESSION_ID = 'main-session'

/** Plugin name for the main-session feature. */
export const MAIN_SESSION_PLUGIN = 'main-session'

/**
 * Default character budget for the summarized reply returned to the main
 * session. Kept short so the main session stays a concise dispatcher —
 * enough to report outcome, not a full transcript.
 */
export const DEFAULT_REPLY_SUMMARY_CHARS = 800

/** Logger tag prefix. */
export const LOG_TAG = '[MainSession]'
