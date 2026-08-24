/**
 * main-session -- task progress store (per-task dispatch tracker)
 *
 * Owns the durable "task progress" log: one record per user task tracking its
 * subtask lifecycle and pending user confirmations, written as append-only
 * JSONL under the main session cwd (`memory/task-progress.jsonl`). Updating a
 * task appends a new full snapshot of that task; reads resolve the newest
 * snapshot per `taskId`, so each task has one current state while prior
 * snapshots stay on disk as provenance.
 *
 * Separate from the session-activity log: that one is a flat delegation
 * ledger keyed by target session (used to MATCH sessions), while this one is
 * keyed by user task and tracks the whole dispatch's progress (used to REPORT
 * progress and pending confirmations). Both live under `memory/`.
 */

import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  type PendingConfirmation,
  type SubtaskProgress,
  type TaskProgress,
  type TaskProgressQueryResult,
  type TaskProgressUpdateResult,
  DEFAULT_TASK_PROGRESS_LIMIT,
  LOG_TAG,
} from './types.ts'

/** Task-progress store constructor options. */
export interface TaskProgressStoreOptions {
  /** Absolute path to the task-progress JSONL log. */
  readonly filePath: string
}

/** One in-memory read of the log: all rows in file order. */
interface TaskProgressLogRow {
  readonly task: TaskProgress
  /** Line number in the file (1-based), used to keep file order stable. */
  readonly line: number
}

/** Input for one task-progress update (create or replace). */
export interface TaskProgressUpdateInput {
  /** Stable task id; created on first use. */
  taskId: string
  /** The user's original task description. */
  description: string
  /** Ordered subtask list (replaces the whole list on each update). */
  subtasks: readonly SubtaskProgress[]
  /** Pending confirmations (replaces the whole list on each update). */
  pendingConfirmations?: readonly PendingConfirmation[]
}

/**
 * The task-progress store. One instance per main-session plugin activation;
 * append/read without locks (append-only writes plus whole-file reads are
 * naturally safe). Newest snapshot per taskId wins on read.
 */
export class TaskProgressStore {
  private readonly filePath: string
  private readonly writeListeners = new Set<() => void>()

  constructor(options: TaskProgressStoreOptions) {
    this.filePath = options.filePath
  }

  /**
   * Subscribe to task-progress updates (fires after a successful append).
   * @param listener - callback invoked post-update.
   * @returns an unsubscribe function.
   */
  onWrite(listener: () => void): () => void {
    this.writeListeners.add(listener)
    return () => { this.writeListeners.delete(listener) }
  }

  /**
   * Create or replace one task's progress snapshot. Every update appends a
   * fresh full snapshot of the task; reads resolve the newest per taskId.
   * @param input - task id, description, and the full subtask + confirmation
   *   lists (they replace, not merge, so callers always pass the whole state).
   * @returns the stored snapshot, or an error when validation/IO fails.
   */
  async update(input: TaskProgressUpdateInput): Promise<TaskProgressUpdateResult> {
    const taskId = input.taskId.trim()
    const description = input.description.trim()
    if (taskId === '') return { success: false, error: 'task id must not be empty' }
    if (description === '') return { success: false, error: 'task description must not be empty' }

    const SUBTASK_STATUSES = new Set(['pending', 'assigned', 'running', 'completed', 'blocked', 'cancelled'])
    for (const subtask of input.subtasks) {
      if ((subtask.id ?? '').trim() === '') return { success: false, error: 'subtask id must not be empty' }
      if ((subtask.title ?? '').trim() === '') return { success: false, error: 'subtask title must not be empty' }
      if (!SUBTASK_STATUSES.has(subtask.status)) {
        return { success: false, error: `subtask "${subtask.id}" has invalid status "${subtask.status}"` }
      }
    }
    const confirmationStatuses = new Set(['open', 'resolved'])
    for (const confirmation of input.pendingConfirmations ?? []) {
      if ((confirmation.id ?? '').trim() === '') return { success: false, error: 'confirmation id must not be empty' }
      if ((confirmation.question ?? '').trim() === '') return { success: false, error: 'confirmation question must not be empty' }
      if (!confirmationStatuses.has(confirmation.status)) {
        return { success: false, error: `confirmation "${confirmation.id}" has invalid status "${confirmation.status}"` }
      }
    }

    const prior = await this.latest(taskId)
    const now = Date.now()
    const task: TaskProgress = {
      taskId,
      description,
      createdAt: prior?.createdAt ?? now,
      updatedAt: now,
      subtasks: input.subtasks.map(s => ({ ...s })),
      pendingConfirmations: (input.pendingConfirmations ?? []).map(c => ({ ...c })),
    }
    try {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      await appendFile(this.filePath, `${JSON.stringify(task)}\n`, { encoding: 'utf8' })
      for (const listener of this.writeListeners) {
        try {
          listener()
        } catch (err) {
          console.warn(`${LOG_TAG} task-progress write listener failed:`, err)
        }
      }
      return { success: true, task }
    } catch (err) {
      return { success: false, error: `task-progress update failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Query task records. Exact taskId when given (newest snapshot for that
   * task); otherwise all tasks newest-per-taskId, newest-first, limited to
   * `limit` (default {@link DEFAULT_TASK_PROGRESS_LIMIT}).
   * @param taskId - optional exact task id.
   * @param limit - optional result cap.
   * @returns matching tasks newest-first; `complete` false on failure.
   */
  async query(taskId?: string, limit: number = DEFAULT_TASK_PROGRESS_LIMIT): Promise<TaskProgressQueryResult> {
    try {
      const rows = await this.readAll()
      const byId = new Map<string, TaskProgress>()
      const lineOf = new Map<string, number>()
      for (const row of rows) {
        lineOf.set(row.task.taskId, row.line)
        const existing = byId.get(row.task.taskId)
        if (existing === undefined || row.task.updatedAt >= existing.updatedAt) {
          byId.set(row.task.taskId, row.task)
        }
      }
      let tasks = [...byId.values()]
      if (taskId !== undefined) {
        tasks = tasks.filter(task => task.taskId === taskId)
      }
      // Newest first; same-timestamp writes fall back to file order (later
      // line wins) so rapid consecutive updates stay deterministic.
      tasks.sort((a, b) => b.updatedAt - a.updatedAt || (lineOf.get(b.taskId) ?? 0) - (lineOf.get(a.taskId) ?? 0))
      return { tasks: tasks.slice(0, limit), complete: true }
    } catch (err) {
      return {
        tasks: [],
        complete: false,
        error: `task-progress query failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * Render the current task-progress overview into prompt-section text: the
   * most recently updated tasks with per-subtask status, so the model can
   * recall in-flight work without a tool call. Open confirmations are listed
   * first so the dispatcher remembers to surface them.
   * @returns the rendered overview; empty text when nothing is stored.
   */
  async summarize(): Promise<{ text: string; taskCount: number }> {
    try {
      const result = await this.query(undefined, DEFAULT_TASK_PROGRESS_LIMIT)
      if (result.tasks.length === 0) return { text: '', taskCount: 0 }
      const lines: string[] = []
      for (const task of result.tasks) {
        const subtaskLines = task.subtasks.map(s => {
          const where = s.sessionId === undefined ? '' : ` @${s.workspaceName ?? s.sessionId}`
          const summary = s.summary === undefined ? '' : `：${s.summary}`
          return `    - [${s.status}] ${s.title}${where}${summary}`
        })
        const open = task.pendingConfirmations.filter(c => c.status === 'open')
        const confirmLines = open.map(c => `    - ❓待确认：${c.question}`)
        lines.push(`- ${task.taskId}：${task.description}\n${[...confirmLines, ...subtaskLines].join('\n')}`)
      }
      return { text: lines.join('\n'), taskCount: result.tasks.length }
    } catch {
      return { text: '', taskCount: 0 }
    }
  }

  /** The newest stored snapshot for one taskId, or undefined when absent. */
  private async latest(taskId: string): Promise<TaskProgress | undefined> {
    const result = await this.query(taskId, 1)
    return result.tasks[0]
  }

  /** Read every row in file order; missing file yields an empty list. */
  private async readAll(): Promise<TaskProgressLogRow[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, { encoding: 'utf8' })
    } catch {
      return [] // no task progress yet
    }
    const rows: TaskProgressLogRow[] = []
    const lines = raw.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!.trim()
      if (line === '') continue
      try {
        rows.push({ task: JSON.parse(line) as TaskProgress, line: index + 1 })
      } catch {
        console.warn(`${LOG_TAG} skipping malformed task-progress line ${index + 1}`)
      }
    }
    return rows
  }
}
