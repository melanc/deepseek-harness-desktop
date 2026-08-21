/**
 * main-session -- user memory tools
 *
 * Two model-facing tools registered **scoped to the main agent only** (via
 * `agent.ctx`), so only the main session can maintain its user memory:
 *
 * - `memory_write` — store one durable user fact (profile / preference /
 *   decision / background). The main session calls this when the user states
 *   a stable preference, project background, or a decision worth keeping.
 * - `memory_read` — retrieve stored facts by kind/key or by substring query,
 *   so the main session can recall context beyond the summary it already sees.
 *
 * Registration follows the dsh-tools `defineTool` pattern; execution is
 * delegated to the {@link UserMemoryStore}.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { UserMemoryStore } from './memory.ts'
import type { MemoryFactType } from './types.ts'

/** Allowed fact kinds exposed to the model. */
const MEMORY_TYPES: readonly MemoryFactType[] = ['profile', 'preference', 'decision', 'background']

/**
 * Register the memory tools on the main agent.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 * @param store - the user memory store backing the tools.
 */
export function registerMemoryTools(agentCtx: Context, store: UserMemoryStore): void {
  const tools = [
    defineTool({
      name: 'memory_write',
      description:
        'Store one durable user fact: who the user is (profile), how they like things (preference), ' +
        'their project context (background), or a decision made (decision). Call this when the user ' +
        'states something stable and worth remembering across sessions — e.g. "remember my name is X", ' +
        '"I prefer answers in Chinese", or a settled technical choice. It becomes part of the user ' +
        'memory loaded into every future turn. Use a short stable key (e.g. "name", "reply-style", "api-arch").',
      parameters: {
        type: {
          type: 'string',
          required: true,
          description: `Fact kind: ${MEMORY_TYPES.join(' / ')}.`,
          enum: [...MEMORY_TYPES],
        },
        key: {
          type: 'string',
          required: true,
          description: 'Short stable key for the fact (e.g. "name", "reply-style", "api-arch").',
        },
        value: {
          type: 'string',
          required: true,
          description: 'The fact itself, as concise plain text.',
        },
        source: {
          type: 'string',
          description: 'Optional provenance note (e.g. which conversation/decision produced it).',
        },
      },
      output: {
        schema: {
          type: 'json',
        },
        render: (_args: Record<string, unknown>, value: unknown) => {
          return [{
            type: 'text',
            text: JSON.stringify(value, null, 2),
          }]
        },
      },
      async execute(args: { type: MemoryFactType; key: string; value: string; source?: string }) {
        const result = await store.write(args.type, args.key, args.value, args.source)
        return JSON.parse(JSON.stringify(result)) as never
      },
    }),

    defineTool({
      name: 'memory_read',
      description:
        'Read stored user memory facts. Filter by kind and/or exact key, or search by substring ' +
        'across keys, values, and provenance. Use this to recall user context beyond the summary ' +
        'already loaded into your prompt (e.g. an older decision, or every fact about a topic).',
      parameters: {
        type: {
          type: 'string',
          description: `Optional fact-kind filter: ${MEMORY_TYPES.join(' / ')}.`,
          enum: [...MEMORY_TYPES],
        },
        key: {
          type: 'string',
          description: 'Optional exact fact key filter.',
        },
        query: {
          type: 'string',
          description: 'Optional substring search across keys, values, and provenance.',
        },
      },
      output: {
        schema: {
          type: 'json',
        },
        render: (_args: Record<string, unknown>, value: unknown) => {
          return [{
            type: 'text',
            text: JSON.stringify(value, null, 2),
          }]
        },
      },
      async execute(args: { type?: MemoryFactType; key?: string; query?: string }) {
        const result = await store.read(args.type, args.key, args.query)
        return JSON.parse(JSON.stringify(result)) as never
      },
    }),
  ]

  for (const tool of tools) {
    agentCtx.tools.register(tool)
  }
}
