/**
 * message-channels -- shared types
 *
 * Channel-agnostic contracts for the message-channels feature: config
 * schema, inbound message, reply handle, and channel adapter interface.
 * Mirrors the proven shapes from DevX (`src/shared/types/im-channel.ts`,
 * `src/shared/types/inbound-message.ts`) adapted to the DSH plugin model.
 */

import z from '@deepseek-ai/schemastery'
import { settingsNamespace, type SettingsNamespace } from '@deepseek-ai/dsh-settings'

// ============================================================
// Channel identity
// ============================================================

/** Supported bidirectional bot channels. */
export const CHANNEL_IDS = ['wecom-bot', 'feishu-bot'] as const
export type ChannelId = (typeof CHANNEL_IDS)[number]

/** One-way notification channels (same ids as DevX notify channels). */
export const NOTIFY_CHANNEL_IDS = ['email', 'wecom', 'dingtalk', 'feishu', 'webhook'] as const
export type NotifyChannelId = (typeof NOTIFY_CHANNEL_IDS)[number]

// ============================================================
// Config schema (stored under the `messageChannels` settings ns)
// ============================================================

/** WeCom intelligent bot (企业微信智能机器人) config. */
export const WecomBotConfig = z.object({
  enabled: z.boolean().default(false),
  botId: z.string().default(''),
  secret: z.string().role('secret').default(''),
  wsUrl: z.string().default(''),
})
export type WecomBotConfig = {
  enabled: boolean
  botId: string
  secret: string
  wsUrl: string
}

/** Feishu/Lark bot config (WebSocket long-connection mode). */
export const FeishuBotConfig = z.object({
  enabled: z.boolean().default(false),
  appId: z.string().default(''),
  appSecret: z.string().role('secret').default(''),
})
export type FeishuBotConfig = {
  enabled: boolean
  appId: string
  appSecret: string
}

/** Namespace document shape: per-channel bot config + routing. */
export const MessageChannelsConfig = z.object({
  wecomBot: WecomBotConfig.default({ enabled: false, botId: '', secret: '', wsUrl: '' }),
  feishuBot: FeishuBotConfig.default({ enabled: false, appId: '', appSecret: '' }),
  /** Session id that inbound bot messages are routed to. */
  targetSessionId: z.string().default(''),
})
export type MessageChannelsConfig = {
  wecomBot: WecomBotConfig
  feishuBot: FeishuBotConfig
  targetSessionId: string
}

// ============================================================
// Inbound message + reply
// ============================================================

/** Normalized inbound IM message passed to the dispatcher. */
export interface InboundMessage {
  /** Channel identifier: 'wecom-bot' | 'feishu-bot' | ... */
  readonly channel: ChannelId
  /** Platform-side conversation ID. */
  readonly chatId: string
  /** 'direct' (1:1) or 'group' chat. */
  readonly chatType: 'direct' | 'group'
  /** Sender user id on the platform. */
  readonly from: string
  /** Sender display name (may equal from). */
  readonly fromName?: string
  /** Chat display name when available. */
  readonly chatName?: string
  /** Message body text. */
  readonly body: string
  /** Platform message id (dedup key). */
  readonly messageId?: string
  /** Epoch ms. */
  readonly timestamp: number
}

/** Reply handle used to send the agent's answer back to the channel. */
export interface ReplyHandle {
  readonly channel: ChannelId
  readonly chatId: string
  send(text: string): Promise<void>
}

// ============================================================
// Channel adapter interface
// ============================================================

/**
 * Bidirectional channel adapter. Each adapter owns its WebSocket/HTTP
 * connection lifecycle and translates platform events into normalized
 * InboundMessage objects handed to the dispatcher.
 */
export interface MessageChannelAdapter {
  /** Channel identifier. */
  readonly channel: ChannelId
  /** Whether the underlying connection is ready to send. */
  isConnected(): boolean
  /**
   * Push a message proactively to a chat (no prior inbound message needed).
   * @param chatId - platform conversation id
   * @param text - markdown text
   * @param chatType - conversation type
   */
  pushToChat(chatId: string, text: string, chatType: 'direct' | 'group'): boolean
  /**
   * Reconnect with the current config. Called after the user saves
   * channel settings so changes take effect without a restart.
   */
  reconnectWithConfig(): void
  /** Start the adapter. `emit` receives normalized inbound messages. */
  start(emit: (msg: InboundMessage, reply: ReplyHandle) => void): void
  /** Stop the adapter and release timers/sockets. */
  stop(): void
}

// ============================================================
// Shared constants
// ============================================================

/** Settings namespace id for the message-channels feature. */
export const MESSAGE_CHANNELS_NS: SettingsNamespace = settingsNamespace('message-channels')

/** Logger tag prefix. */
export const LOG_TAG = '[MessageChannels]'
