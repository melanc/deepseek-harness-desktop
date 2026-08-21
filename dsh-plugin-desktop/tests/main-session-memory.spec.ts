import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UserMemoryStore } from '../src/main-session/memory.ts'

// ============================================================
// Test scaffolding
// ============================================================

const tempDirs: string[] = []

function makeStore(): { store: UserMemoryStore; filePath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-memory-'))
  tempDirs.push(dir)
  const filePath = join(dir, 'user-facts.jsonl')
  return { store: new UserMemoryStore({ filePath }), filePath }
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

// ============================================================
// Tests
// ============================================================

describe('UserMemoryStore', () => {
  it('writes a fact and reads it back', async () => {
    const { store } = makeStore()
    const written = await store.write('profile', 'name', '张三')
    expect(written.success).toBe(true)
    expect(written.fact).toMatchObject({ type: 'profile', key: 'name', value: '张三' })

    const read = await store.read()
    expect(read.complete).toBe(true)
    expect(read.facts).toHaveLength(1)
    expect(read.facts[0]).toMatchObject({ type: 'profile', key: 'name', value: '张三' })
  })

  it('rejects empty keys and values', async () => {
    const { store } = makeStore()
    expect((await store.write('profile', '  ', 'v')).success).toBe(false)
    expect((await store.write('profile', 'k', '  ')).success).toBe(false)
  })

  it('keeps both rows when the same key is rewritten (history preserved)', async () => {
    const { store } = makeStore()
    await store.write('decision', 'api-arch', '方案 A')
    await store.write('decision', 'api-arch', '方案 B')
    const read = await store.read('decision', 'api-arch')
    expect(read.facts).toHaveLength(2)
    // Newest first.
    expect(read.facts[0]!.value).toBe('方案 B')
    expect(read.facts[1]!.value).toBe('方案 A')
  })

  it('filters by kind and by key', async () => {
    const { store } = makeStore()
    await store.write('profile', 'name', '张三')
    await store.write('preference', 'reply-style', '先给结论')
    await store.write('background', 'projects', 'dev_repos 桌面端')

    expect((await store.read('profile')).facts).toHaveLength(1)
    expect((await store.read(undefined, 'reply-style')).facts[0]!.value).toBe('先给结论')
    expect((await store.read('decision')).facts).toHaveLength(0)
  })

  it('searches by substring across keys, values, and provenance', async () => {
    const { store } = makeStore()
    await store.write('decision', 'api-arch', '订单模块 API 用 A 方案', '2026-08-20 委派')
    await store.write('preference', 'reply-style', '先给结论')

    const byValue = await store.read(undefined, undefined, 'A 方案')
    expect(byValue.facts).toHaveLength(1)
    expect(byValue.facts[0]!.key).toBe('api-arch')

    const bySource = await store.read(undefined, undefined, '委派')
    expect(bySource.facts).toHaveLength(1)

    const byKey = await store.read(undefined, undefined, 'reply-style')
    expect(byKey.facts[0]!.key).toBe('reply-style')

    expect((await store.read(undefined, undefined, '不存在')).facts).toHaveLength(0)
  })

  it('summarizes newest per key with decisions last', async () => {
    const { store } = makeStore()
    await store.write('profile', 'name', '张三')
    await store.write('preference', 'reply-style', '先给结论')
    await store.write('decision', 'api-arch', '方案 B')
    await store.write('decision', 'old', '旧决策')

    const summary = await store.summarize()
    expect(summary.factCount).toBe(4)
    // Profile/preference lines first, decisions after; keys unique.
    expect(summary.text).toContain('name：张三')
    expect(summary.text).toContain('偏好 reply-style：先给结论')
    expect(summary.text.indexOf('近期决策')).toBeGreaterThan(summary.text.indexOf('偏好'))
    // Same-key decision: only the newest value renders.
    expect(summary.text).toContain('api-arch：方案 B')
    expect(summary.text).not.toContain('方案 A')
  })

  it('renders an empty summary when nothing is stored', async () => {
    const { store } = makeStore()
    const summary = await store.summarize()
    expect(summary.text).toBe('')
    expect(summary.factCount).toBe(0)
  })

  it('notifies write listeners after a successful append', async () => {
    const { store } = makeStore()
    let notified = 0
    const unsubscribe = store.onWrite(() => { notified += 1 })
    await store.write('profile', 'name', '张三')
    expect(notified).toBe(1)
    unsubscribe()
    await store.write('profile', 'name', '李四')
    expect(notified).toBe(1)
  })
})
