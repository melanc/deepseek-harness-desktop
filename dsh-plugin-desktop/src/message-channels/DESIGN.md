# message-channels — Design Document

> 状态: v1 已实现（Host 侧完整闭环 + Client 配置页）
> 日期: 2026-08-20
> 位置: `dsh-plugin-desktop/src/message-channels/`
> 关联: DevX `src/main/apps/runtime/sources/`（移植来源）、[插件开发指南](../docs/plugin-development.md)

---

## 1. 概述

消息通道功能让 DSH Desktop 通过即时通讯机器人（企业微信、飞书）收发消息：机器人收到的消息被路由到指定的 DSH agent 会话，agent 的回复再发回 IM 聊天。

**来源**：功能移植自 DevX（`apps/runtime/sources/wecom-bot.source.ts`、`feishu-bot.source.ts`、`dispatch-inbound.ts`），适配 DSH 的插件模型（settings namespace + Cordis service + agent.followup）。

**v1 范围**：

| 通道 | 收发 | 实现 |
|------|------|------|
| WeCom 企业微信智能机器人 | 双向 | WebSocket 长连接（`aibot_*` JSON 协议），纯 `ws` 实现，零外部 SDK |
| Feishu 飞书机器人 | 出站 | HTTP REST（tenant_access_token + im/v1/messages）；入站 WS 需 lark SDK（PbFrame protobuf），暂缓 |

---

## 2. 架构

```
IM 平台 (企业微信/飞书)
   │  WebSocket / HTTP
   ▼
MessageChannelAdapter (wecom-channel / feishu-channel)
   │  InboundMessage + ReplyHandle
   ▼
MessageDispatcher ──→ ctx.agents.get(targetSessionId)
   │                    │  createUserMessage + agent.followup()
   │                    ▼
   │                 DSH agent 会话（唤醒驱动器，进入下一轮）
   │                    │  assistant/message
   │                    ▼
   └── 读取最新 assistant 文本 → reply.send() → IM 平台
```

**配置流**：`ctx.settings` namespace `message-channels`（schema: wecomBot + feishuBot + targetSessionId）→ `scope.watch()` 变更时自动 `reconnectWithConfig()`，改配置即时生效。

---

## 3. 文件结构

```
src/message-channels/
  types.ts           共享类型：config schema、InboundMessage、ReplyHandle、MessageChannelAdapter、MESSAGE_CHANNELS_NS
  wecom-channel.ts   WeCom 企业微信机器人 WebSocket 适配器（aibot_* JSON 协议）
  feishu-channel.ts  Feishu 飞书机器人适配器（v1 出站 HTTP + token 管理）
  dispatcher.ts      入站分发：路由到 target agent + 回复捕获
  index.ts           Host 插件：settings namespace + 通道生命周期 + ctx.messageChannels service

src/client/message-channels/
  index.tsx          Client 设置页（settings.section，读/写 message-channels namespace）
```

---

## 4. Host 插件（index.ts）

- **插件名** `message-channels`，注入 `settings` + `agents`。
- **Settings namespace** `message-channels`：

```ts
MessageChannelsConfig = {
  wecomBot: { enabled, botId, secret (role: secret), wsUrl },
  feishuBot: { enabled, appId, appSecret (role: secret) },
  targetSessionId: string,   // 入站消息路由目标会话
}
```

- **生命周期**：`ctx.effect()` 启动所有通道 → 停用时 stop。
- **配置热更新**：`scope.watch()` → 所有通道 `reconnectWithConfig()`（WeCom 重连 WS；Feishu 清 token 缓存）。
- **Service** `ctx.messageChannels`（`MessageChannelsService`，extends Service）：

```ts
status(channel): { configured, connected }
reconnect(channel): boolean
test(channel, chatId?): Promise<{ success, error? }>
list(): string[]
```

---

## 5. 通道适配器

### 5.1 WecomBotChannel（wecom-channel.ts）

协议对齐 `@wecom/aibot-node-sdk`（纯 JSON WebSocket，无 XML/AES）：

| 帧 | 用途 |
|----|------|
| `aibot_subscribe` | 认证（bot_id + secret） |
| `aibot_msg_callback` | 接收消息 |
| `aibot_respond_msg` | 回复（复用 req_id） |
| `aibot_send_msg` | 主动推送（自生成 req_id） |
| `{ cmd: "ping" }` | 30s 应用层心跳 |

关键行为（移植自 DevX，经验证）：
- **req_id 映射**：chatId → reqId，5 分钟 TTL（企业微信协议限制），60s 周期清理；
- **回复**用 `aibot_respond_msg`（需入站 req_id）；**主动推送**用 `aibot_send_msg`（无需 req_id）；
- **连接治理**：`terminate()` 而非 `close()`（防旧连接收到保留 opcode 的过期帧）；指数退避重连（2s 起，30s 封顶，100 次上限）；响应服务端 ping；
- 单聊 chatid 缺失时用发送者 userid 作 chatId。

### 5.2 FeishuBotChannel（feishu-channel.ts）

v1 仅出站：
- **token 管理**：`tenant_access_token` 按 appId 缓存，过期前 60s 刷新，`99991668/99991663`（token 失效）时失效重试；
- **发送**：`POST /im/v1/messages?receive_id_type=chat_id`。

**入站暂缓**：飞书 WebSocket 长连接用 PbFrame protobuf 帧，官方 `@larksuiteoapi/node-sdk` 的 WSClient 处理编解码。无 SDK 时可靠实现协议不在 v1 范围。`MessageChannelAdapter` 接口已支持入站（`start(emit)`），后续包一层 SDK WSClient 即可接入。

---

## 6. 入站分发（dispatcher.ts）

```
dispatch(msg, reply):
  1. targetSessionId = settings.targetSessionId
  2. agent = ctx.agents.get(targetSessionId)   // 需 live agent
  3. 群聊加发送者前缀 "[name] "
  4. 记录 beforeSeq = agent.session.seq
  5. createUserMessage({ content: [text], source: { kind: 'plugin', plugin: 'message-channels' } })
  6. agent.followup(userMessage)               // 唤醒驱动器
  7. observeNextAssistantMessage: 轮询 session.deriveMessages()
     直到出现 seq > beforeSeq 的 assistant/message → extractText → reply.send()
```

**限制（v1）**：
- 要求 target session 有 live agent（不自动创建会话）；
- 回复捕获用轮询（500ms 间隔，10min 超时）——依赖 `deriveMessages()`，足够简单可靠；未来可改用 `agent/turn-stopping` 事件更精确。

---

## 7. Client 设置页（client/message-channels/index.tsx）

- 注册 `settings.section`（id `message-channels`，order 60），通过 `ctx.settingsScope.bind({ namespace: 'message-channels' })` 读写配置；
- **已接入主 client bundle**（`client/index.ts` 的 `applyMessageChannelsSection`），设置菜单显示「消息通道」项；
- `settingsScope` 动态解析（`ctx.get`），settings 外壳缺失时 section 静默跳过，不阻塞 client bundle 加载；
- 字段：每个通道的启用开关 + 凭据；目标会话 ID；
- **注意**：client 侧 `scope.set(field, value)` 只支持单段路径，嵌套对象（wecomBot 等）整体写入；
- **暂缓**：状态展示/测试按钮需要 Host RPC channel（`ctx.connection.rpc.handle` + client remote），留待下一迭代。

---

## 8. 装配

- `cordis.patch.yml`：新增 `- id: message-channels, name: dsh-plugin-desktop/message-channels`（在 desktop-updates 之后）；
- `tsdown.config.ts`：新增 `message-channels: 'src/message-channels/index.ts'` 入口；
- `package.json`：新增 `./message-channels` export + `ws` dependency；
- `tsconfig.json`：include 扩展 `src/message-channels/**`；
- 本地 `src/ws.d.ts`：ws 包的窄类型声明（避免 @types/ws 依赖）。

---

## 9. 验证结果

| 检查 | 结果 |
|------|------|
| `yarn typecheck` | ✅ 通过（Host + Client） |
| `yarn build`（tsdown） | ✅ `lib/message-channels.js` 24.9 kB |
| `yarn test` | ✅ 34 文件 / 299 测试 |
| `yarn verify:loader` | ✅ |
| `yarn verify:profile` | ✅ 插件完整生命周期日志（start→stop） |
| `yarn verify:closure` | ✅ 197 first-party 节点闭合 |
| `yarn verify:licenses` | ✅ 524 包 |

---

## 10. 使用方式（v1）

1. 在 DSH Desktop 设置（或 `~/.dsh/settings.yaml` 的 `message-channels:` 节）配置企业微信机器人凭据：

```yaml
message-channels:
  wecomBot:
    enabled: true
    botId: aib-xxx
    secret: "你的 secret"
  targetSessionId: "<目标 DSH 会话 ID>"
```

2. 确保目标会话有活动的 agent（在 DSH 里开一个会话）；
3. 在企微里给机器人发消息 → 消息注入目标会话 → agent 回复自动发回企微。

---

## 11. 后续迭代（Roadmap）

- [ ] Feishu 入站：封装 `@larksuiteoapi/node-sdk` WSClient 接入 `start(emit)`；
- [ ] Host RPC channel：`ctx.messageChannels` service 暴露给 Client（状态/测试按钮）；
- [ ] 会话自动创建：target session 不存在时自动 `ctx.agents.create()`；
- [ ] 通知通道（email/webhook 等单向推送）——与 DevX notify-channels 对齐；
- [ ] 群聊 @提及过滤、消息去重（messageId dedup）。
