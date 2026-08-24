/**
 * main-session -- task progress prompt section
 *
 * Registers a system-prompt section **scoped to the main agent only** that
 * renders the current task-progress overview (recent tasks with per-subtask
 * status and open confirmations) into every prompt assembly — so the
 * dispatcher can resume in-flight work without a tool call.
 *
 * The section text is a provider evaluated at each assembly (`PromptSection
 * text: (context) => string`); reads hit an in-memory cache that the store
 * invalidates on write, mirroring the user-memory section.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { TaskProgressStore } from './task-progress.ts'

/** Prompt section order: after user-memory (55), before procedures (56). */
const TASK_PROGRESS_SECTION_ORDER = 54

/** Cache TTL: re-read the file at most once per second per assembly burst. */
const TASK_PROGRESS_CACHE_TTL_MS = 1000

/**
 * Register the task-progress prompt section on the main agent.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 * @param store - the task-progress store backing this section.
 */
export function registerTaskProgressSection(agentCtx: Context, store: TaskProgressStore): void {
  const systemPrompt = agentCtx.get('systemPrompt') as
    | { section(section: { name: string; order: number; text: unknown }): () => void }
    | undefined
  if (systemPrompt === undefined) return

  let cached: { at: number; text: string } | undefined

  const renderProgress = async (): Promise<string> => {
    const now = Date.now()
    if (cached !== undefined && now - cached.at < TASK_PROGRESS_CACHE_TTL_MS) return cached.text
    const summary = await store.summarize()
    const text = summary.text === ''
      ? ''
      : `## 任务进度\n${summary.text}`
    cached = { at: now, text }
    return text
  }

  agentCtx.effect(() => {
    let current = ''
    let refreshing = false
    const refresh = async (): Promise<void> => {
      if (refreshing) return
      refreshing = true
      try {
        current = await renderProgress()
      } finally {
        refreshing = false
      }
    }
    void refresh()

    const dispose = systemPrompt.section({
      name: 'main-session:task-progress',
      order: TASK_PROGRESS_SECTION_ORDER,
      text: () => current,
    })

    const unsubscribe = store.onWrite(() => {
      cached = undefined
      void refresh()
    })

    return () => {
      dispose()
      unsubscribe()
    }
  }, 'main-session: task progress section')
}
