/**
 * main-session -- orchestration tools
 *
 * Three model-facing tools registered **scoped to the main agent only**
 * (through `agent.ctx`), so only the main session can orchestrate
 * workspace sessions:
 *
 * - `workspace_list_sessions` — enumerate workspace + ungrouped sessions
 *   with titles and liveness, so the main session can decide which
 *   workspace session is doing what.
 * - `workspace_send_message` — inject a message into a target session via
 *   followup.
 * - `workspace_await_reply` — wait for the target session's next assistant
 *   reply and return it (the result collection step).
 *
 * Registration follows the dsh-tools `defineTool` pattern; execution is
 * delegated to the MainSessionService. Each tool's `execute` returns the
 * pure JSON value declared by `output.schema`; `render` turns it into the
 * model-facing text blocks.
 */

import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { MainSessionService } from './service.ts'
import { MAIN_SESSION_ID } from './types.ts'

// ============================================================
// Tool definitions
// ============================================================

export function registerMainSessionTools(
  agentCtx: Context,
  service: MainSessionService,
): void {
  const tools = [
    defineTool({
      name: 'workspace_list_sessions',
      description:
        'List all workspace sessions and ungrouped live sessions, with titles and ' +
        'whether each has a live agent. Use this to determine which workspace ' +
        'session is handling a given task before sending it a message.',
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
        return JSON.parse(JSON.stringify(await service.listSessions())) as never
      },
    }),

    defineTool({
      name: 'workspace_send_message',
      description:
        'Send a message to a target session (workspace session or any live session). ' +
        'The message is injected as a next-turn input; the target agent wakes and ' +
        'processes it. Use workspace_await_reply afterwards to collect the result.',
      parameters: {
        sessionId: {
          type: 'string',
          required: true,
          description: 'Target session id (from workspace_list_sessions).',
        },
        message: {
          type: 'string',
          required: true,
          description: 'Message body to send to the target session.',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            success: { type: 'boolean', required: true },
            messageId: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (_args: { sessionId: string; message: string }, value: { success: boolean; messageId?: string; error?: string }) => {
          return [{
            type: 'text',
            text: JSON.stringify(value, null, 2),
          }]
        },
      },
      async execute(args: { sessionId: string; message: string }) {
        return service.sendMessage(args.sessionId, args.message)
      },
    }),

    defineTool({
      name: 'workspace_create_session',
      description:
        'Create a new workspace session (ensuring the workspace exists), attach it to ' +
        'the workspace, and optionally dispatch an initial task to it. Use this to ' +
        'spin up a dedicated worker session for a new task, then workspace_await_reply ' +
        'to collect its result. When workspacePath is omitted, a workspace folder is ' +
        'created under the DSH default workspace root (~/.dsh/workspaces/<title>/); all ' +
        'files the session creates land inside that folder.',
      parameters: {
        workspacePath: {
          type: 'string',
          description:
            'Absolute workspace directory path. Omit to auto-create a folder under ' +
            'the DSH default workspace root (~/.dsh/workspaces/<workspaceTitle>/).',
        },
        workspaceTitle: {
          type: 'string',
          description:
            'Workspace display title; also used as the folder name when workspacePath is omitted.',
        },
        task: {
          type: 'string',
          description: 'Initial task message dispatched to the new session.',
        },
        sessionTitle: {
          type: 'string',
          description:
            'Optional session display title shown in the sidebar. Omit to derive one from the first line of `task`.',
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
      async execute(args: { workspacePath?: string; workspaceTitle?: string; task?: string; sessionTitle?: string }) {
        return JSON.parse(JSON.stringify(
          await service.createWorkspaceSession({
            ...(args.workspacePath === undefined ? {} : { workspacePath: args.workspacePath }),
            ...(args.workspaceTitle === undefined ? {} : { workspaceTitle: args.workspaceTitle }),
            ...(args.task === undefined ? {} : { task: args.task }),
            ...(args.sessionTitle === undefined ? {} : { sessionTitle: args.sessionTitle }),
          }),
        )) as never
      },
    }),

    defineTool({
      name: 'workspace_await_reply',
      description:
        'Wait for a target session\'s turn to FINISH (turn/end) and return a SUMMARY of its ' +
        'final result. Optional: the main session normally relies on the completion ' +
        'callback, which pushes each finished result automatically — prefer that and avoid ' +
        'calling this tool after dispatching. Use it only when you explicitly need a ' +
        'synchronous result. The main session reports only the summary (progress + result) ' +
        'to the user — never the full transcript; point the user to the workspace session ' +
        '(workspaceId/workspaceName in the result) for details. Times out after 5 minutes.',
      parameters: {
        sessionId: {
          type: 'string',
          required: true,
          description: 'Target session id (from workspace_list_sessions).',
        },
        timeoutMs: {
          type: 'number',
          description: 'Optional max wait in milliseconds (default 300000).',
        },
        maxReplyChars: {
          type: 'number',
          description: 'Optional summary character budget (default 800).',
        },
      },
      output: {
        schema: {
          type: 'object',
          additionalProperties: false,
          properties: {
            sessionId: { type: 'string', required: true },
            summary: { type: 'string' },
            workspaceId: { type: 'string' },
            workspaceName: { type: 'string' },
            timedOut: { type: 'boolean', required: true },
            awaitingApproval: { type: 'string' },
            error: { type: 'string' },
          },
        },
        render: (
          _args: { sessionId: string; timeoutMs?: number; maxReplyChars?: number },
          value: { sessionId: string; summary?: string; workspaceId?: string; workspaceName?: string; timedOut: boolean; awaitingApproval?: string; error?: string },
        ) => {
          return [{
            type: 'text',
            text: JSON.stringify(value, null, 2),
          }]
        },
      },
      async execute(args: { sessionId: string; timeoutMs?: number; maxReplyChars?: number }) {
        return service.awaitReply(args.sessionId, {
          ...(args.timeoutMs === undefined ? {} : { timeoutMs: args.timeoutMs }),
          ...(args.maxReplyChars === undefined ? {} : { maxReplyChars: args.maxReplyChars }),
        })
      },
    }),

    defineTool({
      name: 'workspace_rename_session',
      description:
        'Rename a workspace session\'s title. Use this when the user asks to rename a session. ' +
        'Returns the accepted (normalized) title and the durable seq of the title event. ' +
        'Fails with code "no-live-agent" when the target session is not open, and "title-invalid" ' +
        'when the title normalizes to empty.',
      parameters: {
        sessionId: {
          type: 'string',
          required: true,
          description: 'Target session id (from workspace_list_sessions).',
        },
        title: {
          type: 'string',
          required: true,
          description: 'New title text (normalized by the host; empty-after-normalize is rejected).',
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
      async execute(args: { sessionId: string; title: string }) {
        return JSON.parse(JSON.stringify(service.renameSession(args.sessionId, args.title))) as never
      },
    }),
  ]

  for (const tool of tools) {
    agentCtx.tools.register(tool)
  }
}

// ============================================================
// Module helpers
// ============================================================

/** Verify an agent is the main session (used by callers/tests). */
export function isMainSession(agent: Agent): boolean {
  return agent.id === MAIN_SESSION_ID
}
