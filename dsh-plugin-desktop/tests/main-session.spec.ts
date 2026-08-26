import { describe, expect, it, vi } from 'vitest'
import type { Agent, AgentHandle } from '@deepseek-ai/dsh-agent'
import { MainSessionService, deriveSessionTitle, type MainSessionDeps } from '../src/main-session/service.ts'
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
    resumeSession: async () => false,
    listLiveAgents: () => [],
    listWorkspaceSessionIds: () => [],
    workspaceOf: () => undefined,
    titleOf: async () => undefined,
    cwdOf: () => undefined,
    lastActiveOf: () => undefined,
    messageCountOf: () => 0,
    createWorkspaceSession: async (options) => ({
      sessionId: options.sessionId ?? 'ws-session-new',
      workspaceId: 'ws-1',
    }),
    renameSession: () => ({ success: false, code: 'unavailable', error: 'no renameSession injected' }),
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
      cwdOf: (id) => id === 'ws-1' ? '/Users/tal/go/src/dev_repos/deepseek-harness-desktop' : undefined,
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
      cwd: '/Users/tal/go/src/dev_repos/deepseek-harness-desktop',
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
    expect('cwd' in result.sessions[1]!).toBe(false)
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

  it('sendMessage fails when the target has no live agent and cannot be resumed', async () => {
    const service = new MainSessionService(deps({ getAgent: () => undefined, resumeSession: async () => false }))
    const result = await service.sendMessage('missing', 'hello')
    expect(result.success).toBe(false)
    expect(result.error).toContain('no live agent')
  })

  it('sendMessage resumes then injects when the target is not live but resumable', async () => {
    const followup = vi.fn()
    const agent = { id: 'ws-1', followup } as unknown as Agent
    let live = false
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' && live ? agent : undefined,
      resumeSession: async () => { live = true; return true },
    }))

    const result = await service.sendMessage('ws-1', '请完成任务')
    expect(result.success).toBe(true)
    expect(followup).toHaveBeenCalledTimes(1)
  })

  it('sendMessage injects via followup when the target is live', async () => {
    const followup = vi.fn()
    const agent = {
      id: 'ws-1',
      followup,
    } as unknown as Agent
    const service = new MainSessionService(deps({ getAgent: (id) => id === 'ws-1' ? agent : undefined }))

    const result = await service.sendMessage('ws-1', '请完成任务')
    expect(result.success).toBe(true)
    expect(followup).toHaveBeenCalledTimes(1)
    const message = followup.mock.calls[0]![0] as { content: Array<{ type: string; text: string }>; source: { kind: string; plugin: string } }
    expect(message.content[0]!).toMatchObject({ type: 'text', text: '请完成任务' })
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'main-session' })
  })

  it('awaitReply returns the final assistant text once the turn ends', async () => {
    const events = [
      { type: 'assistant/message', seq: 8 },
      { type: 'turn/end', seq: 10, data: { reason: { kind: 'completed' } } },
    ]
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'in' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'done' }] },
    ]
    const agent = fakeAgent('ws-1', events, messages)
    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
    }))

    // afterSeq = 5 (before both the assistant message and turn/end).
    const result = await service.awaitReply('ws-1', { afterSeq: 5, timeoutMs: 2000 })
    expect(result.timedOut).toBe(false)
    expect(result.summary).toBe('done')
  })

  it('awaitReply waits for turn/end, not the first intermediate assistant message', async () => {
    const events = [
      { type: 'assistant/message', seq: 8 },
      { type: 'turn/end', seq: 10, data: { reason: { kind: 'completed' } } },
    ]
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'in' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'final result' }] },
    ]
    const agent = fakeAgent('ws-1', events, messages)
    // With no turn/end visible yet, the wait must not settle on the
    // intermediate assistant message: it settles only after turn/end lands.
    const noTurnEnd = fakeAgent('ws-1', [{ type: 'assistant/message', seq: 8 }], messages)
    const serviceNoEnd = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? noTurnEnd : undefined,
    }))
    const timeout = await serviceNoEnd.awaitReply('ws-1', { afterSeq: 5, timeoutMs: 50 })
    expect(timeout.timedOut).toBe(true)
    expect(timeout.summary).toBeUndefined()

    const service = new MainSessionService(deps({
      getAgent: (id) => id === 'ws-1' ? agent : undefined,
    }))
    const result = await service.awaitReply('ws-1', { afterSeq: 5, timeoutMs: 2000 })
    expect(result.timedOut).toBe(false)
    expect(result.summary).toBe('final result')
  })

  it('awaitReply summarizes long replies and includes workspace info', async () => {
    const longText = 'x'.repeat(2000)
    const events = [
      { type: 'assistant/message', seq: 8 },
      { type: 'turn/end', seq: 10, data: { reason: { kind: 'completed' } } },
    ]
    const messages = [
      { role: 'user', content: [{ type: 'text', text: 'in' }] },
      { role: 'assistant', content: [{ type: 'text', text: longText }] },
    ]
    const agent = fakeAgent('ws-1', events, messages)
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

  it('awaitReply times out when no turn/end appears', async () => {
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

  it('renameSession delegates to the injected rename and returns title + seq', () => {
    const agent = fakeAgent('ws-1')
    const renameSession = vi.fn(() => ({ success: true, title: '重构模块', seq: 42 }))
    const service = new MainSessionService(deps({ getAgent: (id) => id === 'ws-1' ? agent : undefined, renameSession }))

    const result = service.renameSession('ws-1', '  重构模块  ')
    expect(result.success).toBe(true)
    expect(result.title).toBe('重构模块')
    expect(result.seq).toBe(42)
    expect(renameSession).toHaveBeenCalledWith('ws-1', '  重构模块  ')
  })

  it('renameSession reports no-live-agent before delegating', () => {
    const renameSession = vi.fn()
    const service = new MainSessionService(deps({ getAgent: () => undefined, renameSession }))

    const result = service.renameSession('missing', 'x')
    expect(result.success).toBe(false)
    expect(result.code).toBe('no-live-agent')
    expect(renameSession).not.toHaveBeenCalled()
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
      sessionTitle: '重构订单模块',
    })
    expect(result.success).toBe(true)
    expect(result.sessionId).toBe('ws-session-abc')
    expect(result.workspaceId).toBe('ws-9')
    expect(createWorkspaceSession).toHaveBeenCalledWith({
      workspacePath: '/workspaces/proj-a',
      workspaceTitle: '项目 A',
      task: '完成重构',
      sessionTitle: '重构订单模块',
    })
  })

  it('omits sessionTitle from the deps call when it is not provided', async () => {
    const createWorkspaceSession = vi.fn(async () => ({
      sessionId: 'ws-session-abc',
      workspaceId: 'ws-9',
    }))
    const service = new MainSessionService(deps({ createWorkspaceSession }))

    await service.createWorkspaceSession({ workspacePath: '/x', task: '完成重构' })
    expect(createWorkspaceSession).toHaveBeenCalledWith({
      workspacePath: '/x',
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

// ============================================================
// deriveSessionTitle
// ============================================================

describe('deriveSessionTitle', () => {
  it('prefers an explicit sessionTitle over the task', () => {
    expect(deriveSessionTitle('重构订单模块', '请完成重构')).toBe('重构订单模块')
  })

  it('falls back to the first line of the task, whitespace-collapsed', () => {
    expect(deriveSessionTitle(undefined, '重构订单模块\n第二行')).toBe('重构订单模块')
  })

  it('trims surrounding whitespace and collapses inner whitespace', () => {
    expect(deriveSessionTitle(undefined, '  重构   订单  \nnext')).toBe('重构 订单')
  })

  it('truncates an over-long first line to the character budget', () => {
    const long = 'x'.repeat(100)
    expect(deriveSessionTitle(undefined, long)).toHaveLength(60)
  })

  it('returns undefined when neither source has visible text', () => {
    expect(deriveSessionTitle(undefined, undefined)).toBeUndefined()
    expect(deriveSessionTitle('   ', undefined)).toBeUndefined()
    expect(deriveSessionTitle(undefined, '   \n  ')).toBeUndefined()
  })

  it('returns the explicit title even when the task is empty', () => {
    expect(deriveSessionTitle('只改标题', undefined)).toBe('只改标题')
  })
})
