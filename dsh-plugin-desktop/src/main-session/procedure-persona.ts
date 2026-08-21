/**
 * main-session -- procedure list prompt section
 *
 * Registers a system-prompt section **scoped to the main agent only** that
 * renders the available-procedures summary (key / name / trigger / run count)
 * into every prompt assembly — the "know what I know how to do" layer. Full
 * steps stay out of the prompt; the model recalls them on demand with
 * `procedure_recall` when a task matches a known procedure.
 *
 * Text is a provider evaluated at each assembly, cached briefly; the store
 * invalidates on save so a newly stored procedure appears next turn.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { ProcedureStore } from './procedure.ts'

/** Prompt section order: right after the user-memory section (55). */
const PROCEDURE_SECTION_ORDER = 56

/** Cache TTL: re-read the file at most once per second per assembly burst. */
const PROCEDURE_CACHE_TTL_MS = 1000

/**
 * Register the procedure-list prompt section on the main agent.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 * @param store - the procedure store backing this section.
 */
export function registerProcedureSection(agentCtx: Context, store: ProcedureStore): void {
  const systemPrompt = agentCtx.get('systemPrompt') as
    | { section(section: { name: string; order: number; text: unknown }): () => void }
    | undefined
  if (systemPrompt === undefined) return

  let cached: { at: number; text: string } | undefined

  const renderList = async (): Promise<string> => {
    const now = Date.now()
    if (cached !== undefined && now - cached.at < PROCEDURE_CACHE_TTL_MS) return cached.text
    const summary = await store.listSummary()
    const text = summary.text === ''
      ? ''
      : `## 可用流程\n${summary.text}`
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
        current = await renderList()
      } finally {
        refreshing = false
      }
    }
    void refresh()

    const dispose = systemPrompt.section({
      name: 'main-session:procedures',
      order: PROCEDURE_SECTION_ORDER,
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
  }, 'main-session: procedure list section')
}
