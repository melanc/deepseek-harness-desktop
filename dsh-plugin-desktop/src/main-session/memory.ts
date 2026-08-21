/**
 * main-session -- user memory store (semantic memory layer)
 *
 * Owns the durable "user facts" log: profile/preference/decision/background
 * entries written as append-only JSONL under the main session cwd
 * (`memory/user-facts.jsonl`). Reads resolve the newest value per `(type,
 * key)` by scanning the log tail-first, so later writes shadow earlier ones
 * without rewriting history — decisions keep their prior rows as provenance.
 *
 * Deliberately NOT the settings namespace: settings are schema-validated
 * configuration (fixed keys, UI forms, hot-reload), while user facts are
 * free-form, continuously appended, and read by the model. Mixing them would
 * turn settings.yaml into an unbounded log.
 */

import { mkdir, readFile, appendFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  type MemoryFact,
  type MemoryFactType,
  type MemoryReadResult,
  type MemorySummary,
  type MemoryWriteResult,
  DEFAULT_MEMORY_SUMMARY_CHARS,
  MEMORY_FACT_LIMIT,
  LOG_TAG,
} from './types.ts'

/** Memory store constructor options. */
export interface UserMemoryOptions {
  /** Absolute path to the JSONL memory log. */
  readonly filePath: string
}

/** One in-memory read of the log: all rows in file order. */
interface MemoryLogRow {
  readonly fact: MemoryFact
  /** Line number in the file (1-based), used to keep file order stable. */
  readonly line: number
}

/**
 * The user memory store. One instance per main-session plugin activation;
 * all operations are async and append/read the file without holding locks
 * (append-only writes plus whole-file reads are naturally safe).
 */
export class UserMemoryStore {
  private readonly filePath: string
  private readonly writeListeners = new Set<() => void>()

  constructor(options: UserMemoryOptions) {
    this.filePath = options.filePath
  }

  /**
   * Subscribe to fact writes (fires after a successful append).
   * @param listener - callback invoked post-write.
   * @returns an unsubscribe function.
   */
  onWrite(listener: () => void): () => void {
    this.writeListeners.add(listener)
    return () => { this.writeListeners.delete(listener) }
  }

  /**
   * Append one fact. Profile/preference/background/decision all share the
   * same storage; the type only changes how the summary renders them.
   * @param type - fact kind.
   * @param key - stable fact key.
   * @param value - free-text fact value.
   * @param source - optional provenance note.
   * @returns the written fact, or an error when the append fails.
   */
  async write(type: MemoryFactType, key: string, value: string, source?: string): Promise<MemoryWriteResult> {
    const trimmedKey = key.trim()
    const trimmedValue = value.trim()
    if (trimmedKey === '') {
      return { success: false, error: 'memory key must not be empty' }
    }
    if (trimmedValue === '') {
      return { success: false, error: 'memory value must not be empty' }
    }
    const fact: MemoryFact = {
      type,
      key: trimmedKey,
      value: trimmedValue,
      updatedAt: Date.now(),
      ...source === undefined ? {} : { source },
    }
    try {
      await mkdir(dirname(this.filePath), { recursive: true, mode: 0o700 })
      await appendFile(this.filePath, `${JSON.stringify(fact)}\n`, { encoding: 'utf8' })
      for (const listener of this.writeListeners) {
        try {
          listener()
        } catch (err) {
          console.warn(`${LOG_TAG} memory write listener failed:`, err)
        }
      }
      return { success: true, fact }
    } catch (err) {
      return { success: false, error: `memory write failed: ${err instanceof Error ? err.message : String(err)}` }
    }
  }

  /**
   * Read facts. Exact filter by type/key when given; otherwise a substring
   * match over `query` across type+key+value+source. Returns newest-first.
   * @param type - optional fact-kind filter.
   * @param key - optional exact key filter.
   * @param query - optional substring query.
   * @returns matching facts newest-first; `complete` is false on read failure.
   */
  async read(type?: MemoryFactType, key?: string, query?: string): Promise<MemoryReadResult> {
    try {
      const rows = await this.readAll()
      const normalizedQuery = query?.trim().toLowerCase()
      const filtered = rows
        .filter(row => type === undefined || row.fact.type === type)
        .filter(row => key === undefined || row.fact.key === key)
        .filter(row => normalizedQuery === undefined || normalizedQuery === ''
          || row.fact.key.toLowerCase().includes(normalizedQuery)
          || row.fact.value.toLowerCase().includes(normalizedQuery)
          || (row.fact.source ?? '').toLowerCase().includes(normalizedQuery))
        // Newest first; stable tie-break by file order (later line wins).
        .sort((a, b) => b.fact.updatedAt - a.fact.updatedAt || b.line - a.line)
        .map(row => row.fact)
      return { facts: filtered, complete: true }
    } catch (err) {
      return {
        facts: [],
        complete: false,
        error: `memory read failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  /**
   * Render the memory log into the prompt-section text: the newest fact per
   * key (whole log), decisions newest-first, all truncated to the summary
   * budget. The model sees this every turn, so it stays compact.
   * @returns the rendered summary; empty text when nothing is stored.
   */
  async summarize(): Promise<MemorySummary> {
    try {
      const rows = await this.readAll()
      if (rows.length === 0) return { text: '', factCount: 0 }
      // Newest fact per key (whole log): later lines shadow earlier ones.
      const byKey = new Map<string, MemoryFact>()
      for (const row of rows) {
        const existing = byKey.get(row.fact.key)
        if (existing === undefined || row.fact.updatedAt >= existing.updatedAt) {
          byKey.set(row.fact.key, row.fact)
        }
      }
      const lines: string[] = []
      const appendLine = (label: string, fact: MemoryFact): void => {
        lines.push(`- ${label}${fact.key}：${fact.value}${fact.source === undefined ? '' : `（${fact.source}）`}`)
      }
      for (const fact of byKey.values()) {
        if (fact.type === 'profile') appendLine('', fact)
        else if (fact.type === 'preference') appendLine('偏好 ', fact)
        else if (fact.type === 'background') appendLine('背景 ', fact)
      }
      // Decisions newest-first after the static facts.
      const decisions = [...byKey.values()]
        .filter(fact => fact.type === 'decision')
        .sort((a, b) => b.updatedAt - a.updatedAt)
      for (const fact of decisions) appendLine('近期决策 ', fact)

      let text = lines.join('\n')
      if (text.length > DEFAULT_MEMORY_SUMMARY_CHARS) {
        text = `${text.slice(0, DEFAULT_MEMORY_SUMMARY_CHARS)}…`
      }
      if (rows.length > MEMORY_FACT_LIMIT) {
        text += `\n（记忆条目已超过 ${MEMORY_FACT_LIMIT} 条，建议整理）`
      }
      return { text, factCount: rows.length }
    } catch {
      return { text: '', factCount: 0 }
    }
  }

  /** Read every row in file order; missing file yields an empty list. */
  private async readAll(): Promise<MemoryLogRow[]> {
    let raw: string
    try {
      raw = await readFile(this.filePath, { encoding: 'utf8' })
    } catch {
      return [] // no memory yet
    }
    const rows: MemoryLogRow[] = []
    const lines = raw.split('\n')
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index]!.trim()
      if (line === '') continue
      try {
        rows.push({ fact: JSON.parse(line) as MemoryFact, line: index + 1 })
      } catch {
        console.warn(`${LOG_TAG} skipping malformed memory line ${index + 1}`)
      }
    }
    return rows
  }
}
