# 消息通道功能（message-channels）— 本次修改摘要

> 日期: 2026-08-20
> 分支: dev_0820
> 功能: 消息通道（配置与自动机器人收发消息的通道），移植自 DevX 并适配 DSH 插件架构
> 详细设计: [`dsh-plugin-desktop/src/message-channels/DESIGN.md`](../dsh-plugin-desktop/src/message-channels/DESIGN.md)

---

## 1. 本次改了什么

在 `dsh-plugin-desktop`（DSH Desktop 的 Cordis 插件包）中新增 **message-channels 消息通道功能**：配置 IM 机器人（企业微信/飞书），把收到的消息路由到指定的 DSH agent 会话，agent 的回复自动发回 IM 聊天。

### 1.1 新增文件

```
dsh-plugin-desktop/src/message-channels/
  types.ts           共享类型：config schema、InboundMessage、ReplyHandle、MessageChannelAdapter
  wecom-channel.ts   企业微信智能机器人 WebSocket 适配器（aibot_* JSON 协议，双向）
  feishu-channel.ts  飞书机器人适配器（v1 出站 HTTP + token 管理）
  dispatcher.ts      入站分发：路由到目标 agent + 回复捕获
  index.ts           Host 插件：settings namespace + 通道生命周期 + ctx.messageChannels service
  DESIGN.md          设计文档

dsh-plugin-desktop/src/client/message-channels/
  index.tsx          Client 设置页（settings.section，读写配置）

dsh-plugin-desktop/src/ws.d.ts
  ws 包的窄类型声明（避免 @types/ws 依赖）
```

### 1.2 修改的装配文件

| 文件 | 改动 |
|------|------|
| `dsh-plugin-desktop/cordis.patch.yml` | 新增 `- id: message-channels, name: dsh-plugin-desktop/message-channels` 插件行 |
| `dsh-plugin-desktop/tsdown.config.ts` | 新增 `message-channels` 打包入口 |
| `dsh-plugin-desktop/package.json` | 新增 `./message-channels` export + `ws` 依赖 |
| `dsh-plugin-desktop/tsconfig.json` | include 扩展 `src/message-channels/**` |
| `yarn.lock` | ws 依赖锁定 |

---

## 2. 功能范围

| 通道 | 收发 | 实现 |
|------|------|------|
| 企业微信智能机器人 | **双向** | WebSocket 长连接（`aibot_*` JSON 协议），纯 `ws` 实现，零外部 SDK |
| 飞书机器人 | 出站 | HTTP REST（tenant_access_token + im/v1/messages） |
| 入站路由 | — | 消息 → `agent.followup()` 注入 DSH agent 会话 → assistant 回复自动发回 IM |

**v1 限制**：
- 飞书入站（WebSocket 长连接 PbFrame）需 lark SDK，暂缓；
- 要求目标会话有 live agent（不自动创建会话）；
- Client 状态展示/测试按钮需 Host RPC 通道，暂缓。

---

## 3. 使用方式

### 3.1 配置

方式 A：编辑 settings 文档（`~/.dsh/settings.yaml`）：

```yaml
message-channels:
  wecomBot:
    enabled: true
    botId: aib-xxx                # 企业微信后台的 Bot ID
    secret: "你的 secret"
    # wsUrl: wss://openws.work.weixin.qq.com   # 可选，默认即可
  feishuBot:
    enabled: false
    appId: ""
    appSecret: ""
  targetSessionId: ""             # 入站消息路由到的 DSH 会话 ID
```

方式 B：**DSH Desktop 设置页「消息通道」**（已接入设置菜单）：

打开 DSH Desktop → 设置 → 左侧菜单「消息通道」，在表单中配置：

- **企业微信机器人**：启用开关、Bot ID、Secret、（可选）WebSocket URL
- **飞书机器人**：启用开关、App ID、App Secret
- **目标会话 ID**：入站消息路由到的 DSH 会话 ID

表单写入与 `settings.yaml` 相同的 `message-channels` namespace，二者等效。

> 配置保存后自动生效（`scope.watch()` 触发通道重连），无需重启。

### 3.2 使用流程

1. 在企业微信后台创建智能机器人，拿到 `botId`（aib-xxx 格式）和 `secret`；
2. 按上面配置填写，`enabled: true`；
3. **确保目标会话有活动的 agent**：在 DSH 里打开/新建一个会话，`targetSessionId` 填该会话 ID；
4. 在企业微信里给机器人发消息；
5. 消息注入目标 DSH 会话 → agent 处理 → **回复自动发回企业微信**。

### 3.3 验证方法

```bash
cd deepseek-harness-desktop
corepack yarn install
corepack yarn workspace dsh-plugin-desktop check   # 完整验证
# 或单独验证：
corepack yarn workspace dsh-plugin-desktop typecheck
corepack yarn workspace dsh-plugin-desktop build
corepack yarn workspace dsh-plugin-desktop test
corepack yarn workspace dsh-plugin-desktop verify:profile   # 插件生命周期冒烟
```

`verify:profile` 输出中应看到：

```
[WecomBotChannel] Not configured or disabled — skipping start
[FeishuBotChannel] Not configured or disabled — outbound unavailable
[MessageChannels] Plugin activated
```

---

## 4. 验证结果（本次实测）

| 检查 | 结果 |
|------|------|
| `yarn typecheck`（Host + Client） | ✅ |
| `yarn build`（tsdown，lib/message-channels.js 24.9 kB） | ✅ |
| `yarn test`（34 文件 / 299 测试） | ✅ |
| `verify:loader` | ✅ |
| `verify:profile`（插件生命周期） | ✅ |
| `verify:closure`（197 节点闭合） | ✅ |
| `verify:licenses`（524 包） | ✅ |

> 注：`yarn check` 中的 `verify:cli` 需要 Electron 图形会话，headless 环境会卡住，属环境限制，非代码问题。

---

## 5. 后续迭代（Roadmap）

- [ ] 飞书入站：封装 `@larksuiteoapi/node-sdk` WSClient 接入 `start(emit)`
- [ ] Host RPC 通道：`ctx.messageChannels` service 暴露给 Client（状态/测试按钮）
- [ ] 会话自动创建：目标会话不存在时自动 `ctx.agents.create()`
- [ ] 通知通道（email/webhook 单向推送，对齐 DevX notify-channels）
- [ ] 群聊 @提及过滤、消息去重（messageId dedup）
