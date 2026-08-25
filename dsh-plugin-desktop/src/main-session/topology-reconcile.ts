/**
 * Startup workspace-topology reconciliation.
 *
 * On desktop cold start the workspace registry can carry stale records and
 * loose sessions that surface in the sidebar as a bogus "未分组" (Ungrouped)
 * bucket:
 *
 * - **Invalid workspaces**: a workspace whose backing directory no longer
 *   exists (`status()` reports `missing-dir`). Its registration is removed;
 *   the directory and session logs are left untouched.
 * - **Stray sessions**: sessions that belong to no workspace and are not
 *   archived. They are archived, which hides them from every grouping view
 *   while keeping their logs and workspace accounting recoverable.
 *
 * Every step is best-effort and idempotent: failures are reported through the
 * logger and never block startup. The main session id is always exempt, as a
 * safety net even though the caller attaches it to its own workspace first.
 */

import { MAIN_SESSION_ID, LOG_TAG } from './types.ts'

/** Workspace view consumed by reconciliation (the registry entity). */
export interface ReconcileWorkspace {
  readonly id: string
  readonly sessionIds: readonly unknown[]
  status(): Promise<'ok' | 'missing-dir'>
}

/** Workspace registry surface consumed by reconciliation. */
export interface ReconcileWorkspaceRegistry {
  list(): ReconcileWorkspace[]
  delete(id: string): Promise<boolean>
  archiveSession(sessionId: unknown): Promise<void>
  readonly archivedSessionIds: readonly unknown[]
}

/** Optional structured logger; omitted in unit tests. */
export interface ReconcileLog {
  info(message: string): void
  warn(message: string, err?: unknown): void
}

/** Services the reconciliation reads through. */
export interface ReconcileDeps {
  workspaceRegistry: ReconcileWorkspaceRegistry
  /** Live agents (the runtime session list). */
  listLiveAgents(): Array<{ id: unknown }>
  /** Persisted sessions (cold sessions without a live agent). */
  listPersisted(): Promise<Array<{ id: unknown }>>
  log?: ReconcileLog
}

/** What the reconciliation changed. */
export interface ReconcileReport {
  /** Workspace registrations removed because their directory is missing. */
  removedWorkspaces: string[]
  /** Sessions archived because they were stray. */
  archivedSessions: string[]
}

const logOf = (log: ReconcileLog | undefined): ReconcileLog => log ?? {
  info: () => {},
  warn: () => {},
}

/**
 * Remove invalid workspaces and archive stray sessions.
 * @param deps - Registry plus live/persisted session enumeration.
 * @returns the ids that were removed or archived.
 */
export async function reconcileWorkspaceTopology(deps: ReconcileDeps): Promise<ReconcileReport> {
  const log = logOf(deps.log)
  const report: ReconcileReport = { removedWorkspaces: [], archivedSessions: [] }

  // 1. Remove workspaces whose backing directory no longer exists.
  for (const workspace of deps.workspaceRegistry.list()) {
    try {
      if (await workspace.status() === 'missing-dir') {
        await deps.workspaceRegistry.delete(workspace.id)
        report.removedWorkspaces.push(workspace.id)
        log.info(`${LOG_TAG} topology reconcile: removed workspace "${workspace.id}" (missing directory)`)
      }
    } catch (err) {
      log.warn(`${LOG_TAG} topology reconcile: workspace "${workspace.id}" check/delete failed`, err)
    }
  }

  // 2. Archive sessions that belong to no workspace and are not archived.
  const accounted = new Set<string>()
  for (const workspace of deps.workspaceRegistry.list()) {
    for (const id of workspace.sessionIds) accounted.add(String(id))
  }
  const archived = new Set(deps.workspaceRegistry.archivedSessionIds.map((id) => String(id)))

  const known = new Set<string>()
  for (const agent of deps.listLiveAgents()) known.add(String(agent.id))
  try {
    for (const row of await deps.listPersisted()) known.add(String(row.id))
  } catch (err) {
    log.warn(`${LOG_TAG} topology reconcile: persisted session listing failed`, err)
  }
  // The main session is attached to its own workspace by the caller; exempt it
  // regardless so a race can never archive the system session.
  known.delete(MAIN_SESSION_ID)

  for (const id of known) {
    if (accounted.has(id) || archived.has(id)) continue
    try {
      await deps.workspaceRegistry.archiveSession(id)
      report.archivedSessions.push(id)
      log.info(`${LOG_TAG} topology reconcile: archived stray session "${id}"`)
    } catch (err) {
      log.warn(`${LOG_TAG} topology reconcile: archive of stray session "${id}" failed`, err)
    }
  }

  return report
}
