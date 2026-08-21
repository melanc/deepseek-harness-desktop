/**
 * main-session -- session activity store (dispatch ledger)
 *
 * Owns the durable "session activity" log: one row per delegated task per
 * workspace session, written as append-only JSONL under the main session cwd
 * (`memory/session-activity.jsonl`). The main session consults it (via the
 * `session_activity` tool) to know what each workspace session was asked to
 * do and how it went, across restarts — the scheduling view that
 * `workspace_list_sessions` (current liveness) cannot provide.
 *
 * Each delegation appends a `running` row when dispatched and a terminal row
 * (`completed`/`failed`/`timeout`, carrying the result summary) when the
 * reply settles. Queries return newest-first with optional filters.
 */

import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  type SessionActivity,
  type SessionActivityResult,
  type SessionActivityStatus,
  DEFAULT_ACTIVITY_LIMIT,
  LOG_TAG,
} from './types.ts'

/** Session-activity store constructor options. */
export interface SessionActivityStoreOptions {
  /** Absolute path to the session-activity JSONL log. */
  readonly filePath: string
}

/** One in-memory read of the log: all rows in file order. */
interface ActivityLogRow {
  readonly activity: SessionActivity
  /** Line number in the file (1-based), used to keep file order stable. */
  readonly line: number
}

/**
 * The session activity store. One instance per main-session plugin
 * activation; append/read without locks (append-only writes plus whole-file
 * reads are naturally safe).
 */
export class SessionActivityStore {
  private readonly filePath: string

  constructor(options: SessionActivityStoreOptions) {
    this.filePath = options.filePath
  }

  /**
   * Append one activity row (a delegation start or its terminal result).
   * @param activity - the row to record; fields are used as given (trimmed).
   * @returns true on success; false (and a logged warning) on IO failure.
   */
  async append(activity: SessionActivity): Promise<boolean> {
    const row: SessionActivity = {
      ...activity,
      sessionId: activity.sessionId.trim(),
      task: activity.task.trim(),
    }
    if (row.sessionId === '' || row.task === '') return false
    try {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      await appendFile(this.filePath, `${JSON.stringify(row)}\n`, { encoding: 'utf8' })
      return true
    } catch (err) {
      console.warn(`${LOG_TAG} session activity append failed:`, err)
      return false
    }
  }

  /**
   * Record a delegation start. A convenience over {@link append} that fills
   * the running status and timestamp.
   * @param sessionId - target workspace session id.
   * @param task - delegated task text.
   * @param workspace - optional workspace id/title.
   */
  async recordStart(
    sessionId: string,
    task: string,
    workspace?: { id: string; name: string },
  ): Promise<void> {
    await this.append({
      sessionId,
      ...workspace === undefined ? {} : { workspaceId: workspace.id, workspaceName: workspace.name },
      task,
      status: 'running',
      startedAt: Date.now(),
    })
  }

  /**
   * Record a task's terminal state. A convenience over {@link append}.
   * @param sessionId - target workspace session id.
   * @param task - delegated task text.
   * @param status - terminal status.
   * @param summary - optional result summary.
   * @param workspace - optional workspace id/title.
   */
  async recordFinish(
    sessionId: string,
    task: string,
    status: Exclude<SessionActivityStatus, 'running'>,
    summary?: string,
    workspace?: { id: string; name: string },
  ): Promise<void> {
    await this.append({
      sessionId,
      ...workspace === undefined ? {} : { workspaceId: workspace.id, workspaceName: workspace.name },
      task,
      status,
      ...summary === undefined ? {} : { summary },
      startedAt: Date.now(),
      completedAt: Date.now(),
    })
  }

  /**
   * Query the activity log, newest-first.
   * @param options - optional filters and limit.
   * @returns matching activities; `complete` false on read failure.
   */
  async query(options: {
    sessionId?: string
    workspaceId?: string
    status?: SessionActivityStatus
    limit?: number
  } = {}): Promise<SessionActivityResult> {
    try {
      const rows = await this.readAll()
      const limit = options.limit ?? DEFAULT_ACTIVITY_LIMIT
      const filtered = rows
        .filter(row => options.sessionId === undefined || row.activity.sessionId === options.sessionId)
        .filter(row => options.workspaceId === undefined || row.activity.workspaceId === options.workspaceId)
        .filter(row => options.status === undefined || row.activity.status === options.status)
        .sort((a, b) => b.activity.startedAt - a.activity.startedAt || b.line - a.line)
        .slice(0, limit)
        .map(row => row.activity)
      return { activities: filtered, complete: true }
    } catch (err) {
      return {
        activities: [],
        complete: false,
        error: `session activity query failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * The newest still-running task text for a session, or undefined.
   * Used to attach the terminal row of an awaited reply to its delegation.
   * @param sessionId - target workspace session id.
   * @returns the newest `running` task text, or undefined.
   */
  async latestRunningTask(sessionId: string): Promise<string | undefined> {
    try {
      const rows = await this.readAll()
      const running = rows
        .filter(row => row.activity.sessionId === sessionId && row.activity.status === 'running')
        .sort((a, b) => b.activity.startedAt - a.activity.startedAt || b.line - a.line)[0]
      return running?.activity.task
    } catch {
      return undefined
    }
  }

  /** Read every row in file order; missing file yields an empty list. */
  private async readAll(): Promise<ActivityLogRow[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, { encoding: 'utf8' })
    } catch {
      return [] // no activity yet
    }
    const rows: ActivityLogRow[] = []
    const lines = raw.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!.trim()
      if (line === '') continue
      try {
        rows.push({ activity: JSON.parse(line) as SessionActivity, line: index + 1 })
      } catch {
        console.warn(`${LOG_TAG} skipping malformed session activity line ${index + 1}`)
      }
    }
    return rows
  }
}
