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
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { MAIN_SESSION_ID, LOG_TAG } from './types.ts'
import { MainSessionService, sessionIdOf } from './service.ts'
import { registerMainSessionTools } from './tools.ts'
import { registerMainSessionPersona } from './persona.ts'
import { DEFAULT_WORKSPACES_ROOT, resolveDefaultWorkspacePath } from './workspace-path.ts'

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
}

interface SessionsStore {
  get(sessionId: unknown): { header: { createdAt: number } } | undefined
}

interface WorkspaceRegistry {
  list(): Array<{ id: string; title: string; sessionIds: unknown[] }>
  create(path: string, title?: string): Promise<{ id: string; title: string }>
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
  const workspaceRegistry = ctx.get('workspaceRegistry') as unknown as WorkspaceRegistry | undefined
  const sessionQuery = ctx.get('sessionQuery') as unknown as SessionQueryEngine | undefined

  // ── Main agent lifecycle (lazy) ─────────────────────────────────────────
  let handle: AgentHandle | undefined
  let ensuring: Promise<AgentHandle> | undefined

  const ensureMainAgent = async (): Promise<AgentHandle> => {
    if (handle !== undefined) return handle
    ensuring ??= (async () => {
      const existing = agents.get(sessionIdOf(MAIN_SESSION_ID))
      if (existing !== undefined) {
        return { agent: existing, dispose: async () => {} } as AgentHandle
      }
      // Give the main session a cwd (the DSH default workspace root) so it
      // is discoverable in session.list and persisted like any session.
      let cwd = DEFAULT_WORKSPACES_ROOT
      try {
        await mkdir(cwd, { recursive: true })
        cwd = await realpath(cwd)
      } catch (err) {
        console.warn(`${LOG_TAG} default workspace root unavailable, creating main session without cwd:`, err)
        cwd = ''
      }
      const created = await agents.create({
        sessionId: sessionIdOf(MAIN_SESSION_ID),
        meta: cwd === '' ? {} : { cwd },
        agentOptions: {},
        setup: (agentCtx: Context) => {
          registerMainSessionTools(agentCtx, innerService)
          registerMainSessionPersona(agentCtx)
        },
      })
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
    listWorkspaceSessionIds: () => {
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

      // 1. Ensure the workspace exists (idempotent).
      let ws: { id: string }
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
        const created = await agents.create({
          sessionId: sessionIdOf(newSessionId),
          meta: { cwd: workspacePath },
          agentOptions: {},
          setup: () => {
            // Workspace sessions are ordinary agents; no special tools.
          },
        })
        // 3. Attach to the workspace (validates header cwd against the path).
        await workspaceRegistry.attachSession(sessionIdOf(newSessionId))
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

  // ── Lifecycle ───────────────────────────────────────────────────────────
  ctx.effect(() => {
    // Create the main agent at activation so the sidebar entry always has a
    // live session to open (failures are logged, never block startup).
    void innerService.getMainAgent().catch((err) => {
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
