/**
 * main-session -- shared types
 *
 * Contracts for the system-level main session feature: session enumeration
 * views, outbound message requests, and reply waits. The main session is a
 * root DSH agent (fixed session id) that can manage all workspace sessions:
 * list them, send them messages, and collect their results.
 */

// ============================================================
// User memory (semantic memory layer)
// ============================================================

/** Kind of one durable user fact. */
export type MemoryFactType = 'profile' | 'preference' | 'decision' | 'background'

/** One durable user fact row in the JSONL memory log. */
export interface MemoryFact {
  /** Fact kind; drives the overwrite rule and the summary rendering. */
  readonly type: MemoryFactType
  /** Stable fact key (e.g. `name`, `reply-style`, `api-arch`). */
  readonly key: string
  /** Free-text fact value. */
  readonly value: string
  /** Epoch ms when the fact was written. */
  readonly updatedAt: number
  /** Optional provenance note (e.g. which delegation produced a decision). */
  readonly source?: string
}

/** Result of writing one memory fact. */
export interface MemoryWriteResult {
  readonly success: boolean
  readonly fact?: MemoryFact
  readonly error?: string
}

/** Result of reading memory facts. */
export interface MemoryReadResult {
  readonly facts: MemoryFact[]
  readonly complete: boolean
  readonly error?: string
}

/**
 * How the memory log is rendered into the main session's prompt: the loaded
 * profile/preference/background lines plus recent decisions, truncated to a
 * budget so the memory section never dominates the assembly.
 */
export interface MemorySummary {
  /** Rendered prompt-section text (empty when nothing is stored yet). */
  readonly text: string
  /** Number of facts the summary was rendered from. */
  readonly factCount: number
}

/** Default character budget for the rendered memory prompt section. */
export const DEFAULT_MEMORY_SUMMARY_CHARS = 2000

/**
 * Memory log file name under the main session cwd's `memory/` directory.
 * JSONL: append-only, one {@link MemoryFact} per line, newest wins per key.
 */
export const USER_FACTS_FILE = 'user-facts.jsonl'

/** Soft cap on stored facts; beyond it writes still land but the summary warns. */
export const MEMORY_FACT_LIMIT = 5000

// ============================================================
// Procedure memory (procedural/SOP memory layer)
// ============================================================

/** One durable, reusable procedure (SOP) row in the procedures JSONL log. */
export interface Procedure {
  /** Stable procedure key (e.g. `order-refactor`). */
  readonly key: string
  /** Human-readable display name (e.g. 订单模块重构). */
  readonly name: string
  /** Trigger-scenario description; matched when a task arrives. */
  readonly trigger: string
  /** Ordered execution steps. */
  readonly steps: readonly string[]
  /** Completion standard ("what done looks like"). */
  readonly output: string
  /** Optional common pitfalls. */
  readonly pitfalls?: readonly string[]
  /** Times the procedure has been saved/reused (evolution signal). */
  readonly runCount: number
  /** Epoch ms of the last save/update. */
  readonly updatedAt: number
}

/** Result of saving one procedure. */
export interface ProcedureSaveResult {
  readonly success: boolean
  readonly procedure?: Procedure
  readonly error?: string
}

/** Result of recalling procedures. */
export interface ProcedureRecallResult {
  readonly procedures: Procedure[]
  readonly complete: boolean
  readonly error?: string
}

/** Procedure log file name under the main session cwd's `memory/` directory. */
export const PROCEDURES_FILE = 'procedures.jsonl'

/** Soft cap on stored procedures; beyond it saves still land but list warns. */
export const PROCEDURE_LIMIT = 500

/** Default character budget for the rendered procedure list section. */
export const DEFAULT_PROCEDURE_LIST_CHARS = 1500

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
  /**
   * When the wait timed out because the target session is waiting on a
   * pending approval (its last `approval/asked` is still undecided), this
   * names the tool the session is asking permission to run. Absent when the
   * timeout has no such cause.
   */
  readonly awaitingApproval?: string
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
// Session activity log (dispatch ledger)
// ============================================================

/** Lifecycle status of one delegated task. */
export type SessionActivityStatus = 'running' | 'completed' | 'failed' | 'timeout'

/** One delegated-task activity row in the session-activity JSONL log. */
export interface SessionActivity {
  /** Target workspace session id. */
  readonly sessionId: string
  /** Workspace the session belongs to, when attached. */
  readonly workspaceId?: string
  /** Workspace display title, when attached. */
  readonly workspaceName?: string
  /** The delegated task text. */
  readonly task: string
  /** Task lifecycle status. */
  readonly status: SessionActivityStatus
  /** Result summary (from the awaited reply), when available. */
  readonly summary?: string
  /** Epoch ms when the task was delegated. */
  readonly startedAt: number
  /** Epoch ms when the task finished (completed/failed/timeout). */
  readonly completedAt?: number
}

/** Result of querying the session activity log. */
export interface SessionActivityResult {
  readonly activities: SessionActivity[]
  readonly complete: boolean
  readonly error?: string
}

/** Session-activity log file name under the main session cwd's `memory/` dir. */
export const SESSION_ACTIVITY_FILE = 'session-activity.jsonl'

/** Default limit for {@link SessionActivityResult.activities}. */
export const DEFAULT_ACTIVITY_LIMIT = 20

// ============================================================
// Task progress (per-task dispatch tracker)
// ============================================================

/** Lifecycle status of one subtask within a tracked task. */
export type SubtaskStatus = 'pending' | 'assigned' | 'running' | 'completed' | 'blocked' | 'cancelled'

/** One subtask row inside a {@link TaskProgress} record. */
export interface SubtaskProgress {
  /** Stable subtask id within the task (e.g. `s1`, or a short slug). */
  readonly id: string
  /** Short human-readable subtask title. */
  readonly title: string
  /** Current lifecycle status. */
  readonly status: SubtaskStatus
  /** Workspace session id the subtask was assigned to, once assigned. */
  readonly sessionId?: string
  /** Workspace display title the session belongs to, when attached. */
  readonly workspaceName?: string
  /** Result summary, filled when the subtask completes. */
  readonly summary?: string
}

/** One pending user confirmation inside a {@link TaskProgress} record. */
export interface PendingConfirmation {
  /** Stable confirmation id within the task. */
  readonly id: string
  /** The question put to the user. */
  readonly question: string
  /** Related subtask id, when the confirmation concerns one. */
  readonly subtaskId?: string
  /** Resolution state. */
  readonly status: 'open' | 'resolved'
  /** The user's answer, when resolved. */
  readonly resolution?: string
}

/** One durable task-progress record in the task-progress JSONL log. */
export interface TaskProgress {
  /** Stable task id (e.g. epoch-ms + short slug). */
  readonly taskId: string
  /** The user's original task description. */
  readonly description: string
  /** Epoch ms when the task was first tracked. */
  readonly createdAt: number
  /** Epoch ms of the last update. */
  readonly updatedAt: number
  /** Ordered subtask list. */
  readonly subtasks: readonly SubtaskProgress[]
  /** Pending user confirmations (open ones are reported to the user). */
  readonly pendingConfirmations: readonly PendingConfirmation[]
}

/** Result of updating (creating or mutating) a task-progress record. */
export interface TaskProgressUpdateResult {
  readonly success: boolean
  readonly task?: TaskProgress
  readonly error?: string
}

/** Result of querying task-progress records. */
export interface TaskProgressQueryResult {
  readonly tasks: TaskProgress[]
  readonly complete: boolean
  readonly error?: string
}

/** Task-progress log file name under the main session cwd's `memory/` dir. */
export const TASK_PROGRESS_FILE = 'task-progress.jsonl'

/** Default limit for {@link TaskProgressQueryResult.tasks}. */
export const DEFAULT_TASK_PROGRESS_LIMIT = 10

// ============================================================
// Constants
// ============================================================

/** Fixed session id for the system-level main session. */
export const MAIN_SESSION_ID = 'main-session'

/**
 * Working directory for the main session. A dedicated directory under the
 * DSH home — deliberately NOT the workspace root or any workspace path, so
 * the main session is never grouped under a workspace in the sidebar (it is
 * a system-level session, not a workspace session).
 */
export const MAIN_SESSION_CWD_NAME = 'main-session'

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
