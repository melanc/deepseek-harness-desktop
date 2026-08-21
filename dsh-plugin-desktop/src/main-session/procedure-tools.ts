/**
 * main-session -- procedure memory tools
 *
 * Three model-facing tools registered **scoped to the main agent only** (via
 * `agent.ctx`), so only the main session can maintain its procedure library:
 *
 * - `procedure_save` — store/update a reusable multi-step procedure after a
 *   task completes, so a proven way of working can be reused next time.
 * - `procedure_recall` — fetch a full procedure by key, or match one from a
 *   task description against name/trigger (scenario binding).
 * - `procedure_list` — list available procedures (key, name, trigger, runs)
 *   so the main session knows what it knows before delegating.
 *
 * Registration follows the dsh-tools `defineTool` pattern; execution is
 * delegated to the {@link ProcedureStore}.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ProcedureStore } from './procedure.ts'

/**
 * Register the procedure tools on the main agent.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 * @param store - the procedure store backing the tools.
 */
export function registerProcedureTools(agentCtx: Context, store: ProcedureStore): void {
  const tools = [
    defineTool({
      name: 'procedure_save',
      description:
        'Store (or update) a reusable multi-step procedure after a task completes: ' +
        'how a class of task gets done — trigger scenario, ordered steps, completion ' +
        'standard, common pitfalls. Saving an existing key updates it and bumps its ' +
        'run count (procedure evolution). Call this when a task you delegated was done ' +
        'in a multi-step, repeatable way that a future similar task should follow.',
      parameters: {
        key: {
          type: 'string',
          required: true,
          description: 'Short stable key (e.g. "order-refactor").',
        },
        name: {
          type: 'string',
          required: true,
          description: 'Human-readable name (e.g. 订单模块重构).',
        },
        trigger: {
          type: 'string',
          required: true,
          description: 'Trigger-scenario description matched when a similar task arrives.',
        },
        steps: {
          type: 'array',
          required: true,
          description: 'Ordered execution steps, each a concise string.',
          items: { type: 'string' },
        },
        output: {
          type: 'string',
          required: true,
          description: 'Completion standard — what "done" looks like.',
        },
        pitfalls: {
          type: 'array',
          description: 'Optional common pitfalls, each a concise string.',
          items: { type: 'string' },
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
      async execute(args: {
        key: string
        name: string
        trigger: string
        steps: string[]
        output: string
        pitfalls?: string[]
      }) {
        const result = await store.save(args)
        return JSON.parse(JSON.stringify(result)) as never
      },
    }),

    defineTool({
      name: 'procedure_recall',
      description:
        'Fetch a full stored procedure. Pass `key` for an exact procedure, or pass ' +
        'a task-description `query` to match against procedure names and triggers ' +
        '(scenario binding). Use this after checking the available-procedures list ' +
        'when a task arrives that matches a known procedure.',
      parameters: {
        key: {
          type: 'string',
          description: 'Optional exact procedure key.',
        },
        query: {
          type: 'string',
          description: 'Optional substring matched against procedure name and trigger.',
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
      async execute(args: { key?: string; query?: string }) {
        const result = await store.recall(args.key, args.query)
        return JSON.parse(JSON.stringify(result)) as never
      },
    }),

    defineTool({
      name: 'procedure_list',
      description:
        'List all available procedures (key, name, trigger, run count). Use this to ' +
        'know what reusable procedures exist before starting a task, so you can recall ' +
        'the matching one instead of improvising.',
      parameters: {},
      output: {
        schema: {
          type: 'json',
        },
        render: (_args: Record<string, never>, value: unknown) => {
          return [{
            type: 'text',
            text: JSON.stringify(value, null, 2),
          }]
        },
      },
      async execute() {
        const summary = await store.listSummary()
        return { procedures: summary.text === '' ? [] : summary.text.split('\n'), count: summary.count }
      },
    }),
  ]

  for (const tool of tools) {
    agentCtx.tools.register(tool)
  }
}
