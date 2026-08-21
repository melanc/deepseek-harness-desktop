/**
 * main-session -- procedure memory store (procedural/SOP memory layer)
 *
 * Owns the durable "procedures" log: reusable multi-step operating procedures
 * written as append-only JSONL under the main session cwd
 * (`memory/procedures.jsonl`). Saving the same `key` again overwrites the
 * entry in memory (newest row wins) while the prior rows stay on disk as
 * history; `runCount` increments on each save so the model sees which
 * procedures have proven themselves.
 *
 * Shares the storage shape of {@link UserMemoryStore} (append-only JSONL,
 * newest-per-key reads) but keeps a separate file: procedures are structured
 * operation memory (steps/trigger/output) with different rendering and
 * matching semantics from free-text user facts.
 */

import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  type Procedure,
  type ProcedureRecallResult,
  type ProcedureSaveResult,
  DEFAULT_PROCEDURE_LIST_CHARS,
  PROCEDURE_LIMIT,
  LOG_TAG,
} from './types.ts'

/** Procedure store constructor options. */
export interface ProcedureStoreOptions {
  /** Absolute path to the procedures JSONL log. */
  readonly filePath: string
}

/** One in-memory read of the log: all rows in file order. */
interface ProcedureLogRow {
  readonly procedure: Procedure
  /** Line number in the file (1-based), used to keep file order stable. */
  readonly line: number
}

/**
 * The procedure memory store. One instance per main-session plugin
 * activation; append/read without locks (append-only writes plus whole-file
 * reads are naturally safe).
 */
export class ProcedureStore {
  private readonly filePath: string
  private readonly writeListeners = new Set<() => void>()

  constructor(options: ProcedureStoreOptions) {
    this.filePath = options.filePath
  }

  /**
   * Subscribe to procedure saves (fires after a successful append).
   * @param listener - callback invoked post-save.
   * @returns an unsubscribe function.
   */
  onWrite(listener: () => void): () => void {
    this.writeListeners.add(listener)
    return () => { this.writeListeners.delete(listener) }
  }

  /**
   * Save (or update) one procedure. Saving an existing `key` replaces the
   * entry in reads and bumps `runCount`; the prior rows remain on disk as
   * history. New saves start at `runCount = 1`.
   * @param input - the procedure fields; steps/output are trimmed and
   *   required, trigger/name are required, pitfalls optional.
   * @returns the stored procedure, or an error when validation/IO fails.
   */
  async save(input: {
    key: string
    name: string
    trigger: string
    steps: readonly string[]
    output: string
    pitfalls?: readonly string[]
  }): Promise<ProcedureSaveResult> {
    const key = input.key.trim()
    const name = input.name.trim()
    const trigger = input.trigger.trim()
    const output = input.output.trim()
    const steps = input.steps.map(step => step.trim()).filter(step => step !== '')
    const pitfalls = input.pitfalls === undefined
      ? undefined
      : input.pitfalls.map(pitfall => pitfall.trim()).filter(pitfall => pitfall !== '')
    if (key === '') return { success: false, error: 'procedure key must not be empty' }
    if (name === '') return { success: false, error: 'procedure name must not be empty' }
    if (trigger === '') return { success: false, error: 'procedure trigger must not be empty' }
    if (steps.length === 0) return { success: false, error: 'procedure steps must not be empty' }
    if (output === '') return { success: false, error: 'procedure output must not be empty' }

    const prior = await this.latest(key)
    const procedure: Procedure = {
      key,
      name,
      trigger,
      steps,
      output,
      ...pitfalls === undefined ? {} : { pitfalls },
      runCount: (prior?.runCount ?? 0) + 1,
      updatedAt: Date.now(),
    }
    try {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      await appendFile(this.filePath, `${JSON.stringify(procedure)}\n`, { encoding: 'utf8' })
      for (const listener of this.writeListeners) {
        try {
          listener()
        } catch (err) {
          console.warn(`${LOG_TAG} procedure write listener failed:`, err)
        }
      }
      return { success: true, procedure }
    } catch (err) {
      return { success: false, error: `procedure save failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Recall procedures. Exact key match when `key` is given (newest row for
   * that key only); otherwise a substring match over `query` across
   * name+trigger (scenario binding), newest per key. Returns newest-first.
   * @param key - optional exact procedure key.
   * @param query - optional substring over name/trigger.
   * @returns matching procedures newest-first; `complete` false on failure.
   */
  async recall(key?: string, query?: string): Promise<ProcedureRecallResult> {
    try {
      const rows = await this.readAll()
      if (key !== undefined) {
        const newest = rows
          .filter(row => row.procedure.key === key)
          .sort((a, b) => b.procedure.updatedAt - a.procedure.updatedAt || b.line - a.line)[0]
        return { procedures: newest === undefined ? [] : [newest.procedure], complete: true }
      }
      const normalizedQuery = query?.trim().toLowerCase()
      const matching = rows
        .filter(row => normalizedQuery === undefined || normalizedQuery === ''
          || row.procedure.name.toLowerCase().includes(normalizedQuery)
          || row.procedure.trigger.toLowerCase().includes(normalizedQuery))
      // Newest per key, then newest-first across keys.
      const byKey = new Map<string, Procedure>()
      for (const row of matching) {
        const existing = byKey.get(row.procedure.key)
        if (existing === undefined || row.procedure.updatedAt >= existing.updatedAt) {
          byKey.set(row.procedure.key, row.procedure)
        }
      }
      const procedures = [...byKey.values()].sort((a, b) => b.updatedAt - a.updatedAt)
      return { procedures, complete: true }
    } catch (err) {
      return {
        procedures: [],
        complete: false,
        error: `procedure recall failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * Render the newest procedure per key into the prompt-section list text:
   * key, name, trigger, and run count — enough for the model to know what is
   * available without paying for the full steps. Truncated to the list budget.
   * @returns the rendered list; empty text when nothing is stored.
   */
  async listSummary(): Promise<{ text: string; count: number }> {
    try {
      const rows = await this.readAll()
      if (rows.length === 0) return { text: '', count: 0 }
      const byKey = new Map<string, Procedure>()
      for (const row of rows) {
        const existing = byKey.get(row.procedure.key)
        if (existing === undefined || row.procedure.updatedAt >= existing.updatedAt) {
          byKey.set(row.procedure.key, row.procedure)
        }
      }
      const lines = [...byKey.values()].map(procedure => {
        return `- ${procedure.key}：${procedure.name}（触发：${procedure.trigger}）— 已用 ${procedure.runCount} 次`
      })
      let text = lines.join('\n')
      if (text.length > DEFAULT_PROCEDURE_LIST_CHARS) {
        text = `${text.slice(0, DEFAULT_PROCEDURE_LIST_CHARS)}…`
      }
      if (byKey.size > PROCEDURE_LIMIT) {
        text += `\n（流程条目已超过 ${PROCEDURE_LIMIT} 条，建议整理）`
      }
      return { text, count: byKey.size }
    } catch {
      return { text: '', count: 0 }
    }
  }

  /** The newest stored row for one key, or undefined when absent. */
  private async latest(key: string): Promise<Procedure | undefined> {
    const result = await this.recall(key)
    return result.procedures[0]
  }

  /** Read every row in file order; missing file yields an empty list. */
  private async readAll(): Promise<ProcedureLogRow[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, { encoding: 'utf8' })
    } catch {
      return [] // no procedures yet
    }
    const rows: ProcedureLogRow[] = []
    const lines = raw.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!.trim()
      if (line === '') continue
      try {
        rows.push({ procedure: JSON.parse(line) as Procedure, line: index + 1 })
      } catch {
        console.warn(`${LOG_TAG} skipping malformed procedure line ${index + 1}`)
      }
    }
    return rows
  }
}
