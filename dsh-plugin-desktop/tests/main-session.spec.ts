import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { MainSessionService, type MainSessionDeps } from '../src/main-session/service.ts'
import { MAIN_SESSION_ID } from '../src/main-session/types.ts'

// ============================================================
// Test doubles
// ============================================================

function fakeAgent(
  id: string,
  events: unknown[] = [],
  messages: unknown[] = [],
): Agent {
  return {
    id: id as never,
    session: {
      seq: events.length,
      events,
      deriveMessages: () => messages,
    },
  } as unknown as Agent
}

function fakeHandle(agent: Agent): AgentHandle {
  return {
    agent,
    dispose: async () => {},
  } as AgentHandle
}

function deps(overrides: Partial<MainSessionDeps> = {}): MainSessionDeps {
  return {
    ensureAgent: async () => fakeHandle(fakeAgent(MAIN_SESSION_ID)),
    getAgent: () => undefined,
    listLiveAgents: () => [],
    listWorkspaceSessionIds: () => [],
    workspaceOf: () => undefined,
    titleOf: async () => undefined,
    lastActiveOf: () => undefined,
    messageCountOf: () => 0,
    createWorkspaceSession: async (options) => ({
      sessionId: options.sessionId ?? 'ws-session-new',
      workspaceId: 'ws-1',
    }),
    ...overrides,
  }
}

// ============================================================
// Tests
// ============================================================

describe('MainSessionService', () => {
  it('enumerates workspace sessions with titles and liveness', async () => {
    const service = new MainSessionService(deps({
      listWorkspaceSessionIds: () => ['ws-1', 'ws-2'],
      workspaceOf: (id) => id === 'ws-1'
        ? { id: 'ws-1', name: '项目 A' }
        : { id: 'ws-2', name: '项目 B' },
      titleOf: async (id) => id === 'ws-1' ? '重构模块' : undefined,
      lastActiveOf: (id) => id === 'ws-1' ? 1000 : undefined,
      messageCountOf: () => 5,
      getAgent: (id) => id === 'ws-1' ? fakeAgent('ws-1') : undefined,
      listLiveAgents: () => [fakeAgent('ws-1'), fakeAgent('main-session')],
    }))

    const result = await service.listSessions()
    expect(result.sessions).toHaveLength(2)
    expect(result.sessions[0]!).toMatchObject({
      sessionId: 'ws-1',
      workspaceName: '项目 A',
      title: '重构模块',
      live: true,
      lastActiveAt: 1000,
      messageCount: 5,
    })
    expect(result.sessions[1]!).toMatchObject({
      sessionId: 'ws-2',
      live: false,
    })
    expect('title' in result.sessions[1]!).toBe(false)
    // main-session is excluded from ungrouped.
    expect(result.ungrouped).toHaveLength(0)
  })

  it('reports ungrouped live sessions excluding the main session', async () => {
    const service = new MainSessionService(deps({
      listLiveAgents: () => [
        fakeAgent('main-session'),
        fakeAgent('adhoc-1'),
      ],
      titleOf: async () => '临时会话',
    }))

    const result = await service.listSessions()
    expect(result.ungrouped).toHaveLength(1)
    expect(result.ungrouped[0]!).toMatchObject({ sessionId: 'adhoc-1', live: true })
  })

  it('sendMessage fails when the target has no live agent', () => {
    const service = new MainSessionService(deps({ getAgent: () => undefined }))
    const result = service.sendMessage('missing', 'hello')
    expect(result.success).toBe(false)
    expect(result.error).toContain('no live agent')
  })

  it('sendMessage injects via followup when the target is live', () => {
    const followup = vi.fn()
    const agent = {
      id: 'ws-1',
      followup,
    } as unknown as Agent
    const service = new MainSessionService(deps({ getAgent: (id) => id === 'ws-1' ? agent : undefined }))

    const result = service.sendMessage('ws-1', '请完成任务')
    expect(result.success).toBe(true)
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]![0] as { content: Array<{ type: string; text: string }>; source: { kind: string; plugin: string } }
    expect(message.content[0]!).toMatchObject({ type: 'text', text: '请完成任务' })
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'main-session' })
  })

  it('awaitReply returns the newest assistant text after the injection seq', async () => {
    const assistantEvent = { type: 'assistant/message', seq: 10 }
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'in' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]
    const agent = fakeAgent('ws-1', [assistantEvent], messages)
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
    }))

    // afterSeq = 5 (before the assistant event at seq 10).
    const result = await service.awaitReply('ws-1', { afterSeq: 5, timeoutMs: 2000 })
    expect(result.timedOut).toBe(false)
    expect(result.summary).toBe('done')
  })

  it('awaitReply summarizes long replies and includes workspace info', async () => {
    const longText = 'x'.repeat(2000)
    const assistantEvent = { type: 'assistant/message', seq: 10 }
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'in' }] },
      { role: 'assistant', content: [{ type: 'text', text: longText }] },
    ]
    const agent = fakeAgent('ws-1', [assistantEvent], messages)
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
      workspaceOf: () => ({ id: 'ws-1', name: '项目 A' }),
    }))

    const result = await service.awaitReply('ws-1', {
      afterSeq: 5,
      timeoutMs: 2000,
      maxReplyChars: 100,
    })
    expect(result.timedOut).toBe(false)
    expect(result.summary!.length).toBeLessThanOrEqual(100 + 20)
    expect(result.summary).toContain('完整结果见工作区会话')
    expect(result.workspaceId).toBe('ws-1')
    expect(result.workspaceName).toBe('项目 A')
  })

  it('awaitReply times out when no new assistant message appears', async () => {
    const agent = fakeAgent('ws-1', [], [])
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
    }))

    const result = await service.awaitReply('ws-1', { afterSeq: 0, timeoutMs: 50 })
    expect(result.timedOut).toBe(true)
    expect(result.summary).toBeUndefined()
  })

  it('awaitReply reports awaitingApproval when the session has an unanswered approval ask', async () => {
    const agent = fakeAgent('ws-1', [
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
    ], [])
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
    }))

    const result = await service.awaitReply('ws-1', { afterSeq: 0, timeoutMs: 50 })
    expect(result.timedOut).toBe(true)
    expect(result.awaitingApproval).toBe('bash')
  })

  it('awaitReply omits awaitingApproval when every approval ask is decided', async () => {
    const agent = fakeAgent('ws-1', [
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
      { type: 'approval/decided', data: { id: 'a1' } },
    ], [])
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
    }))

    const result = await service.awaitReply('ws-1', { afterSeq: 0, timeoutMs: 50 })
    expect(result.timedOut).toBe(true)
    expect(result.awaitingApproval).toBeUndefined()
  })

  it('awaitReply reports the newest unanswered ask when several asks interleave', async () => {
    const agent = fakeAgent('ws-1', [
      { type: 'approval/asked', data: { id: 'a1', toolName: 'bash' } },
      { type: 'approval/decided', data: { id: 'a1' } },
      { type: 'approval/asked', data: { id: 'a2', toolName: 'write' } },
    ], [])
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
    }))

    const result = await service.awaitReply('ws-1', { afterSeq: 0, timeoutMs: 50 })
    expect(result.timedOut).toBe(true)
    expect(result.awaitingApproval).toBe('write')
  })

  it('awaitReply reports an error for a missing live agent', async () => {
    const service = new MainSessionService(deps({ getAgent: () => undefined }))
    const result = await service.awaitReply('missing')
    expect(result.error).toContain('no live agent')
  })

  it('ensures the main agent once and reuses the handle', async () => {
    const handle = fakeHandle(fakeAgent(MAIN_SESSION_ID))
    const ensureAgent = vi.fn(async () => handle)
    const service = new MainSessionService(deps({ ensureAgent }))

    const a = await service.getMainAgent()
    const b = await service.getMainAgent()
    expect(a).toBe(handle)
    expect(b).toBe(handle)
    expect(ensureAgent).toHaveBeenCalledTimes(1)
  })

  it('isMainAgentLive reflects registry liveness', () => {
    const service = new MainSessionService(deps({
      getAgent: (id) => id === MAIN_SESSION_ID ? fakeAgent(MAIN_SESSION_ID) : undefined,
    }))
    expect(service.isMainAgentLive()).toBe(true)
  })

  it('creates a workspace session and returns its id and workspace', async () => {
    const createWorkspaceSession = vi.fn(async () => ({
      sessionId: 'ws-session-abc',
      workspaceId: 'ws-9',
    }))
    const service = new MainSessionService(deps({ createWorkspaceSession }))

    const result = await service.createWorkspaceSession({
      workspacePath: '/workspaces/proj-a',
      workspaceTitle: '项目 A',
      task: '完成重构',
    })
    expect(result.success).toBe(true)
    expect(result.sessionId).toBe('ws-session-abc')
    expect(result.workspaceId).toBe('ws-9')
    expect(createWorkspaceSession).toHaveBeenCalledWith({
      workspacePath: '/workspaces/proj-a',
      workspaceTitle: '项目 A',
      task: '完成重构',
    })
  })

  it('surfaces createWorkspaceSession failures', async () => {
    const service = new MainSessionService(deps({
      createWorkspaceSession: async () => ({
        sessionId: '',
        error: 'workspace create failed: boom',
      }),
    }))

    const result = await service.createWorkspaceSession({ workspacePath: '/x' })
    expect(result.success).toBe(false)
    expect(result.error).toContain('boom')
  })
})
