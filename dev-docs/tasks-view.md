# 会话页「输入」Tab — 本次修改摘要

> 日期: 2026-08-20
> 分支: dev_0820
> 功能: 会话页新增「输入」tab，记录用户每次输入对话的内容

---

## 1. 功能说明

DSH 会话页原有「对话」「轨迹」两个 tab，本次新增第三个 **「输入」** tab：

- **记录用户每次输入**：按时间倒序列出该会话中所有用户输入消息（内容 + 时间）；
- **只显示真实用户输入**：过滤掉插件注入的消息（如 message-channels 转发的 IM 消息、主会话派发的任务），只保留 `source.kind === 'user'` 的用户消息；
- **轻量输入日志**：给用户一个"我在这个会话里问过什么"的快速回顾，尤其适合长会话。

---

## 2. 实现方式

### 2.1 机制

DSH 会话页的 tab 由 `conversation.view` slot 驱动：

- 每个注册的 slot 贡献一个 tab（`{ id, label }`），按 `order` 排序；
- 内置「对话」= id `chat`（order 0），「轨迹」= trajectory 插件（order 10）；
- **「输入」= 新增 id `inputs`（order 20）**，在 desktop client bundle 中注册。

### 2.2 数据源

输入 tab 通过 `api.sessions.history({ sessionId, maxMessages })`（会话历史 RPC）读取事件流，过滤 `user/message` 事件（`source.kind === 'user'`），提取文本内容，按时间倒序展示。

### 2.3 新增/修改文件

```
dsh-plugin-desktop/src/client/tasks-view/
  index.tsx       输入 tab 组件 + conversation.view slot 注册（applyTasksView）

修改：
  dsh-plugin-desktop/src/client/index.ts        调用 applyTasksView(ctx)
  dsh-plugin-desktop/src/client/contracts.ts    SlotMap 扩展 'conversation.view'
```

---

## 3. 验证结果

| 检查 | 结果 |
|------|------|
| `yarn typecheck` | ✅ |
| `yarn build`（client bundle 34 kB） | ✅ |
| `yarn test`（35 文件 / 315 测试） | ✅ |
| renderer-boot 冒烟（7 测试） | ✅ |
| `yarn verify:profile` | ✅ |

---

## 4. 使用方式

打开任一 DSH 会话 → 会话页头部出现第三个 tab **「输入」** → 点击查看该会话的所有用户输入记录（时间 + 内容，倒序）。

> 说明：输入 tab 展示的是**用户主动输入**（source.kind === 'user'）。通过消息通道（IM）转发进来、或主会话派发的消息带 plugin source，不会出现在输入列表中——保证"输入"= 用户真实意图的记录。
