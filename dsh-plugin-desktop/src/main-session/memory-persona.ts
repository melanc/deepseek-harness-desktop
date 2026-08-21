/**
 * main-session -- user memory prompt section
 *
 * Registers a system-prompt section **scoped to the main agent only** that
 * renders the stored user facts (profile / preference / background / recent
 * decisions) into every prompt assembly — the "recognize the user" layer.
 *
 * The section text is a provider evaluated at each assembly (`PromptSection
 * text: (context) => string`), so a fact written mid-conversation reaches the
 * next turn without a manual refresh. Reads hit an in-memory cache that the
 * store invalidates on write, keeping per-assembly cost off the disk.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { UserMemoryStore } from './memory.ts'

/** Prompt section order: right after the main-session persona (50), before tool guidance (100+). */
const MEMORY_SECTION_ORDER = 55

/** Cache TTL: re-read the file at most once per second per assembly burst. */
const MEMORY_CACHE_TTL_MS = 1000

/**
 * Register the user-memory prompt section on the main agent.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 * @param store - the user memory store backing this section.
 */
export function registerUserMemorySection(agentCtx: Context, store: UserMemoryStore): void {
  const systemPrompt = agentCtx.get('systemPrompt') as
    | { section(section: { name: string; order: number; text: unknown }): () => void }
    | undefined
  if (systemPrompt === undefined) return

  // Assembly-time cache: one summary per TTL window, so rapid consecutive
  // assemblies (plan + tool loop steps) do not hit the disk each time.
  let cached: { at: number; text: string } | undefined

  const renderMemory = async (): Promise<string> => {
    const now = Date.now()
    if (cached !== undefined && now - cached.at < MEMORY_CACHE_TTL_MS) return cached.text
    const summary = await store.summarize()
    const text = summary.text === ''
      ? ''
      : `## 用户记忆\n${summary.text}`
    cached = { at: now, text }
    return text
  }

  agentCtx.effect(() => {
    // `text` may be a provider function; an async provider is not supported by
    // the section contract, so pre-render synchronously into a mutable holder
    // and have the provider return the holder. The holder is refreshed by the
    // store's write path through `invalidate()`.
    let current = ''
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing) return
      refreshing = true
      try {
        current = await renderMemory()
      } finally {
        refreshing = false
      }
    }
    void refresh()

    const dispose = systemPrompt.section({
      name: 'main-session:user-memory',
      order: MEMORY_SECTION_ORDER,
      text: () => current,
    })

    // Invalidate on write so the next assembly picks the new fact up.
    const unsubscribe = store.onWrite(() => {
      cached = undefined
      void refresh()
    })

    return () => {
      dispose()
      unsubscribe()
    }
  }, 'main-session: user memory section')
}
