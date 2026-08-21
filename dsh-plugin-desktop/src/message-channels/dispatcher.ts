/**
 * message-channels -- inbound dispatcher
 *
 * Routes normalized inbound IM messages into a DSH agent session and sends
 * the agent's reply back to the originating channel.
 *
 * Design (adapted from DevX `apps/runtime/dispatch-inbound.ts` to the DSH
 * plugin model):
 * - No IM protocol details: consumes InboundMessage + ReplyHandle only.
 * - The target agent session comes from the `messageChannels` settings
 *   namespace (`targetSessionId`). If set and a live agent with that id
 *   exists, `agent.followup()` injects the message as a next-turn input and
 *   wakes the driver.
 * - Replies are captured by waiting for the agent to go idle again and then
 *   reading the newest assistant message from the session surface.
 *
 * Limitations (v1):
 * - Requires a live agent registered in ctx.agents for the target session.
 * - Does not auto-create sessions; the user configures the target session id.
 */

import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { InboundMessage, ReplyHandle } from './types.ts'
import { LOG_TAG } from './types.ts'

// ============================================================
// Constants
// ============================================================

/** Maximum reply length (platform-safe for most IM channels). */
const MAX_REPLY_LENGTH = 4000

/** Poll interval while waiting for the agent to finish a turn. */
const REPLY_POLL_INTERVAL_MS = 500

/** Maximum time to wait for an agent reply before giving up. */
const REPLY_TIMEOUT_MS = 10 * 60 * 1000

// ============================================================
// Dispatcher
// ============================================================

export interface MessageDispatcherOptions {
  /** Resolve the current target session id (from settings). */
  resolveTargetSessionId: () => string
  /** Look up a live agent by session id. */
  getAgent: (sessionId: string) => Agent | undefined
}

export class MessageDispatcher {
  private resolveTargetSessionId: () => string
  private getAgent: (sessionId: string) => Agent | undefined

  constructor(options: MessageDispatcherOptions) {
    this.resolveTargetSessionId = options.resolveTargetSessionId
    this.getAgent = options.getAgent
  }

  /**
   * Dispatch an inbound message to the target agent and wire the reply back.
   * Fire-and-forget: failures are logged, never thrown to the channel.
   */
  dispatch(msg: InboundMessage, reply: ReplyHandle): void {
    const sessionId = this.resolveTargetSessionId()

    if (!sessionId) {
      console.warn(
        `${LOG_TAG} No target session configured — dropping message ` +
        `channel=${msg.channel}, chatId=${msg.chatId}`,
      )
      return
    }

    const agent = this.getAgent(sessionId)
    if (!agent) {
      console.warn(
        `${LOG_TAG} Target session ${sessionId} has no live agent — dropping message ` +
        `channel=${msg.channel}, chatId=${msg.chatId}`,
      )
      return
    }

    // Direct messages are rendered as ordinary user messages (same as typing
    // in the conversation box): user source, no channel prefix. Group chats
    // keep the sender prefix so the AI knows who is speaking.
    const messageText =
      msg.chatType === 'group' && msg.fromName
        ? `[${msg.fromName}] ${msg.body}`
        : msg.chatType === 'group'
          ? `[${msg.body}]`
          : msg.body

    console.log(
      `${LOG_TAG} Routing: channel=${msg.channel}, chatId=${msg.chatId}, ` +
      `chatType=${msg.chatType} → session=${sessionId}, msgLen=${messageText.length}`,
    )

    // Record the surface position before injecting so reply capture can
    // find the assistant message that follows this injection.
    const beforeSeq = agent.session.seq

    // Capture the agent's finished reply and send it back.
    const replySubscription = this.observeNextAssistantMessage(agent, beforeSeq, (text) => {
      const replyText = text.slice(0, MAX_REPLY_LENGTH)
      reply.send(replyText).catch((err: unknown) => {
        console.error(
          `${LOG_TAG} Failed to send reply: channel=${reply.channel}, chatId=${reply.chatId}`,
          err,
        )
      })
    })

    // Inject via followup (wakes an idle agent as a next-turn input).
    // User source renders the message like the user typed it themselves.
    const userMessage = createUserMessage({
      content: [{ type: 'text', text: messageText }],
      source: msg.chatType === 'group'
        ? { kind: 'plugin', plugin: 'message-channels' }
        : { kind: 'user' },
    })
    try {
      agent.followup(userMessage)
    } catch (err) {
      console.error(`${LOG_TAG} followup failed: session=${sessionId}`, err)
      replySubscription.dispose()
    }
  }

  // ── Reply capture ──────────────────────────────────────────────────────

  /**
   * Observe the next assistant message appended after `afterSeq` and invoke
   * `onReply` with its text. Polls `session.deriveMessages()` until the agent
   * produces a new assistant message or the timeout elapses.
   */
  private observeNextAssistantMessage(
    agent: Agent,
    afterSeq: number,
    onReply: (text: string) => void,
  ): { dispose: () => void } {
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const startedAt = Date.now()

    const finish = (): void => {
      if (disposed) return

      try {
        const text = this.readNewestAssistantText(agent, afterSeq)
        if (text !== null) {
          onReply(text)
          return
        }
      } catch (err) {
        console.error(`${LOG_TAG} Reply capture read failed:`, err)
      }

      if (Date.now() - startedAt > REPLY_TIMEOUT_MS) {
        console.warn(`${LOG_TAG} Reply capture timed out for session ${agent.id}`)
        return
      }

      timer = setTimeout(finish, REPLY_POLL_INTERVAL_MS)
    }

    timer = setTimeout(finish, REPLY_POLL_INTERVAL_MS)

    return {
      dispose: () => {
        disposed = true
        if (timer) clearTimeout(timer)
      },
    }
  }

  /** Read the newest assistant text block appended after `afterSeq`, if any. */
  private readNewestAssistantText(agent: Agent, afterSeq: number): string | null {
    const messages = agent.session.deriveMessages()
    // The newest assistant/message event determines the position of the
    // newest assistant surface node; find its seq once.
    const newestAssistantEvent = agent.session.events.findLast((e) => e.type === 'assistant/message')
    if (newestAssistantEvent === undefined || newestAssistantEvent.seq <= afterSeq) {
      return null
    }
    // Scan from the newest message backwards for an assistant message.
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      if (message === undefined || message.role !== 'assistant') continue
      const text = this.extractText(message.content)
      if (!text.trim()) continue
      return text
    }
    return null
  }

  /** Extract concatenated text from ContentBlock[] (text blocks only). */
  private extractText(content: readonly unknown[]): string {
    if (!Array.isArray(content)) return ''
    return content
      .filter((block): block is { type: 'text'; text: string } =>
        typeof block === 'object' && block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string',
      )
      .map((block) => block.text)
      .join('\n')
  }
}

// ============================================================
// Module helpers
// ============================================================

/**
 * Build a dispatcher backed by a Cordis context.
 * @param ctx - Host context exposing the agents registry.
 * @param resolveTargetSessionId - resolves the configured target session id.
 */
export function createDispatcher(
  ctx: { agents?: { get(sessionId: string): Agent | undefined } },
  resolveTargetSessionId: () => string,
): MessageDispatcher {
  return new MessageDispatcher({
    resolveTargetSessionId,
    getAgent: (sessionId: string) => ctx.agents?.get(sessionId),
  })
}
