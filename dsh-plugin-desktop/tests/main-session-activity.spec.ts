import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SessionActivityStore } from '../src/main-session/activity.ts'

// ============================================================
// Test scaffolding
// ============================================================

const tempDirs: string[] = []

function makeStore(): { store: SessionActivityStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-activity-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'session-activity.jsonl')
  return { store: new SessionActivityStore({ filePath }), filePath }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ============================================================
// Tests
// ============================================================

describe('SessionActivityStore', () => {
  it('records a start and a finish, and queries newest-first', async () => {
    const { store } = makeStore()
    await store.recordStart('session-1', '重构订单模块', { id: 'ws-9', name: '项目A' })
    await store.recordFinish('session-1', '重构订单模块', 'completed', '接口层完成，测试通过', { id: 'ws-9', name: '项目A' })

    const all = await store.query()
    expect(all.complete).toBe(true)
    expect(all.activities).toHaveLength(2)
    expect(all.activities[0]!.status).toBe('completed')
    expect(all.activities[0]!.summary).toBe('接口层完成，测试通过')
    expect(all.activities[1]!.status).toBe('running')
    expect(all.activities[1]!.workspaceName).toBe('项目A')
  })

  it('filters by session, workspace, and status', async () => {
    const { store } = makeStore()
    await store.recordStart('session-1', '任务一', { id: 'ws-1', name: 'A' })
    await store.recordStart('session-2', '任务二', { id: 'ws-2', name: 'B' })
    await store.recordFinish('session-1', '任务一', 'completed', '完成', { id: 'ws-1', name: 'A' })

    const bySession = await store.query({ sessionId: 'session-2' })
    expect(bySession.activities).toHaveLength(1)
    expect(bySession.activities[0]!.task).toBe('任务二')

    const byWorkspace = await store.query({ workspaceId: 'ws-1' })
    expect(byWorkspace.activities).toHaveLength(2)

    const byStatus = await store.query({ status: 'completed' })
    expect(byStatus.activities).toHaveLength(1)
    expect(byStatus.activities[0]!.sessionId).toBe('session-1')
  })

  it('applies the query limit', async () => {
    const { store } = makeStore()
    for (let i = 0; i < 5; i += 1) await store.recordStart(`session-${i}`, `任务${i}`)
    const limited = await store.query({ limit: 2 })
    expect(limited.activities).toHaveLength(2)
    const all = await store.query({ limit: 10 })
    expect(all.activities).toHaveLength(5)
  })

  it('resolves the newest running task for a session', async () => {
    const { store } = makeStore()
    await store.recordStart('session-1', '任务一')
    await store.recordStart('session-1', '任务二')
    await store.recordFinish('session-1', '任务二', 'completed')
    await store.recordStart('session-1', '任务三')

    expect(await store.latestRunningTask('session-1')).toBe('任务三')
    expect(await store.latestRunningTask('session-9')).toBeUndefined()
  })

  it('rejects empty session/task rows', async () => {
    const { store } = makeStore()
    expect(await store.append({ sessionId: ' ', task: 'x', status: 'running', startedAt: 1 })).toBe(false)
    expect(await store.append({ sessionId: 's', task: ' ', status: 'running', startedAt: 1 })).toBe(false)
  })

  it('returns an empty result when nothing is stored', async () => {
    const { store } = makeStore()
    const result = await store.query()
    expect(result.complete).toBe(true)
    expect(result.activities).toHaveLength(0)
  })
})
