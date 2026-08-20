/**
 * message-channels -- Host plugin
 *
 * Owns the message-channels feature:
 * - registers the `messageChannels` settings namespace (per-channel bot
 *   config + target session routing);
 * - starts/stops the channel adapters (WeCom bot WebSocket, Feishu bot HTTP);
 * - routes inbound messages to the configured DSH agent session via the
 *   dispatcher;
 * - exposes status + reconnect + test operations to the settings UI through
 *   the Host-side service (`ctx.messageChannels`).
 *
 * Composition: requires `settings` and `agents` from the host. Mounted via
 * the desktop cordis patch (see `cordis.patch.yml`).
 */

import { type Context, Service } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import {
  MESSAGE_CHANNELS_NS,
  MessageChannelsConfig,
  type MessageChannelAdapter,
  type InboundMessage,
  type ReplyHandle,
} from './types.ts'
import { createDispatcher } from './dispatcher.ts'
import { WecomBotChannel } from './wecom-channel.ts'
import { FeishuBotChannel } from './feishu-channel.ts'

/** Stable Cordis plugin name. */
export const name = 'message-channels'

/** Services required from the host. */
export const inject = ['settings', 'agents']

// ============================================================
// Host-facing service surface
// ============================================================

export interface MessageChannelsService {
  /** Whether a channel is configured and its transport is ready. */
  status(channel: string): { configured: boolean; connected: boolean }
  /** Reconnect a channel with the current config (after settings save). */
  reconnect(channel: string): boolean
  /** Test sending a message through a channel (returns success + error). */
  test(channel: string, chatId?: string): Promise<{ success: boolean; error?: string }>
  /** List channels this plugin owns. */
  list(): string[]
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Message-channel status, reconnect, and test operations. */
    messageChannels: MessageChannelsService
  }
}

// ============================================================
// Service implementation
// ============================================================

export class MessageChannelsService extends Service implements MessageChannelsService {
  private readonly resolveConfig: () => MessageChannelsConfig
  private readonly channels: Map<string, MessageChannelAdapter>

  constructor(
    ctx: Context,
    options: {
      resolveConfig: () => MessageChannelsConfig
      channels: Map<string, MessageChannelAdapter>
    },
  ) {
    super(ctx, 'messageChannels')
    this.resolveConfig = options.resolveConfig
    this.channels = options.channels
  }

  status(channel: string): { configured: boolean; connected: boolean } {
    const adapter = this.channels.get(channel)
    if (!adapter) return { configured: false, connected: false }
    const config = this.resolveConfig()
    const configured = adapter.channel === 'wecom-bot'
      ? !!(config.wecomBot.enabled && config.wecomBot.botId && config.wecomBot.secret)
      : !!(config.feishuBot.enabled && config.feishuBot.appId && config.feishuBot.appSecret)
    return { configured, connected: adapter.isConnected() }
  }

  reconnect(channel: string): boolean {
    const adapter = this.channels.get(channel)
    if (!adapter) return false
    adapter.reconnectWithConfig()
    return true
  }

  async test(channel: string, chatId?: string): Promise<{ success: boolean; error?: string }> {
    const adapter = this.channels.get(channel)
    if (!adapter) return { success: false, error: `Unknown channel: ${channel}` }
    if (!chatId) return { success: false, error: 'chatId is required for a send test' }
    const ok = adapter.pushToChat(chatId, '【消息通道测试】连接正常 ✓', 'direct')
    return ok ? { success: true } : { success: false, error: 'Push failed (channel not connected)' }
  }

  list(): string[] {
    return [...this.channels.keys()]
  }
}

// ============================================================
// Plugin entry
// ============================================================

export function apply(ctx: Context): void {
  // ── Settings namespace ──────────────────────────────────────────────────
  const scope = ctx.settings.register(MESSAGE_CHANNELS_NS, MessageChannelsConfig)

  const resolveConfig = (): MessageChannelsConfig => scope.get() ?? {
    wecomBot: { enabled: false, botId: '', secret: '', wsUrl: '' },
    feishuBot: { enabled: false, appId: '', appSecret: '' },
    targetSessionId: '',
  }

  // ── Dispatcher ──────────────────────────────────────────────────────────
  const dispatcher = createDispatcher(
    ctx as { agents?: { get(sessionId: string): Agent | undefined } },
    () => resolveConfig().targetSessionId,
  )

  // ── Channels ────────────────────────────────────────────────────────────
  const channels = new Map<string, MessageChannelAdapter>()
  const wecomChannel = new WecomBotChannel(() => resolveConfig().wecomBot)
  const feishuChannel = new FeishuBotChannel(() => resolveConfig().feishuBot)
  channels.set(wecomChannel.channel, wecomChannel)
  channels.set(feishuChannel.channel, feishuChannel)

  const inboundHandler = (msg: InboundMessage, reply: ReplyHandle): void => {
    dispatcher.dispatch(msg, reply)
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  ctx.effect(() => {
    for (const channel of channels.values()) {
      channel.start(inboundHandler)
    }
    console.log('[MessageChannels] Plugin activated')

    return () => {
      for (const channel of channels.values()) {
        channel.stop()
      }
      console.log('[MessageChannels] Plugin deactivated')
    }
  }, 'message-channels: channel lifecycle')

  // ── Settings change → reconnect ─────────────────────────────────────────
  scope.watch(() => {
    for (const channel of channels.values()) {
      channel.reconnectWithConfig()
    }
  })

  // ── Host-facing service ─────────────────────────────────────────────────
  ctx.plugin(MessageChannelsService, { resolveConfig, channels })
}

// Re-export types for consumers.
export type { MessageChannelAdapter, InboundMessage, ReplyHandle } from './types.ts'
export { MESSAGE_CHANNELS_NS, MessageChannelsConfig } from './types.ts'
export { WecomBotChannel } from './wecom-channel.ts'
export { FeishuBotChannel } from './feishu-channel.ts'
export { MessageDispatcher } from './dispatcher.ts'
