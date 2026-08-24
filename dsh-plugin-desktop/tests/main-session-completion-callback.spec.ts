import { describe, expect, it, vi } from 'vitest'
import {
  handleSessionEvent,
  renderReportNotification,
  readNewestAssistantText,
  buildNotificationMessage,
  type CompletionCallbackDeps,
  type CompletionSessionView,
} from '../src/main-session/completion-callback.ts'

// ============================================================
// Test doubles
// ============================================================

function sessionView(assistantText?: string): CompletionSessionView {
  return {
    events: [{ type: 'turn/end', seq: 10 }],
    deriveMessages: () => assistantText === undefined
      ? []
      : [{ role: 'assistant', content: [{ type: 'text', text: assistantText }] }],
  }
}

function deps(overrides: Partial<CompletionCallbackDeps> = {}): CompletionCallbackDeps {
  return {
    isMainSession: (id) => id === 'main-session',
    latestRunningTask: async () => '请完成任务',
    workspaceOf: () => undefined,
    recordFinish: () => {},
    notifyMainSession: () => {},
    ...overrides,
  }
}

// ============================================================
// Tests
// ============================================================

describe('handleSessionEvent', () => {
  it('ignores non-turn/end events', async () => {
    const notify = vi.fn()
    const result = await handleSessionEvent(
      { type: 'assistant/message' },
      'ws-1',
      sessionView('done'),
      deps({ notifyMainSession: notify }),
    )
    expect(result).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores the main session own turn ending', async () => {
    const notify = vi.fn()
    const result = await handleSessionEvent(
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
      'main-session',
      sessionView('done'),
      deps({ notifyMainSession: notify }),
    )
    expect(result).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('ignores a workspace session with no running delegation', async () => {
    const notify = vi.fn()
    const result = await handleSessionEvent(
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
      'ws-1',
      sessionView('done'),
      deps({ latestRunningTask: async () => undefined, notifyMainSession: notify }),
    )
    expect(result).toBeNull()
    expect(notify).not.toHaveBeenCalled()
  })

  it('reports a completed delegation and notifies the main session once', async () => {
    const notify = vi.fn()
    const recordFinish = vi.fn()
    const workspaceOf = vi.fn(() => ({ id: 'ws-1', name: '项目 A' }))
    const result = await handleSessionEvent(
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
      'ws-1',
      sessionView('改造完成，编译通过'),
      deps({ notifyMainSession: notify, recordFinish, workspaceOf }),
    )

    expect(result).toEqual({
      sessionId: 'ws-1',
      task: '请完成任务',
      status: 'completed',
      summary: '改造完成，编译通过',
    })
    expect(recordFinish).toHaveBeenCalledWith(
      'ws-1',
      '请完成任务',
      'completed',
      '改造完成，编译通过',
      { id: 'ws-1', name: '项目 A' },
    )
    expect(notify).toHaveBeenCalledTimes(1)
    const notification = notify.mock.calls[0]![0] as string
    expect(notification).toContain('项目 A')
    expect(notification).toContain('改造完成，编译通过')
    expect(notification).toContain('简洁汇报')
  })

  it('reports a failure when the turn ends with no assistant reply', async () => {
    const notify = vi.fn()
    const result = await handleSessionEvent(
      { type: 'turn/end', data: { reason: { kind: 'error' } } },
      'ws-1',
      sessionView(undefined),
      deps({ notifyMainSession: notify }),
    )
    expect(result).toEqual({
      sessionId: 'ws-1',
      task: '请完成任务',
      status: 'failed',
    })
    expect(notify).toHaveBeenCalledTimes(1)
  })

  it('summarizes over-long assistant text', async () => {
    const long = 'x'.repeat(2000)
    const result = await handleSessionEvent(
      { type: 'turn/end', data: { reason: { kind: 'completed' } } },
      'ws-1',
      sessionView(long),
      deps(),
    )
    expect(result!.summary!.length).toBeLessThan(long.length)
    expect(result!.summary).toContain('完整结果见工作区会话')
  })
})

describe('readNewestAssistantText', () => {
  it('returns the newest assistant text', () => {
    const session = {
      events: [],
      deriveMessages: () => [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
      ],
    } as CompletionSessionView
    expect(readNewestAssistantText(session)).toBe('hello')
  })

  it('returns null when there is no assistant text', () => {
    const session = {
      events: [],
      deriveMessages: () => [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    } as CompletionSessionView
    expect(readNewestAssistantText(session)).toBeNull()
  })
})

describe('renderReportNotification', () => {
  it('includes workspace name and session id when available', () => {
    const text = renderReportNotification({
      sessionId: 'ws-1',
      task: '重构',
      status: 'completed',
      summary: 'done',
      workspace: { id: 'ws-1', name: '项目 A' },
    })
    expect(text).toContain('项目 A')
    expect(text).toContain('ws-1')
    expect(text).toContain('重构')
    expect(text).toContain('done')
  })

  it('falls back to the raw session id without workspace info', () => {
    const text = renderReportNotification({
      sessionId: 'ws-1',
      status: 'failed',
    })
    expect(text).toContain('ws-1')
    expect(text).toContain('执行失败')
  })
})

describe('buildNotificationMessage', () => {
  it('builds a plugin-sourced user message', () => {
    const message = buildNotificationMessage('hi') as {
      role: string
      content: Array<{ type: string; text: string }>
      source: { kind: string; plugin: string }
    }
    expect(message.role).toBe('user')
    expect(message.content[0]).toMatchObject({ type: 'text', text: 'hi' })
    expect(message.source).toMatchObject({ kind: 'plugin', plugin: 'main-session' })
  })
})
