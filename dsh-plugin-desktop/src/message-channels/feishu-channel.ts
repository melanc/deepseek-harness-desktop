/**
 * message-channels -- FeishuBotChannel
 *
 * Feishu/Lark bot adapter. v1 implements the **HTTP REST** surface:
 * - tenant_access_token management (cached, auto-refresh on expiry)
 * - `pushToChat` / reply via `im/v1/messages` (chat_id receive type)
 *
 * Inbound (WebSocket long-connection, PbFrame protobuf) is **not** part of
 * v1: the official `@larksuiteoapi/node-sdk` WSClient handles PbFrame
 * encoding/decoding, and without that SDK (or a vendored protobuf schema)
 * implementing the protocol reliably is out of scope. The channel therefore
 * exposes outbound-only capabilities; `start()` connects nothing and simply
 * reports readiness for sending. Inbound routing can be added later by
 * wrapping the SDK's WSClient (the `InboundHandler` interface already
 * supports it).
 *
 * HTTP API base: https://open.feishu.cn/open-apis
 */

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

  constructor(configResolver: FeishuConfigResolver, fetchImpl: FetchLike = fetch) {
    this.configResolver = configResolver
    this.tokenManager = new FeishuTokenManager(fetchImpl)
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  /**
   * v1: no inbound transport. Keeps the adapter ready for outbound use and
   * reports whether the channel is configured.
   */
  start(_emit: (msg: InboundMessage, reply: ReplyHandle) => void): void {
    const config = this.configResolver()
    if (!config || !config.enabled || !config.appId || !config.appSecret) {
      console.log('[FeishuBotChannel] Not configured or disabled — outbound unavailable')
      return
    }
    console.log('[FeishuBotChannel] Started (outbound HTTP; inbound WS requires lark SDK)')
  }

  stop(): void {
    console.log('[FeishuBotChannel] Stopped')
  }

  // ── MessageChannelAdapter ────────────────────────────────────────────────

  isConnected(): boolean {
    const config = this.configResolver()
    return !!(config?.enabled && config.appId && config.appSecret)
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

  /** Reconnect is a no-op for v1 (no inbound transport). */
  reconnectWithConfig(): void {
    const config = this.configResolver()
    if (config?.appId) this.tokenManager.invalidate(config.appId)
    console.log('[FeishuBotChannel] Config refreshed (token cache cleared)')
  }

  // ── HTTP send ────────────────────────────────────────────────────────────

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
