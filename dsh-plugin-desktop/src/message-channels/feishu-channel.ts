/**
 * message-channels -- FeishuBotChannel
 *
 * Feishu/Lark bot adapter, bidirectional:
 * - **Inbound**: WebSocket long-connection via the official
 *   `@larksuiteoapi/node-sdk` `WSClient` (handles PbFrame protobuf,
 *   heartbeat, reconnect, and message fragmentation). Same integration as
 *   DevX `apps/runtime/sources/feishu-bot.source.ts`.
 * - **Outbound**: HTTP REST via `im/v1/messages` with tenant_access_token
 *   management (cached, auto-refresh on expiry).
 *
 * HTTP API base: https://open.feishu.cn/open-apis
 */

import * as Lark from '@larksuiteoapi/node-sdk'
import type { MessageChannelAdapter, ChannelId, InboundMessage, ReplyHandle, FeishuBotConfig } from './types.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FEISHU_API_BASE = 'https://open.feishu.cn/open-apis'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback that resolves the current Feishu bot config at runtime. */
export type FeishuConfigResolver = () => FeishuBotConfig | null

/** Minimal fetch surface (global fetch in Node 22+, or injected). */
type FetchLike = typeof fetch

// ---------------------------------------------------------------------------
// Token cache
// ---------------------------------------------------------------------------

interface CachedToken {
  token: string
  expiresAt: number
}

/**
 * Simple tenant_access_token cache per appId. Mirrors DevX
 * `services/notify-channels/token-manager.ts` behavior.
 */
class FeishuTokenManager {
  private cache = new Map<string, CachedToken>()
  private fetchImpl: FetchLike

  constructor(fetchImpl: FetchLike) {
    this.fetchImpl = fetchImpl
  }

  async getToken(appId: string, appSecret: string): Promise<string> {
    const cached = this.cache.get(appId)
    // Refresh 60s before expiry to avoid mid-flight expiry.
    if (cached && cached.expiresAt > Date.now() + 60_000) {
      return cached.token
    }

    const res = await this.fetchImpl(`${FEISHU_API_BASE}/auth/v3/tenant_access_token/internal`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ app_id: appId, app_secret: appSecret }),
    })
    const data = await res.json() as {
      code: number
      msg: string
      tenant_access_token?: string
      expire?: number
    }
    if (data.code !== 0 || !data.tenant_access_token) {
      throw new Error(`Feishu token failed: ${data.code} ${data.msg}`)
    }
    this.cache.set(appId, {
      token: data.tenant_access_token,
      expiresAt: Date.now() + (data.expire ?? 7200) * 1000,
    })
    return data.tenant_access_token
  }

  invalidate(appId: string): void {
    this.cache.delete(appId)
  }
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class FeishuBotChannel implements MessageChannelAdapter {
  readonly channel: ChannelId = 'feishu-bot'

  private configResolver: FeishuConfigResolver
  private tokenManager: FeishuTokenManager
  private wsClient: Lark.WSClient | null = null
  private active = false
  private inbound: ((msg: InboundMessage, reply: ReplyHandle) => void) | null = null

  constructor(configResolver: FeishuConfigResolver, fetchImpl: FetchLike = fetch) {
    this.configResolver = configResolver
    this.tokenManager = new FeishuTokenManager(fetchImpl)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /** Start the WS long-connection for inbound messages. */
  start(emit: (msg: InboundMessage, reply: ReplyHandle) => void): void {
    this.inbound = emit
    this.active = true

    const config = this.configResolver()
    if (!config || !config.enabled || !config.appId || !config.appSecret) {
      console.log('[FeishuBotChannel] Not configured or disabled — skipping start')
      return
    }

    this.createClient(config)
    console.log('[FeishuBotChannel] Started (WS long-connection)')
  }

  /** Stop the WS client and release state. */
  stop(): void {
    this.active = false
    this.inbound = null

    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true })
      } catch { /* ignore */ }
      this.wsClient = null
    }

    console.log('[FeishuBotChannel] Stopped')
  }

  // ── MessageChannelAdapter ────────────────────────────────────────────────

  isConnected(): boolean {
    return this.wsClient?.getConnectionStatus().state === 'connected'
  }

  /** Send a reply to a Feishu chat (HTTP API, chat_id receive type). */
  replyToChat(chatId: string, text: string): boolean {
    void this.sendMessage(chatId, text).catch((err: unknown) => {
      console.error(`[FeishuBotChannel] Reply failed for chat ${chatId}:`, err)
    })
    return true
  }

  /** Push a message proactively to a Feishu chat. */
  pushToChat(chatId: string, text: string, _chatType: 'direct' | 'group'): boolean {
    void this.sendMessage(chatId, text).catch((err: unknown) => {
      console.error(`[FeishuBotChannel] Push failed for chat ${chatId}:`, err)
    })
    return true
  }

  /** Reconnect with the current config (after settings save). */
  reconnectWithConfig(): void {
    if (!this.active) return

    if (this.wsClient) {
      try {
        this.wsClient.close({ force: true })
      } catch { /* ignore */ }
      this.wsClient = null
    }

    const config = this.configResolver()
    if (!config || !config.enabled || !config.appId || !config.appSecret) {
      console.log('[FeishuBotChannel] Config disabled or incomplete — disconnecting')
      return
    }
    if (config.appId) this.tokenManager.invalidate(config.appId)

    this.createClient(config)
  }

  // ── Client creation ─────────────────────────────────────────────────────

  /** Create and start the SDK WSClient with an event dispatcher. */
  private createClient(config: FeishuBotConfig): void {
    console.log('[FeishuBotChannel] Creating WSClient...')

    try {
      this.wsClient = new Lark.WSClient({
        appId: config.appId,
        appSecret: config.appSecret,
        autoReconnect: true,
        onReady: () => {
          console.log('[FeishuBotChannel] WebSocket connected and ready')
        },
        onError: (err: Error) => {
          console.error('[FeishuBotChannel] WSClient error:', err.message)
        },
        onReconnecting: () => {
          console.log('[FeishuBotChannel] Reconnecting...')
        },
        onReconnected: () => {
          console.log('[FeishuBotChannel] Reconnected')
        },
      })

      const eventDispatcher = new Lark.EventDispatcher({})
        .register({
          'im.message.receive_v1': (data: unknown) => {
            this.handleInboundMessage(data)
          },
        })

      this.wsClient.start({ eventDispatcher }).catch((err: Error) => {
        console.error('[FeishuBotChannel] Failed to start WSClient:', err.message)
      })
    } catch (err) {
      console.error('[FeishuBotChannel] Failed to create WSClient:', err)
    }
  }

  // ── Inbound message handling ────────────────────────────────────────────

  /**
   * Handle an inbound `im.message.receive_v1` event from the WS long
   * connection: extract sender/chat/text and hand a normalized
   * InboundMessage + ReplyHandle to the dispatcher.
   */
  private handleInboundMessage(data: unknown): void {
    if (!this.active) return

    const raw = data as {
      message?: Record<string, unknown>
      sender?: Record<string, unknown>
    }
    const message = raw.message
    const sender = raw.sender
    if (!message || !sender) return

    const senderId = (sender.sender_id as Record<string, unknown> | undefined)?.open_id as string | undefined
    const senderName = sender.sender_id
      ? ((sender.sender_id as Record<string, unknown>).union_id as string) ?? senderId
      : senderId

    const chatId = message.chat_id as string | undefined
    const chatType = message.chat_type as string | undefined // 'p2p' or 'group'
    const msgType = (message.message_type ?? message.msg_type) as string | undefined
    const msgId = message.message_id as string | undefined
    const rawContent = message.content as string | undefined

    if (!chatId || !senderId) return

    // Extract text from content (Feishu text content is a JSON string).
    let text = ''
    if (msgType === 'text' && rawContent) {
      if (typeof rawContent === 'string') {
        try {
          const parsed = JSON.parse(rawContent) as { text?: string }
          text = parsed.text ?? ''
        } catch {
          text = rawContent
        }
      } else {
        text = (rawContent as unknown as Record<string, unknown>)?.text as string ?? ''
      }
    } else if (msgType === 'image') {
      text = '(图片)'
    } else if (msgType === 'file') {
      text = '(文件)'
    } else if (rawContent) {
      text = `(${msgType ?? 'unknown'})`
    }

    if (!text.trim()) return

    // Acknowledge receipt with a Fire reaction (fire-and-forget).
    if (msgId) {
      void this.addReaction(msgId, 'Fire').catch(() => {})
    }

    console.log(
      `[FeishuBotChannel] Message: chat=${chatId}, type=${chatType}, ` +
      `from=${senderId}, msgType=${msgType}, len=${text.length}`,
    )

    const inbound: InboundMessage = {
      body: text,
      from: senderId,
      ...(senderName === undefined ? {} : { fromName: senderName }),
      channel: 'feishu-bot',
      chatType: chatType === 'group' ? 'group' : 'direct',
      chatId,
      ...(msgId === undefined ? {} : { messageId: msgId }),
      timestamp: Date.now(),
    }

    const reply: ReplyHandle = {
      channel: 'feishu-bot',
      chatId,
      send: async (replyText: string): Promise<void> => {
        const sent = this.replyToChat(chatId, replyText)
        if (!sent) {
          throw new Error(`Failed to send reply to chat ${chatId}`)
        }
      },
    }

    this.inbound?.(inbound, reply)
  }

  // ── HTTP send ────────────────────────────────────────────────────────────

  /**
   * Add a reaction (emoji) to a Feishu message to acknowledge receipt.
   * Fire-and-forget — failures are logged but never thrown.
   */
  private async addReaction(messageId: string, emojiType: string): Promise<boolean> {
    const config = this.configResolver()
    if (!config || !config.enabled) return false

    try {
      const token = await this.tokenManager.getToken(config.appId, config.appSecret)
      const url = `${FEISHU_API_BASE}/im/v1/messages/${messageId}/reactions`
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          reaction_type: { emoji_type: emojiType },
        }),
      })
      const data = await res.json() as { code: number; msg: string }

      // Token expired — refresh and retry once.
      if (data.code === 99991668 || data.code === 99991663) {
        this.tokenManager.invalidate(config.appId)
        const freshToken = await this.tokenManager.getToken(config.appId, config.appSecret)
        const retryRes = await fetch(url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            reaction_type: { emoji_type: emojiType },
          }),
        })
        const retryData = await retryRes.json() as typeof data
        if (retryData.code !== 0) {
          console.warn(`[FeishuBotChannel] Reaction failed after retry: ${retryData.code} ${retryData.msg}`)
          return false
        }
        console.log(`[FeishuBotChannel] Reaction added on retry: ${emojiType} on ${messageId}`)
        return true
      }

      if (data.code !== 0) {
        // 1000001 = reaction already exists (duplicate), not an error.
        if (data.code !== 1000001) {
          console.warn(`[FeishuBotChannel] Reaction failed: ${data.code} ${data.msg}`)
        }
        return false
      }

      console.log(`[FeishuBotChannel] Reaction added: ${emojiType} on ${messageId}`)
      return true
    } catch (err) {
      console.warn('[FeishuBotChannel] Reaction error:', err instanceof Error ? err.message : String(err))
      return false
    }
  }

  private async sendMessage(chatId: string, text: string): Promise<boolean> {
    const config = this.configResolver()
    if (!config || !config.enabled) return false

    try {
      const token = await this.tokenManager.getToken(config.appId, config.appSecret)
      const res = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          receive_id: chatId,
          msg_type: 'text',
          content: JSON.stringify({ text }),
        }),
      })
      const data = await res.json() as { code: number; msg: string; data?: { message_id?: string } }

      // Token expired — refresh and retry once.
      if (data.code === 99991668 || data.code === 99991663) {
        this.tokenManager.invalidate(config.appId)
        const freshToken = await this.tokenManager.getToken(config.appId, config.appSecret)
        const retryRes = await fetch(`${FEISHU_API_BASE}/im/v1/messages?receive_id_type=chat_id`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${freshToken}`,
          },
          body: JSON.stringify({
            receive_id: chatId,
            msg_type: 'text',
            content: JSON.stringify({ text }),
          }),
        })
        const retryData = await retryRes.json() as typeof data
        if (retryData.code !== 0) {
          console.error(`[FeishuBotChannel] Send failed after retry: ${retryData.code} ${retryData.msg}`)
          return false
        }
        console.log(`[FeishuBotChannel] Sent on retry, messageId=${retryData.data?.message_id}`)
        return true
      }

      if (data.code !== 0) {
        console.error(`[FeishuBotChannel] Send failed: ${data.code} ${data.msg}`)
        return false
      }
      console.log(`[FeishuBotChannel] Sent successfully, messageId=${data.data?.message_id}`)
      return true
    } catch (err) {
      console.error('[FeishuBotChannel] Send error:', err instanceof Error ? err.message : String(err))
      return false
    }
  }
}
