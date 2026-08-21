import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ProcedureStore } from '../src/main-session/procedure.ts'

// ============================================================
// Test scaffolding
// ============================================================

const tempDirs: string[] = []

function makeStore(): { store: ProcedureStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-procedure-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'procedures.jsonl')
  return { store: new ProcedureStore({ filePath }), filePath }
}

function sample(overrides: Partial<Parameters<ProcedureStore['save']>[0]> = {}) {
  return {
    key: 'order-refactor',
    name: '订单模块重构',
    trigger: '订单相关的改动任务',
    steps: ['梳理调用链', '定接口边界方案', '实现+自测', '跑全量测试'],
    output: '变更落盘工作区会话且测试通过',
    ...overrides,
  }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ============================================================
// Tests
// ============================================================

describe('ProcedureStore', () => {
  it('saves a procedure and recalls it by key', async () => {
    const { store } = makeStore()
    const saved = await store.save(sample())
    expect(saved.success).toBe(true)
    expect(saved.procedure).toMatchObject({
      key: 'order-refactor',
      name: '订单模块重构',
      runCount: 1,
    })

    const recalled = await store.recall('order-refactor')
    expect(recalled.complete).toBe(true)
    expect(recalled.procedures).toHaveLength(1)
    expect(recalled.procedures[0]!.steps).toEqual(['梳理调用链', '定接口边界方案', '实现+自测', '跑全量测试'])
  })

  it('rejects empty keys, names, triggers, steps, and outputs', async () => {
    const { store } = makeStore()
    expect((await store.save(sample({ key: '  ' }))).success).toBe(false)
    expect((await store.save(sample({ name: ' ' }))).success).toBe(false)
    expect((await store.save(sample({ trigger: '' }))).success).toBe(false)
    expect((await store.save(sample({ steps: [] }))).success).toBe(false)
    expect((await store.save(sample({ steps: ['  ', ''] }))).success).toBe(false)
    expect((await store.save(sample({ output: '  ' }))).success).toBe(false)
  })

  it('updates an existing procedure and bumps runCount (evolution)', async () => {
    const { store } = makeStore()
    await store.save(sample())
    const updated = await store.save(sample({
      steps: ['梳理调用链', '先写测试再实现', '跑全量测试'],
      pitfalls: ['改接口需同步支付回调'],
    }))

    expect(updated.success).toBe(true)
    expect(updated.procedure!.runCount).toBe(2)
    expect(updated.procedure!.steps).toEqual(['梳理调用链', '先写测试再实现', '跑全量测试'])
    expect(updated.procedure!.pitfalls).toEqual(['改接口需同步支付回调'])

    const recalled = await store.recall('order-refactor')
    expect(recalled.procedures).toHaveLength(1) // newest per key in reads
    expect(recalled.procedures[0]!.runCount).toBe(2)
  })

  it('matches by trigger/name query (scenario binding)', async () => {
    const { store } = makeStore()
    await store.save(sample())
    await store.save(sample({ key: 'release-cut', name: '发版流程', trigger: '准备发布版本' }))

    const byTrigger = await store.recall(undefined, '发布')
    expect(byTrigger.procedures.map(p => p.key)).toContain('release-cut')

    const byName = await store.recall(undefined, '订单')
    expect(byName.procedures.map(p => p.key)).toContain('order-refactor')

    expect((await store.recall(undefined, '不存在')).procedures).toHaveLength(0)
  })

  it('lists newest per key with run counts', async () => {
    const { store } = makeStore()
    await store.save(sample())
    await store.save(sample({ key: 'release-cut', name: '发版流程', trigger: '准备发布' }))

    const summary = await store.listSummary()
    expect(summary.count).toBe(2)
    expect(summary.text).toContain('order-refactor')
    expect(summary.text).toContain('已用 1 次')
    expect(summary.text).toContain('发版流程')
  })

  it('renders an empty list when nothing is stored', async () => {
    const { store } = makeStore()
    const summary = await store.listSummary()
    expect(summary.text).toBe('')
    expect(summary.count).toBe(0)
  })

  it('notifies write listeners after a successful save', async () => {
    const { store } = makeStore()
    let notified = 0
    const unsubscribe = store.onWrite(() => { notified += 1 })
    await store.save(sample())
    expect(notified).toBe(1)
    unsubscribe()
    await store.save(sample({ name: '改名' }))
    expect(notified).toBe(1)
  })
})
