import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TaskProgressStore } from '../src/main-session/task-progress.ts'

// ============================================================
// Test scaffolding
// ============================================================

const tempDirs: string[] = []

function makeStore(): { store: TaskProgressStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-task-progress-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'task-progress.jsonl')
  return { store: new TaskProgressStore({ filePath }), filePath }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ============================================================
// Tests
// ============================================================

describe('TaskProgressStore', () => {
  it('creates a task and queries it back', async () => {
    const { store } = makeStore()
    const result = await store.update({
      taskId: 'refactor-order',
      description: '重构订单模块',
      subtasks: [
        { id: 's1', title: '接口层', status: 'pending' },
        { id: 's2', title: '页面', status: 'pending' },
      ],
    })
    expect(result.success).toBe(true)
    expect(result.task?.taskId).toBe('refactor-order')
    expect(result.task?.subtasks).toHaveLength(2)
    expect(result.task?.createdAt).toBeGreaterThan(0)

    const q = await store.query('refactor-order')
    expect(q.complete).toBe(true)
    expect(q.tasks).toHaveLength(1)
    expect(q.tasks[0]!.subtasks[0]!.status).toBe('pending')
  })

  it('replaces the whole snapshot on update (newest per taskId wins)', async () => {
    const { store } = makeStore()
    await store.update({
      taskId: 't1',
      description: '任务',
      subtasks: [{ id: 's1', title: 'a', status: 'pending' }],
    })
    await store.update({
      taskId: 't1',
      description: '任务',
      subtasks: [
        { id: 's1', title: 'a', status: 'assigned', sessionId: 'sess-1', workspaceName: 'W' },
        { id: 's2', title: 'b', status: 'pending' },
      ],
    })
    const q = await store.query('t1')
    expect(q.tasks).toHaveLength(1)
    expect(q.tasks[0]!.subtasks).toHaveLength(2)
    expect(q.tasks[0]!.subtasks[0]!.status).toBe('assigned')
    expect(q.tasks[0]!.subtasks[0]!.sessionId).toBe('sess-1')
  })

  it('keeps createdAt stable across updates', async () => {
    const { store } = makeStore()
    const first = await store.update({ taskId: 't1', description: '任务', subtasks: [] })
    const createdAt = first.task!.createdAt
    await new Promise(resolve => setTimeout(resolve, 5))
    const second = await store.update({ taskId: 't1', description: '任务', subtasks: [{ id: 's1', title: 'a', status: 'running' }] })
    expect(second.task?.createdAt).toBe(createdAt)
    expect(second.task?.updatedAt).toBeGreaterThan(createdAt)
  })

  it('tracks pending confirmations and their resolution', async () => {
    const { store } = makeStore()
    await store.update({
      taskId: 't1',
      description: '任务',
      subtasks: [{ id: 's1', title: 'a', status: 'blocked' }],
      pendingConfirmations: [
        { id: 'c1', question: '选集成测试还是快照测试？', subtaskId: 's1', status: 'open' },
      ],
    })
    const q1 = await store.query('t1')
    expect(q1.tasks[0]!.pendingConfirmations).toHaveLength(1)
    expect(q1.tasks[0]!.pendingConfirmations[0]!.status).toBe('open')

    await store.update({
      taskId: 't1',
      description: '任务',
      subtasks: [{ id: 's1', title: 'a', status: 'completed', summary: '选了集成测试' }],
      pendingConfirmations: [
        { id: 'c1', question: '选集成测试还是快照测试？', subtaskId: 's1', status: 'resolved', resolution: '集成测试' },
      ],
    })
    const q2 = await store.query('t1')
    expect(q2.tasks[0]!.pendingConfirmations[0]!.status).toBe('resolved')
    expect(q2.tasks[0]!.pendingConfirmations[0]!.resolution).toBe('集成测试')
  })

  it('lists multiple tasks newest-first with a limit', async () => {
    const { store } = makeStore()
    await store.update({ taskId: 'a', description: '任务A', subtasks: [] })
    await new Promise(resolve => setTimeout(resolve, 5))
    await store.update({ taskId: 'b', description: '任务B', subtasks: [] })
    await store.update({ taskId: 'c', description: '任务C', subtasks: [] })

    const q = await store.query(undefined, 2)
    expect(q.tasks).toHaveLength(2)
    expect(q.tasks[0]!.taskId).toBe('c')
    expect(q.tasks[1]!.taskId).toBe('b')
  })

  it('rejects empty taskId and description', async () => {
    const { store } = makeStore()
    const noId = await store.update({ taskId: '  ', description: 'x', subtasks: [] })
    expect(noId.success).toBe(false)
    expect(noId.error).toMatch(/task id/)
    const noDesc = await store.update({ taskId: 't', description: '  ', subtasks: [] })
    expect(noDesc.success).toBe(false)
    expect(noDesc.error).toMatch(/description/)
  })

  it('summarizes subtask status and open confirmations', async () => {
    const { store } = makeStore()
    await store.update({
      taskId: 't1',
      description: '重构订单',
      subtasks: [
        { id: 's1', title: '接口层', status: 'completed', sessionId: 'sess-1', workspaceName: '项目A', summary: 'OK' },
        { id: 's2', title: '页面', status: 'blocked' },
      ],
      pendingConfirmations: [{ id: 'c1', question: '选哪套测试方案？', subtaskId: 's2', status: 'open' }],
    })
    const summary = await store.summarize()
    expect(summary.taskCount).toBe(1)
    expect(summary.text).toContain('重构订单')
    expect(summary.text).toContain('[completed] 接口层')
    expect(summary.text).toContain('待确认')
  })
})
