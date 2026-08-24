/**
 * main-session -- task progress tools
 *
 * Two model-facing tools registered **scoped to the main agent only**, so
 * only the main session tracks its dispatched tasks:
 *
 * - `task_progress_update` — create or replace one task's progress snapshot:
 *   subtask statuses plus pending user confirmations. The main session calls
 *   this after planning, after each dispatch/result, and when a subtask needs
 *   the user to decide something.
 * - `task_progress_query` — read the current task overview (newest snapshot
 *   per task), including open confirmations, so the main session can resume
 *   in-flight work or report progress.
 *
 * Registration follows the dsh-tools `defineTool` pattern; execution is
 * delegated to the {@link TaskProgressStore}.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-tools'
import type { TaskProgressStore } from './task-progress.ts'
import type { PendingConfirmation, SubtaskProgress } from './types.ts'

/**
 * Register the task-progress tools on the main agent.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 * @param store - the task-progress store backing the tools.
 */
export function registerTaskProgressTools(agentCtx: Context, store: TaskProgressStore): void {
  const tools = [
    defineTool({
      name: 'task_progress_update',
      description:
        'Create or update one task\'s progress record. Track the current user task as subtasks: ' +
        'after planning, record every subtask as pending; after dispatching one, set it to assigned ' +
        '(with its sessionId/workspaceName); after collecting its result, set it to completed with a ' +
        'short summary; if it is stuck or needs the user to decide something, set it to blocked and ' +
        'add a pendingConfirmation. Pass the WHOLE subtask and confirmation lists each call — they ' +
        'replace the previous state, not merge. taskId is a short stable id (e.g. "refactor-order").',
      parameters: {
        taskId: {
          type: 'string',
          required: true,
          description: 'Stable task id (short slug, e.g. "refactor-order").',
        },
        description: {
          type: 'string',
          required: true,
          description: 'The user\'s original task description.',
        },
        subtasks: {
          type: 'json',
          required: true,
          description:
            'Full ordered subtask list. Each: { id, title, status ("pending"|"assigned"|"running"|"completed"|"blocked"|"cancelled"), ' +
            'sessionId?, workspaceName?, summary? }.',
        },
        pendingConfirmations: {
          type: 'json',
          description:
            'Full pending-confirmation list. Each: { id, question, subtaskId?, status ("open"|"resolved"), resolution? }.',
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
        taskId: string
        description: string
        subtasks: JsonValue
        pendingConfirmations?: JsonValue
      }) {
        // `type: 'json'` parameters arrive as untyped JsonValue; cast to the
        // structured lists the store validates by construction.
        const result = await store.update({
          taskId: args.taskId,
          description: args.description,
          subtasks: args.subtasks as unknown as SubtaskProgress[],
          ...(args.pendingConfirmations === undefined
            ? {}
            : { pendingConfirmations: args.pendingConfirmations as unknown as PendingConfirmation[] }),
        })
        return JSON.parse(JSON.stringify(result)) as never
      },
    }),

    defineTool({
      name: 'task_progress_query',
      description:
        'Read the current task-progress overview (newest snapshot per task), including every open ' +
        'pending confirmation. Use this to resume in-flight work, report progress to the user, or ' +
        'recall which subtask is waiting on which workspace session.',
      parameters: {
        taskId: {
          type: 'string',
          description: 'Optional exact task id; omit to list all tracked tasks newest-first.',
        },
        limit: {
          type: 'number',
          description: 'Optional result cap (default 10).',
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
      async execute(args: { taskId?: string; limit?: number }) {
        const result = await store.query(args.taskId, args.limit)
        return JSON.parse(JSON.stringify(result)) as never
      },
    }),
  ]

  for (const tool of tools) {
    agentCtx.tools.register(tool)
  }
}
