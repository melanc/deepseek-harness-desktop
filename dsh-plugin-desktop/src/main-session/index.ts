/**
 * main-session -- Host plugin
 *
 * Provides the system-level main session and its orchestration surface
 * (`ctx.mainSession` service + three main-agent-scoped tools).
 *
 * - **Main agent**: lazily created (or resumed) as a root agent with the
 *   fixed id `main-session`, through the registered agent factory. It is a
 *   normal DSH agent (own session, loop, persistence) but is system-level:
 *   not attached to any workspace.
 * - **Orchestration**: the main agent gets `workspace_list_sessions`,
 *   `workspace_send_message`, `workspace_await_reply` tools scoped to its
 *   own agent context, so only it can manage workspace sessions.
 * - **Deps**: resolved dynamically through `ctx.get(...)` (the DSH service
 *   type declarations are not published, so desktop plugins use the
 *   dynamic accessor pattern like `desktop-shell`).
 *
 * Composition: requires the host to have mounted `agents`, `sessions`,
 * `workspaceRegistry`, `sessionQuery` (all part of the upstream base).
 */

import { type Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'node:crypto'
import { mkdir, realpath } from 'node:fs/promises'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { installModelSelection, type ModelSelection, type ModelSelectionRef } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionTitleInvalidError } from '@deepseek-ai/dsh-session-title'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { MAIN_SESSION_ID, MAIN_SESSION_CWD_NAME, MAIN_SESSION_PLUGIN, USER_FACTS_FILE, PROCEDURES_FILE, SESSION_ACTIVITY_FILE, TASK_PROGRESS_FILE, LOG_TAG } from './types.ts'
import { UserMemoryStore } from './memory.ts'
import { registerUserMemorySection } from './memory-persona.ts'
import { registerMemoryTools } from './memory-tools.ts'
import { ProcedureStore } from './procedure.ts'
import { registerProcedureSection } from './procedure-persona.ts'
import { registerProcedureTools } from './procedure-tools.ts'
import { SessionActivityStore } from './activity.ts'
import { registerActivityTools } from './activity-tools.ts'
import { TaskProgressStore } from './task-progress.ts'
import { registerTaskProgressSection } from './task-progress-persona.ts'
import { registerTaskProgressTools } from './task-progress-tools.ts'
import { MainSessionService, sessionIdOf, deriveSessionTitle } from './service.ts'
import { registerMainSessionTools } from './tools.ts'
import { registerMainSessionPersona } from './persona.ts'
import { resolveDefaultWorkspacePath } from './workspace-path.ts'
import { handleSessionEvent, buildNotificationMessage, type TurnEndEvent, type CompletionSessionView } from './completion-callback.ts'
import { reconcileWorkspaceTopology } from './topology-reconcile.ts'

/** Stable Cordis plugin name. */
export const name = 'main-session'

/** Services required from the host (dynamic access for untyped services). */
export const inject = ['agents', 'sessions']

// ============================================================
// Untyped service accessors
// ============================================================

interface AgentsRegistry {
  get(sessionId: unknown): Agent | undefined
  list(): Agent[]
  create(options: Record<string, unknown>): Promise<AgentHandle>
  resume(options: Record<string, unknown>): Promise<AgentHandle>
}

interface SessionPersistence {
  list(): Promise<Array<{ id: unknown; cwd?: string }>>
}

interface AgentPresetsService {
  resolve(id?: string): Promise<{ id: string }>
  mount(agentCtx: Context, id: string): Promise<unknown>
}

interface AgentDefaultModelService {
  currentSelection(): ModelSelection
}

interface SessionsStore {
  get(sessionId: unknown): { header: { createdAt: number } } | undefined
}

interface WorkspaceRegistry {
  list(): WorkspaceEntity[]
  resolveByPath?(path: string): Promise<{ id: string; title: string; path?: string } | undefined>
  create(path: string, title?: string): Promise<WorkspaceEntity>
  delete(id: string): Promise<boolean>
  archiveSession(sessionId: unknown): Promise<void>
  readonly archivedSessionIds: readonly unknown[]
}

/** A workspace record returned by {@link WorkspaceRegistry.create} or {@link WorkspaceRegistry.list}. */
interface WorkspaceEntity {
  id: string
  title: string
  path?: string
  sessionIds: readonly unknown[]
  status(): Promise<'ok' | 'missing-dir'>
  attachSession(sessionId: unknown): Promise<void>
}

interface SessionQueryEngine {
  readTitle(sessionId: unknown, signal?: AbortSignal): Promise<{ title?: string } | undefined>
}

// ============================================================
// Host-facing service surface
// ============================================================

export interface MainSessionServiceSurface {
  /** Create/resume the main agent on demand. */
  ensureMainAgent(): Promise<AgentHandle>
  /** Whether the main agent is currently live. */
  isMainAgentLive(): boolean
  /** Enumerate workspace + ungrouped sessions. */
  listSessions(): Promise<ReturnType<MainSessionService['listSessions']>>
  /** Send a message to a target session. */
  sendMessage(sessionId: string, message: string): ReturnType<MainSessionService['sendMessage']>
  /** Wait for a target session reply. */
  awaitReply(
    sessionId: string,
    options?: { timeoutMs?: number; afterSeq?: number; maxReplyChars?: number },
  ): Promise<ReturnType<MainSessionService['awaitReply']>>
  /** Create a workspace session and optionally dispatch a task to it. */
  createWorkspaceSession(options: {
    workspacePath?: string
    workspaceTitle?: string
    task?: string
    sessionId?: string
  }): Promise<ReturnType<MainSessionService['createWorkspaceSession']>>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** System-level main session orchestration. */
    mainSession: MainSessionServiceSurface
  }
}

// ============================================================
// Service implementation
// ============================================================

export class MainSessionServiceHost extends Service implements MainSessionServiceSurface {
  private readonly inner: MainSessionService

  constructor(ctx: Context, inner: MainSessionService) {
    super(ctx, 'mainSession')
    this.inner = inner
  }

  async ensureMainAgent(): Promise<AgentHandle> {
    return this.inner.getMainAgent()
  }

  isMainAgentLive(): boolean {
    return this.inner.isMainAgentLive()
  }

  async listSessions(): Promise<ReturnType<MainSessionService['listSessions']>> {
    return this.inner.listSessions()
  }

  sendMessage(
    sessionId: string,
    message: string,
  ): ReturnType<MainSessionService['sendMessage']> {
    return this.inner.sendMessage(sessionId, message)
  }

  async awaitReply(
    sessionId: string,
    options?: { timeoutMs?: number; afterSeq?: number; maxReplyChars?: number },
  ): Promise<ReturnType<MainSessionService['awaitReply']>> {
    return this.inner.awaitReply(sessionId, options)
  }

  async createWorkspaceSession(options: {
    workspacePath?: string
    workspaceTitle?: string
    task?: string
    sessionId?: string
  }): Promise<ReturnType<MainSessionService['createWorkspaceSession']>> {
    return this.inner.createWorkspaceSession(options)
  }
}

// ============================================================
// Plugin entry
// ============================================================

export function apply(ctx: Context): void {
  const agents = ctx.get('agents') as unknown as AgentsRegistry
  const sessions = ctx.get('sessions') as unknown as SessionsStore
  const sessionQuery = ctx.get('sessionQuery') as unknown as SessionQueryEngine | undefined
  // The session-title service is resolved lazily (like the workspace registry):
  // it may not be published when apply runs, and rename must observe the live
  // service. Absent → rename reports `unavailable`.
  const resolveSessionTitle = (): { rename(session: unknown, title: string): { title: string; eventSeq: number } } | undefined =>
    ctx.get('sessionTitle') as unknown as { rename(session: unknown, title: string): { title: string; eventSeq: number } } | undefined
  // The workspace registry is resolved lazily inside ensureMainAgent (not
  // captured at apply time): the workspace service may not be published yet
  // when this plugin's apply runs, and attach must observe the latest state.
  const resolveWorkspaceRegistry = (): WorkspaceRegistry | undefined =>
    ctx.get('workspaceRegistry') as unknown as WorkspaceRegistry | undefined

  // User memory store: durable user facts under the main session cwd. The
  // store mkdirs its own directory on first write, so no cwd resolution is
  // needed here.
  const memoryStore = new UserMemoryStore({
    filePath: dshHomePath(MAIN_SESSION_CWD_NAME, 'memory', USER_FACTS_FILE),
  })

  // Procedure memory store: reusable multi-step SOPs, same directory.
  const procedureStore = new ProcedureStore({
    filePath: dshHomePath(MAIN_SESSION_CWD_NAME, 'memory', PROCEDURES_FILE),
  })

  // Session activity store: dispatch ledger (what each workspace session was
  // asked to do and how it went), same directory.
  const activityStore = new SessionActivityStore({
    filePath: dshHomePath(MAIN_SESSION_CWD_NAME, 'memory', SESSION_ACTIVITY_FILE),
  })

  // Task progress store: per-user-task dispatch tracker (subtask lifecycle +
  // pending confirmations), same directory.
  const taskProgressStore = new TaskProgressStore({
    filePath: dshHomePath(MAIN_SESSION_CWD_NAME, 'memory', TASK_PROGRESS_FILE),
  })

  // ── Main agent lifecycle (lazy) ─────────────────────────────────────────
  let handle: AgentHandle | undefined
  let ensuring: Promise<AgentHandle> | undefined

  const ensureMainAgent = async (): Promise<AgentHandle> => {
    if (handle !== undefined) return handle
    ensuring ??= (async () => {
      // Resolve the dedicated system cwd first (always, so an existing stale
      // session can be re-anchored to the correct directory).
      let cwd = dshHomePath(MAIN_SESSION_CWD_NAME)
      try {
        await mkdir(cwd, { recursive: true })
        cwd = await realpath(cwd)
      } catch (err) {
        console.warn(`${LOG_TAG} main session cwd unavailable, creating main session without cwd:`, err)
        cwd = ''
      }

      const mainSessionId = sessionIdOf(MAIN_SESSION_ID)
      const existing = agents.get(mainSessionId)
      let created: AgentHandle
      if (existing !== undefined) {
        // Reuse the live main agent. If it is anchored to a stale cwd (e.g.
        // an earlier build pointed it at the workspace root), re-anchor it to
        // the dedicated directory via the workspace registry.
        console.log(`${LOG_TAG} reusing live main agent (cwd=${existing.session?.header?.cwd ?? 'n/a'})`)
        created = { agent: existing, dispose: async () => {} } as AgentHandle
      } else {
        // Same scoped composition for both paths: the orchestrator tools and
        // persona, plus (best-effort) the deployment's default agent preset so
        // model-facing rows resolve against a real composition instead of the
        // empty global layer. The model selection is installed exactly like the
        // web host's `installSelection`: it binds the default provider/model
        // into prompt assembly (`{{model}}`/`{{provider}}` variables) and into
        // each request, so the standard preset's persona resolves.
        const selection = createMainSelection(ctx)
        const setup = async (agentCtx: Context): Promise<void> => {
          try {
            registerMainSessionTools(agentCtx, innerService)
            registerUserMemorySection(agentCtx, memoryStore)
            registerMemoryTools(agentCtx, memoryStore)
            registerProcedureSection(agentCtx, procedureStore)
            registerProcedureTools(agentCtx, procedureStore)
            registerActivityTools(agentCtx, activityStore)
            registerTaskProgressSection(agentCtx, taskProgressStore)
            registerTaskProgressTools(agentCtx, taskProgressStore)
            registerMainSessionPersona(agentCtx)
            installModelSelection(agentCtx, selection)
            const toolsRuntime = agentCtx.get('tools') as
              | { schemas(scope?: unknown): Array<{ name: string }> }
              | undefined
            const visible = toolsRuntime?.schemas(agentCtx.agent)
            ctx.logger.info(
              `${LOG_TAG} main agent setup complete; visible tools: ${
                visible === undefined ? 'n/a' : visible.map(tool => tool.name).join(',')
              }`,
            )
            await joinDefaultAgentPreset(ctx, agentCtx)
          } catch (err) {
            ctx.logger.warn(`${LOG_TAG} main agent setup failed: ${String(err)}`)
            throw err
          }
        }
        const selected = selection.current
        const agentOptions = selected === undefined ? {} : { ...selected }
        const persisted = await isMainSessionPersisted(ctx)
        created = persisted
          ? await agents.resume({
            resumeSessionId: mainSessionId,
            agentOptions,
            setup,
          })
          : await agents.create({
            sessionId: mainSessionId,
            meta: cwd === '' ? {} : { cwd },
            agentOptions,
            setup,
          })
      }

      // Register the main session's cwd as a dedicated system workspace and
      // attach the main session to it. This keeps the main session from
      // landing in "未分组" and lets the conversation view open it without
      // requiring a workspace pick (the workspace is always this one).
      if (cwd !== '') {
        const workspaceRegistry = resolveWorkspaceRegistry()
        if (workspaceRegistry === undefined) {
          ctx.logger.warn(`${LOG_TAG} workspace registry unavailable, main session stays ungrouped`)
        } else {
          try {
            const ws = await workspaceRegistry.create(cwd, '主会话')
            await ws.attachSession(sessionIdOf(MAIN_SESSION_ID))
            ctx.logger.info(`${LOG_TAG} attached main session to system workspace "${ws.id}"`)
          } catch (err) {
            ctx.logger.warn(`${LOG_TAG} main session workspace attach failed: ${String(err)}`)
          }
        }
      }

      // A never-started session is "blank": the workspace browser hides blank
      // sessions (only the currently opened one is shown), so a fresh main
      // session would not appear under its workspace. Kick off one real turn
      // so `turn/start` lands and the main session stays visible and
      // resumable from its workspace entry.
      void kickstartMainSessionIfBlank(ctx, created.agent)

      handle = created
      return created
    })()
    return ensuring
  }

  // ── Inner service ───────────────────────────────────────────────────────
  const innerService = new MainSessionService({
    ensureAgent: ensureMainAgent,
    getAgent: (id) => agents.get(sessionIdOf(id)),
    listLiveAgents: () => agents.list(),
    recordActivityStart: (sessionId, task, workspace) => {
      void activityStore.recordStart(sessionId, task, workspace)
    },
    recordActivityFinish: (sessionId, task, status, summary, workspace) => {
      void activityStore.recordFinish(sessionId, task, status, summary, workspace)
    },
    taskTextOf: (sessionId) => activityStore.latestRunningTask(sessionId),
    listWorkspaceSessionIds: () => {
      const workspaceRegistry = resolveWorkspaceRegistry()
      if (workspaceRegistry === undefined) return []
      try {
        const ids: string[] = []
        for (const ws of workspaceRegistry.list()) {
          for (const sessionId of ws.sessionIds) ids.push(String(sessionId))
        }
        return ids
      } catch (err) {
        console.error(`${LOG_TAG} workspace registry enumeration failed:`, err)
        return []
      }
    },
    workspaceOf: (id) => {
      const workspaceRegistry = resolveWorkspaceRegistry()
      if (workspaceRegistry === undefined) return undefined
      try {
        for (const ws of workspaceRegistry.list()) {
          if (ws.sessionIds.includes(sessionIdOf(id))) {
            return { id: ws.id, name: ws.title }
          }
        }
      } catch {
        // Ignore — best effort.
      }
      return undefined
    },
    titleOf: async (id) => {
      if (sessionQuery === undefined) return undefined
      try {
        const snapshot = await sessionQuery.readTitle(sessionIdOf(id))
        return snapshot?.title
      } catch {
        return undefined
      }
    },
    renameSession: (id, title) => {
      const titles = resolveSessionTitle()
      if (titles === undefined) {
        return { success: false, code: 'unavailable', error: 'session title service is not available' }
      }
      const agent = agents.get(sessionIdOf(id))
      if (agent === undefined) {
        return { success: false, code: 'no-live-agent', error: `Session ${id} has no live agent (is it open in a workspace?)` }
      }
      try {
        const accepted = titles.rename(agent.session, title)
        return { success: true, title: accepted.title, seq: accepted.eventSeq }
      } catch (error: unknown) {
        if (error instanceof SessionTitleInvalidError) {
          return { success: false, code: 'title-invalid', error: error.message }
        }
        return { success: false, code: 'internal', error: error instanceof Error ? error.message : String(error) }
      }
    },
    lastActiveOf: (id) => sessions.get(sessionIdOf(id))?.header.createdAt,
    messageCountOf: (id) => {
      const session = sessions.get(sessionIdOf(id)) as
        | { deriveMessages(): unknown[] }
        | undefined
      if (session === undefined) return 0
      try {
        return session.deriveMessages().length
      } catch {
        return 0
      }
    },
    createWorkspaceSession: async (options) => {
      const workspaceRegistry = resolveWorkspaceRegistry()
      if (workspaceRegistry === undefined) {
        return { sessionId: '', error: 'workspaceRegistry is not available' }
      }
      // 0. Resolve the workspace directory: explicit path, or create a
      //    folder under the DSH default workspace root.
      let workspacePath: string
      try {
        workspacePath = options.workspacePath !== undefined
          ? options.workspacePath
          : await resolveDefaultWorkspacePath(options.workspaceTitle)
      } catch (err) {
        return {
          sessionId: '',
          error: `workspace directory resolve failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }

      // 0.5 Guard against duplicate workspace creation. The host registry
      // matches workspaces by exact canonical path and its create() is already
      // idempotent for an exact match, so an exact match is fine to reuse.
      // What must be blocked: (a) a sub-directory of an existing workspace
      // (e.g. .../kt_repos/watcher when kt_repos owns .../kt_repos), which
      // would silently register a second workspace; (b) a brand-new path whose
      // title collides with an existing workspace.
      if (options.workspacePath !== undefined) {
        const existing = workspaceRegistry.list()
        const exact = existing.find(w => w.path !== undefined && w.path === options.workspacePath)
        // Exact path match → reuse via create()'s idempotency; no guard needed.
        if (exact === undefined) {
          const parent = existing.find(w => w.path !== undefined && isPathWithinOrEqual(options.workspacePath!, w.path!))
          if (parent !== undefined) {
            return {
              sessionId: '',
              error: `workspace path "${options.workspacePath}" is inside existing workspace "${parent.title}" (${parent.id}); reuse it instead of creating a sub-directory workspace`,
            }
          }
          if (options.workspaceTitle !== undefined) {
            const byTitle = existing.find(w => w.title === options.workspaceTitle)
            if (byTitle !== undefined) {
              return {
                sessionId: '',
                error: `a workspace titled "${options.workspaceTitle}" already exists (${byTitle.id}); pass its workspacePath to reuse it, or use a different title`,
              }
            }
          }
        }
      } else if (options.workspaceTitle !== undefined) {
        const byTitle = workspaceRegistry.list().find(w => w.title === options.workspaceTitle)
        if (byTitle !== undefined) {
          return {
            sessionId: '',
            error: `a workspace titled "${options.workspaceTitle}" already exists (${byTitle.id}); pass its workspacePath to reuse it, or use a different title`,
          }
        }
      }

      // 1. Ensure the workspace exists (idempotent).
      let ws: WorkspaceEntity
      try {
        ws = await workspaceRegistry.create(workspacePath, options.workspaceTitle)
      } catch (err) {
        return {
          sessionId: '',
          error: `workspace create failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }

      // 2. Create the workspace session agent rooted at the workspace path.
      const newSessionId = options.sessionId ?? `ws-session-${randomUUID()}`
      try {
        // Inject the deployment default model selection exactly like the main
        // agent does: `agentOptions` feeds `{{model}}`/`{{provider}}` prompt
        // variables (`agent.options.model`), and `installModelSelection` binds
        // the same selection into prompt assembly and request routing. Without
        // both, a workspace session created here fails prompt assembly with
        // `prompt variable "{{model}}" has no value`.
        const selection = createMainSelection(ctx)
        const selected = selection.current
        const agentOptions = selected === undefined ? {} : { ...selected }
        const created = await agents.create({
          sessionId: sessionIdOf(newSessionId),
          meta: { cwd: workspacePath },
          agentOptions,
          setup: async (agentCtx: Context) => {
            installModelSelection(agentCtx, selection)
            // Join the deployment default preset so the workspace session
            // gets the standard tool set (bash/read/glob/grep/edit/write/…).
            // Without this the session only sees the global layer, which in a
            // Web profile contains just the host-registered agent_teams_* tools.
            await joinDefaultAgentPreset(ctx, agentCtx)
          },
        })
        // 3. Attach to the workspace (validates header cwd against the path).
        await ws.attachSession(sessionIdOf(newSessionId))
        // 3.5 Name the session so the sidebar shows its work content instead of
        //     a blank "new session". Explicit sessionTitle wins; otherwise the
        //     task's first line is used. Best-effort: a missing title service or
        //     an invalid title never fails the create.
        const title = deriveSessionTitle(options.sessionTitle, options.task)
        if (title !== undefined) {
          const titleAgent = agents.get(sessionIdOf(newSessionId))
          const titles = resolveSessionTitle()
          if (titleAgent !== undefined && titles !== undefined) {
            try {
              titles.rename(titleAgent.session, title)
            } catch (err) {
              ctx.logger.warn(`${LOG_TAG} workspace session "${newSessionId}" title failed:`, err)
            }
          }
        }
        // 4. Dispatch the initial task, if any.
        if (options.task !== undefined && options.task.trim() !== '') {
          const agent = agents.get(sessionIdOf(newSessionId))
          if (agent !== undefined) {
            agent.followup(createUserMessage({
              content: [{ type: 'text', text: options.task }],
              source: { kind: 'plugin', plugin: 'main-session' },
            }))
          }
        }
        void created
        return { sessionId: newSessionId, workspaceId: ws.id }
      } catch (err) {
        return {
          sessionId: '',
          error: `workspace session create failed: ${err instanceof Error ? err.message : String(err)}`,
        }
      }
    },
  })

  // ── Workspace completion callback ────────────────────────────────────────
  // The "push" half of the dispatch flow: when a workspace session's turn
  // actually ends, react once — record the terminal ledger row and inject a
  // one-line summary into the main session, which reports it and says nothing
  // else. This replaces the polling `workspace_await_reply` loop, so the
  // main session no longer wakes mid-execution to ask "are you done yet?".
  ctx.effect(() => {
    const stop = ctx.on('session/event', (session, event) => {
      const sessionId = String(session.header.id)
      if (sessionId === '') return
      void handleSessionEvent(
        event as TurnEndEvent,
        sessionId,
        session as CompletionSessionView,
        {
          isMainSession: (id) => id === MAIN_SESSION_ID,
          latestRunningTask: (id) => activityStore.latestRunningTask(id),
          workspaceOf: (id) => {
            const workspaceRegistry = resolveWorkspaceRegistry()
            if (workspaceRegistry === undefined) return undefined
            try {
              for (const ws of workspaceRegistry.list()) {
                if (ws.sessionIds.includes(sessionIdOf(id))) {
                  return { id: ws.id, name: ws.title }
                }
              }
            } catch { /* best effort */ }
            return undefined
          },
          recordFinish: (id, task, status, summary, workspace) => {
            void activityStore.recordFinish(id, task, status, summary, workspace)
          },
          notifyMainSession: (message) => {
            try {
              const mainAgent = agents.get(sessionIdOf(MAIN_SESSION_ID))
              if (mainAgent === undefined) {
                ctx.logger.warn(`${LOG_TAG} completion callback: main agent not live, dropping notification`)
                return
              }
              mainAgent.followup(buildNotificationMessage(message))
            } catch (err) {
              ctx.logger.warn(`${LOG_TAG} completion callback followup failed:`, err)
            }
          },
        },
      ).then((report) => {
        if (report !== null) {
          ctx.logger.info(`${LOG_TAG} completion callback reported ${report.sessionId}: ${report.status}`)
        }
      }).catch((err) => {
        ctx.logger.warn(`${LOG_TAG} completion callback failed:`, err)
      })
    })
    return stop
  }, 'main-session: workspace completion callback')

  // ── Startup topology reconciliation ─────────────────────────────────────
  // After the main session is attached to its own workspace, drop invalid
  // workspaces (missing directories) and archive stray sessions so the sidebar
  // never shows a "未分组" bucket at cold start. Best-effort: failures log and
  // never block startup, and the main session id is always exempt.
  const reconcileStartupTopology = async (): Promise<void> => {
    const workspaceRegistry = resolveWorkspaceRegistry()
    if (workspaceRegistry === undefined) {
      ctx.logger.warn(`${LOG_TAG} topology reconcile skipped: workspace registry unavailable`)
      return
    }
    const persistence = ctx.get('sessionPersistence') as unknown as SessionPersistence | undefined
    const report = await reconcileWorkspaceTopology({
      workspaceRegistry,
      listLiveAgents: () => agents.list(),
      listPersisted: async () => persistence === undefined ? [] : await persistence.list(),
      log: {
        info: (message) => ctx.logger.info(message),
        warn: (message, err) => ctx.logger.warn(message, err),
      },
    })
    if (report.removedWorkspaces.length > 0 || report.archivedSessions.length > 0) {
      ctx.logger.info(`${LOG_TAG} topology reconcile done: ${report.removedWorkspaces.length} workspace(s) removed, ${report.archivedSessions.length} session(s) archived`)
    }
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  ctx.effect(() => {
    // Create the main agent at activation so the sidebar entry always has a
    // live session to open (failures are logged, never block startup).
    void innerService.getMainAgent().then(() => {
      // Main session is attached to its workspace; now reconcile the topology.
      return reconcileStartupTopology().catch((err) => {
        ctx.logger.warn(`${LOG_TAG} topology reconcile failed:`, err)
      })
    }).catch((err) => {
      console.error(`${LOG_TAG} main agent activation failed:`, err)
    })
    return () => {
      void innerService.disposeMainAgent().catch(() => {})
    }
  }, 'main-session: agent lifecycle')

  // ── Host-facing service ─────────────────────────────────────────────────
  ctx.plugin(MainSessionServiceHost, innerService)
}

// Re-export for consumers.
export type { AgentHandle } from '@deepseek-ai/dsh-agent'
export { MAIN_SESSION_ID } from './types.ts'
export { MainSessionService, sessionIdOf } from './service.ts'
export { registerMainSessionTools } from './tools.ts'
export { registerMainSessionPersona } from './persona.ts'
export { DEFAULT_WORKSPACES_ROOT, resolveDefaultWorkspacePath } from './workspace-path.ts'

// ============================================================
// Helpers
// ============================================================

/**
 * Whether a session with the main session's id is already persisted.
 *
 * `agents.create` builds a fresh session with an empty seed; when a persisted
 * log already exists for the id, the persistence backend rejects the fresh
 * session (its seed cannot cover the stored prefix) and the main session is
 * published live but never written — which also breaks `attachSession` (the
 * workspace registry reads the header from persistence). A persisted session
 * must be opened with `agents.resume`, which loads the log and reconstructs
 * the seed so adoption succeeds. This mirrors the web host's cold-resume path.
 * @param ctx - host context (for the optional `sessionPersistence` service).
 * @returns true when a persisted log for `main-session` exists; false when
 *   persistence is absent, listing fails, or the id is genuinely new.
 */
async function isMainSessionPersisted(ctx: Context): Promise<boolean> {
  const persistence = ctx.get('sessionPersistence') as unknown as SessionPersistence | undefined
  if (persistence === undefined) return false
  try {
    const rows = await persistence.list()
    return rows.some(row => String(row.id) === MAIN_SESSION_ID)
  } catch (err) {
    console.warn(`${LOG_TAG} session persistence list failed, creating main session fresh:`, err)
    return false
  }
}

/**
 * Build the main session's model selection ref from the deployment default
 * (`agentDefaultModel`), detached from the settings source. Mirrors the web
 * host's `selectionFor`: `installModelSelection` reads `current` at each
 * prompt assembly, so a default saved later reaches the main session's next
 * turn without a restart.
 * @param ctx - host context (for the optional `agentDefaultModel` service).
 * @returns the selection ref; `current` stays undefined when the service is
 *   absent (the main session then runs on agent defaults).
 */
function createMainSelection(ctx: Context): ModelSelectionRef {
  const service = ctx.get('agentDefaultModel') as unknown as AgentDefaultModelService | undefined
  return {
    get current(): ModelSelection | undefined {
      return service?.currentSelection()
    },
    assembled: undefined,
  }
}

/**
 * Best-effort join of the deployment's default agent preset in the main
 * agent's setup. The web host composes every agent through
 * `AgentPresets.mount()`; without it the main session's tools, prompt
 * sections, and skill catalog resolve against the empty global layer (the
 * `agent-presets` warning). Never rejects: the main session keeps its own
 * tools and persona even when the roster is absent or the mount fails.
 * @param hostCtx - host context (for the optional `agentPresets` service).
 * @param agentCtx - the main agent's scoped setup context.
 */
async function joinDefaultAgentPreset(hostCtx: Context, agentCtx: Context): Promise<void> {
  const presets = hostCtx.get('agentPresets') as unknown as AgentPresetsService | undefined
  if (presets === undefined) return
  try {
    const preset = await presets.resolve()
    await presets.mount(agentCtx, preset.id)
  } catch (err) {
    console.warn(`${LOG_TAG} main session default agent preset join failed (running on the global layer):`, err)
  }
}

/**
 * Start one real turn on the main agent when its session has never run one.
 *
 * A session with no `turn/start` event is "blank". The workspace browser
 * hides blank sessions (only the currently opened one shows), so a fresh
 * main session would never appear under its workspace entry — it would look
 * like the workspace is empty. Sending one initialization followup makes the
 * driver start a turn, which persists `turn/start`; from then on the main
 * session is a normal, always-visible session. Fire-and-forget: the turn
 * runs in the background, and a model failure still leaves the session
 * non-blank (the turn record lands with the driver start).
 * @param hostCtx - host context (used only for diagnostics).
 * @param agent - the freshly created/resumed main agent.
 */
function kickstartMainSessionIfBlank(hostCtx: Context, agent: Agent): void {
  const events = agent.session?.events
  if (events !== undefined && events.some(event => event.type === 'turn/start')) return
  try {
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: '（系统初始化）主会话已就绪，等待你的任务。' }],
      source: { kind: 'plugin', plugin: MAIN_SESSION_PLUGIN },
    }))
    hostCtx.logger.info(`${LOG_TAG} kickstarted main session (blank → first turn)`)
  } catch (err) {
    hostCtx.logger.warn(`${LOG_TAG} main session kickstart failed: ${String(err)}`)
  }
}

/**
 * Whether `candidate` equals `parent` or lives strictly inside it, using a
 * path-segment-aware prefix comparison (so `/a/bc` is not treated as inside
 * `/a/b`). Paths are normalized to forward slashes before comparing so both
 * POSIX and Windows-style spellings behave predictably.
 */
function isPathWithinOrEqual(candidate: string, parent: string): boolean {
  const norm = (p: string): string => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const c = norm(candidate)
  const p = norm(parent)
  if (c === p) return true
  return c.startsWith(`${p}/`)
}
