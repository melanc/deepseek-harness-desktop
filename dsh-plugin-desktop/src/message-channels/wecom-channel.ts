/**
 * message-channels -- WeComBotChannel
 *
 * WebSocket adapter for WeCom's intelligent bot protocol
 * (`wss://openws.work.weixin.qq.com`). Ported from DevX
 * (`apps/runtime/sources/wecom-bot.source.ts`) and adapted to the DSH
 * plugin model: the adapter is constructed with a config resolver, and
 * inbound messages are handed to the message-channels dispatcher.
 *
 * Protocol (aligned with @wecom/aibot-node-sdk):
 * - WebSocket long connection (JSON, no XML/AES)
 * - `aibot_subscribe` for authentication (bot_id + secret)
 * - `aibot_msg_callback` for receiving messages
 * - `aibot_respond_msg` for replying (same req_id)
 * - Application-level heartbeat: `{ cmd: "ping" }` every 30 seconds
 * - Only ONE WebSocket connection per bot allowed
 * - req_id expires after 5 minutes (WeCom protocol limit)
 */

import WebSocket from 'ws'
import type { MessageChannelAdapter, ChannelId, InboundMessage, ReplyHandle, WecomBotConfig } from './types.ts'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DEFAULT_WS_URL = 'wss://openws.work.weixin.qq.com'
const HEARTBEAT_INTERVAL_MS = 30_000
const RECONNECT_BASE_DELAY_MS = 2_000
const RECONNECT_MAX_DELAY_MS = 30_000
const MAX_RECONNECT_ATTEMPTS = 100
const REQ_ID_TTL_MS = 5 * 60 * 1000
const REQ_ID_CLEANUP_INTERVAL_MS = 60_000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ReqIdEntry {
  reqId: string
  ts: number
}

/** Callback that resolves the current WeCom bot config at runtime. */
export type WecomConfigResolver = () => WecomBotConfig | null

/** Callback receiving a normalized inbound message + reply handle. */
export type InboundHandler = (msg: InboundMessage, reply: ReplyHandle) => void

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

let reqIdCounter = 0

/** Generate a prefixed req_id (same pattern as official SDK's generateReqId). */
function generateReqId(prefix: string): string {
  return `${prefix}_${Date.now()}_${++reqIdCounter}`
}

// ---------------------------------------------------------------------------
// Adapter
// ---------------------------------------------------------------------------

export class WecomBotChannel implements MessageChannelAdapter {
  readonly channel: ChannelId = 'wecom-bot'

  private inbound: InboundHandler | null = null
  private configResolver: WecomConfigResolver
  private ws: WebSocket | null = null
  private active = false
  private reconnectAttempts = 0
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private reqIdCleanupTimer: ReturnType<typeof setInterval> | null = null

  /** chatId → { reqId, ts } mapping for replies; entries expire after 5 min. */
  private reqIdMap = new Map<string, ReqIdEntry>()

  constructor(configResolver: WecomConfigResolver) {
    this.configResolver = configResolver
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  start(emit: InboundHandler): void {
    this.inbound = emit
    this.active = true

    const config = this.configResolver()
    if (!config || !config.enabled || !config.botId || !config.secret) {
      console.log('[WecomBotChannel] Not configured or disabled — skipping start')
      return
    }

    this.connect(config)
    this.reqIdCleanupTimer = setInterval(() => this.cleanupExpiredReqIds(), REQ_ID_CLEANUP_INTERVAL_MS)
    console.log('[WecomBotChannel] Started')
  }

  stop(): void {
    this.active = false
    this.inbound = null

    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.reqIdCleanupTimer) {
      clearInterval(this.reqIdCleanupTimer)
      this.reqIdCleanupTimer = null
    }

    this.destroySocket()
    this.reqIdMap.clear()
    this.reconnectAttempts = 0
    console.log('[WecomBotChannel] Stopped')
  }

  // ── MessageChannelAdapter ────────────────────────────────────────────────

  isConnected(): boolean {
    return this.ws !== null && this.ws.readyState === WebSocket.OPEN
  }

  /**
   * Send a reply to a WeCom chat using `aibot_respond_msg` (requires the
   * req_id captured from the triggering inbound message).
   */
  replyToChat(chatId: string, text: string): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WecomBotChannel] Cannot reply: WebSocket not connected')
      return false
    }

    const entry = this.reqIdMap.get(chatId)
    if (!entry) {
      console.warn(`[WecomBotChannel] Cannot reply: no req_id mapping for chat ${chatId}`)
      return false
    }

    if (Date.now() - entry.ts > REQ_ID_TTL_MS) {
      this.reqIdMap.delete(chatId)
      console.warn(`[WecomBotChannel] Cannot reply: req_id expired for chat ${chatId}`)
      return false
    }

    try {
      this.ws.send(JSON.stringify({
        cmd: 'aibot_respond_msg',
        headers: { req_id: entry.reqId },
        body: {
          msgtype: 'markdown',
          markdown: { content: text },
        },
      }))
      console.log(`[WecomBotChannel] Reply sent to chat ${chatId}`)
      return true
    } catch (err) {
      console.error('[WecomBotChannel] Failed to send reply:', err)
      return false
    }
  }

  /**
   * Push a message proactively using `aibot_send_msg` (self-generated req_id).
   * Protocol constraints: user must have messaged the bot at least once in
   * the target chat; rate limit 30 msgs/min, 1000 msgs/hour.
   */
  pushToChat(chatId: string, text: string, chatType: 'direct' | 'group'): boolean {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[WecomBotChannel] Cannot push: WebSocket not connected')
      return false
    }

    try {
      this.ws.send(JSON.stringify({
        cmd: 'aibot_send_msg',
        headers: { req_id: generateReqId('aibot_send_msg') },
        body: {
          chatid: chatId,
          chat_type: chatType === 'direct' ? 1 : 2,
          msgtype: 'markdown',
          markdown: { content: text },
        },
      }))
      console.log(`[WecomBotChannel] Push sent to chat ${chatId} (${chatType})`)
      return true
    } catch (err) {
      console.error('[WecomBotChannel] Failed to push message:', err)
      return false
    }
  }

  /** Reconnect with a potentially updated config (called after settings save). */
  reconnectWithConfig(): void {
    if (!this.active) return

    this.destroySocket()
    this.stopHeartbeat()
    this.reconnectAttempts = 0

    const config = this.configResolver()
    if (!config || !config.enabled || !config.botId || !config.secret) {
      console.log('[WecomBotChannel] Config disabled or incomplete — disconnecting')
      return
    }

    this.connect(config)
  }

  // ── WebSocket connection ────────────────────────────────────────────────

  private connect(config: WecomBotConfig): void {
    this.destroySocket()

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }

    const wsUrl = config.wsUrl || DEFAULT_WS_URL
    console.log(`[WecomBotChannel] Connecting to ${wsUrl}...`)

    try {
      this.ws = new WebSocket(wsUrl, {
        perMessageDeflate: false,
        skipUTF8Validation: true,
      })
    } catch (err) {
      console.error('[WecomBotChannel] Failed to create WebSocket:', err)
      this.scheduleReconnect()
      return
    }

    this.ws.on('open', () => {
      console.log('[WecomBotChannel] Connected, subscribing...')
      this.reconnectAttempts = 0

      this.ws!.send(JSON.stringify({
        cmd: 'aibot_subscribe',
        headers: { req_id: generateReqId('aibot_subscribe') },
        body: {
          bot_id: config.botId,
          secret: config.secret,
        },
      }))
    })

    this.ws.on('message', (data: WebSocket.Data) => {
      this.handleMessage(data)
    })

    // Respond to server-initiated WebSocket-level pings.
    this.ws.on('ping', () => {
      this.ws?.pong()
    })

    this.ws.on('close', (code: number, reason: Buffer) => {
      console.log(`[WecomBotChannel] Connection closed (code=${code}, reason=${reason.toString()})`)
      this.stopHeartbeat()
      if (this.active) {
        this.scheduleReconnect()
      }
    })

    this.ws.on('error', (err: Error) => {
      console.error('[WecomBotChannel] WebSocket error:', err.message)
    })
  }

  /** Immediately destroy the current socket (skip graceful close handshake). */
  private destroySocket(): void {
    if (this.ws) {
      try {
        this.ws.removeAllListeners()
        this.ws.terminate()
      } catch { /* ignore */ }
      this.ws = null
    }
  }

  private scheduleReconnect(): void {
    if (!this.active) return
    if (this.reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      console.warn('[WecomBotChannel] Max reconnect attempts reached, giving up')
      return
    }

    const delay = Math.min(
      RECONNECT_BASE_DELAY_MS * 2 ** this.reconnectAttempts,
      RECONNECT_MAX_DELAY_MS,
    )
    this.reconnectAttempts += 1

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      if (!this.active) return
      const config = this.configResolver()
      if (!config || !config.enabled || !config.botId || !config.secret) return
      this.connect(config)
    }, delay)
    console.log(`[WecomBotChannel] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`)
  }

  // ── Message handling ────────────────────────────────────────────────────

  private handleMessage(data: WebSocket.Data): void {
    let msg: any
    try {
      msg = JSON.parse(typeof data === 'string' ? data : data.toString())
    } catch {
      console.warn('[WecomBotChannel] Invalid JSON received')
      return
    }

    const reqId: unknown = msg.headers?.req_id ?? ''

    // Authentication response.
    if (typeof reqId === 'string' && reqId.startsWith('aibot_subscribe')) {
      if (msg.errcode === 0) {
        console.log('[WecomBotChannel] Subscribed successfully')
        this.startHeartbeat()
      } else {
        console.error(`[WecomBotChannel] Subscribe failed: errcode=${msg.errcode} errmsg=${msg.errmsg}`)
        this.destroySocket()
      }
      return
    }

    // Heartbeat ack.
    if (typeof reqId === 'string' && reqId.startsWith('ping')) {
      return
    }

    switch (msg.cmd) {
      case 'aibot_msg_callback': {
        this.handleInboundMessage(msg)
        break
      }

      case 'aibot_event_callback': {
        const eventType = msg.body?.event?.eventtype ?? msg.body?.event_type ?? 'unknown'
        console.log(`[WecomBotChannel] Event: ${eventType}`)
        break
      }

      default:
        if (msg.cmd) {
          console.log(`[WecomBotChannel] Unknown cmd: ${msg.cmd}`)
        }
        break
    }
  }

  private handleInboundMessage(msg: any): void {
    if (!this.active) return

    const body = msg.body
    if (!body) return

    const reqId: unknown = msg.headers?.req_id
    const senderId = body.from?.userid
    const senderName = body.from?.name ?? senderId
    // For single chats, chatid may be absent — use sender's userid as chatId.
    const chatId = body.chatid ?? senderId
    const chatType = body.chattype // 'single' or 'group'
    const msgId = body.msgid
    const msgType = body.msgtype

    if (!senderId || !chatId) return

    // Store req_id mapping for replies.
    if (typeof reqId === 'string') {
      this.reqIdMap.set(chatId, { reqId, ts: Date.now() })
    }

    const text = this.extractText(body)

    console.log(
      `[WecomBotChannel] Message: chat=${chatId}, type=${chatType}, ` +
      `from=${senderName}, msgType=${msgType}, len=${text.length}`,
    )

    const inbound: InboundMessage = {
      body: text,
      from: senderId,
      fromName: senderName,
      channel: 'wecom-bot',
      chatType: chatType === 'group' ? 'group' : 'direct',
      chatId,
      messageId: msgId,
      timestamp: Date.now(),
    }

    const reply: ReplyHandle = {
      channel: 'wecom-bot',
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

  private extractText(body: any): string {
    switch (body.msgtype) {
      case 'text':
        return body.text?.content ?? ''
      case 'image':
        return '(图片)'
      case 'voice':
        return '(语音)'
      case 'file':
        return `(文件: ${body.file?.filename ?? '未知'})`
      case 'video':
        return '(视频)'
      case 'link':
        return `(链接: ${body.link?.title ?? body.link?.url ?? ''})`
      default:
        return `(${body.msgtype ?? '未知消息类型'})`
    }
  }

  // ── Heartbeat ───────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.stopHeartbeat()
    this.heartbeatTimer = setInterval(() => {
      if (this.ws && this.ws.readyState === WebSocket.OPEN) {
        try {
          this.ws.send(JSON.stringify({ cmd: 'ping' }))
        } catch { /* ignore */ }
      }
    }, HEARTBEAT_INTERVAL_MS)
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer)
      this.heartbeatTimer = null
    }
  }

  // ── req_id cleanup ──────────────────────────────────────────────────────

  private cleanupExpiredReqIds(): void {
    const now = Date.now()
    for (const [chatId, entry] of this.reqIdMap) {
      if (now - entry.ts > REQ_ID_TTL_MS) {
        this.reqIdMap.delete(chatId)
      }
    }
  }
}
