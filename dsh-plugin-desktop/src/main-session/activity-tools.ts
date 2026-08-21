/**
 * main-session -- session activity tool
 *
 * One model-facing tool registered **scoped to the main agent only** (via
 * `agent.ctx`): `session_activity` queries the dispatch ledger — what each
 * workspace session was asked to do and how it went — so the main session
 * can report "who is doing what, and what happened" across restarts.
 *
 * Registration follows the dsh-tools `defineTool` pattern; execution is
 * delegated to the {@link SessionActivityStore}.
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SessionActivityStore } from './activity.ts'
import type { SessionActivityStatus } from './types.ts'

/** Allowed status filters exposed to the model. */
const ACTIVITY_STATUSES: readonly SessionActivityStatus[] = ['running', 'completed', 'failed', 'timeout']

/**
 * Register the session-activity tool on the main agent.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 * @param store - the session activity store backing the tool.
 */
export function registerActivityTools(agentCtx: Context, store: SessionActivityStore): void {
  const tool = defineTool({
    name: 'session_activity',
    description:
      'Query the session activity log: what each workspace session was asked to do and how it went ' +
      '(running / completed / failed / timeout), newest first. Use this to know what a session has ' +
      'been doing historically before dispatching to it, or to report results across restarts. ' +
      'Combine with workspace_list_sessions (current liveness) for a full scheduling view.',
    parameters: {
      sessionId: {
        type: 'string',
        description: 'Optional filter: only this session\'s activity.',
      },
      workspaceId: {
        type: 'string',
        description: 'Optional filter: only activity in this workspace.',
      },
      status: {
        type: 'string',
        description: `Optional filter: ${ACTIVITY_STATUSES.join(' / ')}.`,
        enum: [...ACTIVITY_STATUSES],
      },
      limit: {
        type: 'number',
        description: 'Optional max rows to return (default 20).',
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
      sessionId?: string
      workspaceId?: string
      status?: SessionActivityStatus
      limit?: number
    }) {
      const result = await store.query(args)
      return JSON.parse(JSON.stringify(result)) as never
    },
  })
  agentCtx.tools.register(tool)
}
