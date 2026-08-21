# main-session — Design Document

> 状态: v1 已实现（主会话 agent + 编排工具集 + 服务）
> 日期: 2026-08-20
> 位置: `dsh-plugin-desktop/src/main-session/`
> 关联: [消息通道 DESIGN.md](../message-channels/DESIGN.md)（复用 followup 注入 + 回复轮询模式）

---

## 1. 概述

主会话（main-session）是一个**系统级会话**，区别于工作区里的专用会话。它的定位是**统一入口 + 全局管理 + 简洁调度**：

- **统一入口**：用户只需在主会话中发布任务，无需在多个工作区会话之间来回切换；
- **全局会话记忆**：主会话自身的会话历史就是全局记忆——它记录所有委派过的任务和结果，形成跨工作区的上下文；
- **管理职责**：主会话只做调度和汇总，**具体执行交给工作区会话**；
- **自主创建**：主会话可以自己创建新的工作区会话（`workspace_create_session`），然后给它发布任务；
- **简洁汇报**：主会话**不回显实时执行细节**——只汇报执行进度和结果摘要；完整结果留在工作区会话，主会话把用户引导过去查看（附 workspaceName/sessionId）。

**编排能力**：

| 能力 | 工具 | 说明 |
|------|------|------|
| 查看 | `workspace_list_sessions` | 枚举所有工作区会话（标题、活跃度、是否 live） |
| 发送 | `workspace_send_message` | 给目标会话注入消息（`agent.followup`） |
| 收集 | `workspace_await_reply` | 等待目标会话的 assistant 回复（**返回摘要** + 工作区跳转信息） |
| **创建** | `workspace_create_session` | **创建工作区会话（含 workspace 注册/挂载），发布初始任务** |

**典型场景**：用户给主会话发布任务 → 主会话查看现有工作区会话 → 若已有会话在负责则 `workspace_send_message`，若没有则 `workspace_create_session` 新建 → `workspace_await_reply` 收集**结果摘要** → 一两句话汇报进度和结论，并告知用户完整结果在哪个工作区会话。整个过程中用户只与主会话交互。

---

## 2. 架构

```
用户 ──→ 主会话（root agent，固定 id: main-session）
              │  主会话专属工具（agent.ctx scope）
              ├── workspace_list_sessions   → ctx.workspaceRegistry + ctx.sessionQuery + ctx.agents
              ├── workspace_send_message    → agent.followup(createUserMessage(...))
              └── workspace_await_reply     → 轮询 session.deriveMessages()
              │
              ▼
        工作区会话 A / B / C（普通 root agent，各自 workspace）
              ▲           │
              └───────────┘  assistant 回复 → await_reply 收集
```

**关键设计**：

| 点 | 决策 |
|----|------|
| 主会话身份 | 固定 session id `main-session`，root agent（挂在专用工作区「主会话」下） |
| 主会话 cwd | **专用系统目录** `~/.dsh/main-session/`（DSH home 下，**不是** workspace 路径）——保证 session.list 可发现/可打开，同时作为其专属工作区路径 |
| 创建时机 | **激活时创建**：插件 apply 的 effect 里 `getMainAgent()`（不再是纯惰性），保证会话列表里主会话始终 live |
| 工具作用域 | 四个编排工具注册在**主 agent 的 scope**（`agent.ctx`），只有主会话能看到它们 |
| 消息注入 | `createUserMessage` + `agent.followup()`（与 message-channels 相同的注入路径，source 标记 `main-session`） |
| 回复收集 | 记录注入前 `session.seq`，轮询 `deriveMessages()` 找 seq 之后的最新 assistant 文本（500ms 间隔，默认 5min 超时） |

---

## 3. 文件结构

```
src/main-session/
  types.ts            WorkspaceSessionView / ListSessionsResult / SendMessageResult / AwaitReplyResult / CreateWorkspaceSessionRequest / MAIN_SESSION_ID
  service.ts          MainSessionService：agent 生命周期、listSessions、sendMessage、awaitReply（摘要化）、createWorkspaceSession（纯逻辑，deps 注入）
  tools.ts            四个编排工具（defineTool），注册到主 agent scope
  persona.ts          主会话 persona（简洁调度者 system prompt 段）
  workspace-path.ts   默认工作区根目录（~/.dsh/workspaces/）+ slugify + 目录创建
  index.ts            Host 插件：ctx.get 解析依赖 + 惰性 agent 创建 + ctx.mainSession service

tests/
  main-session.spec.ts                   12 个单元测试
  main-session-workspace-path.spec.ts    4 个测试（slugify / 默认根目录）
```

---

## 4. 服务接口（ctx.mainSession）

```ts
interface MainSessionServiceSurface {
  ensureMainAgent(): Promise<AgentHandle>          // 创建/恢复主 agent
  isMainAgentLive(): boolean
  listSessions(): Promise<ListSessionsResult>       // 枚举工作区 + 未分组会话
  sendMessage(sessionId: string, message: string): SendMessageResult
  awaitReply(sessionId: string, options?): Promise<AwaitReplyResult>
}
```

### 4.1 会话枚举（listSessions）

- **工作区会话**：遍历 `workspaceRegistry.list()` 的 `sessionIds`（registry 顺序），每个会话附加：
  - `workspaceId` / `workspaceName`（所属工作区）
  - `title`（`sessionQuery.readTitle`，失败静默）
  - `live`（`agents.get(id)` 是否存在）
  - `lastActiveAt`（session header createdAt）
  - `messageCount`（`session.deriveMessages().length` 作为活跃度启发）
- **未分组会话**：live agent 中不属于任何工作区的（排除主会话自身）。

### 4.2 发送（sendMessage）

要求目标会话有 **live agent**（工作区 UI 打开过/正在运行的会话）。注入消息：

```ts
createUserMessage({
  content: [{ type: 'text', text: message }],
  source: { kind: 'plugin', plugin: 'main-session' },
})
agent.followup(userMessage)   // 唤醒驱动器，作为 next-turn 输入
```

目标无 live agent 时返回 `{ success: false, error }`。

### 4.3 等待回复（awaitReply）— 摘要化

1. 记录 `afterSeq = agent.session.seq`（注入前的位置，也可显式传）；
2. 轮询：找 `assistant/message` 事件中 `seq > afterSeq` 的最新一个 → `deriveMessages()` 里取对应文本；
3. **摘要化**：回复截断到 `maxReplyChars`（默认 `DEFAULT_REPLY_SUMMARY_CHARS` = 800 字符），超长时追加「…（完整结果见工作区会话）」；
4. 附带工作区跳转信息：`workspaceId` / `workspaceName`（从 workspace registry 解析）；
5. 默认 5min 超时（可配 `timeoutMs`），超时返回 `{ timedOut: true }`。

> **为什么摘要化**：主会话是简洁的调度台。它向用户汇报的是「谁在执行、进度如何、结果怎样」，不是完整转录。完整结果留在工作区会话，用户通过返回的 workspaceName/sessionId 跳转查看。

### 4.4 创建工作区会话（createWorkspaceSession）

主会话自主创建 worker 会话的完整流程：

1. **解析工作区目录**：显式 `workspacePath` 优先；省略时在**默认工作区根目录**下创建文件夹：
   ```
   ~/.dsh/workspaces/<slugified-title>/     ← DEFAULT_WORKSPACES_ROOT
   ```
   （`workspace-path.ts` 的 `resolveDefaultWorkspacePath` 负责 slugify + mkdir + realpath）
2. `workspaceRegistry.create(path, title)` — 确保工作区存在（已存在则复用，幂等）；
3. `agents.create({ sessionId, meta: { cwd: workspacePath } })` — 创建 cwd 指向工作区目录的 agent；
4. `workspaceRegistry.attachSession(sessionId)` — 挂载到工作区（校验 header cwd 与工作区路径 realpath 一致）；
5. 若有 `task`，`agent.followup(createUserMessage(...))` 发布初始任务；
6. 返回 `{ sessionId, workspaceId }`。

> **工作区文件夹**：主会话创建的工作区会话，其执行期间创建的所有文件都落在 `~/.dsh/workspaces/<title>/` 下——每个工作区一个独立文件夹，天然隔离。依赖 `workspaceRegistry` 服务；缺失时返回错误。工作区会话是普通 agent（不注册编排工具），只有主会话能调度它。

---

## 5. 工具定义（仅主会话可见）

| 工具 | 参数 | 返回 |
|------|------|------|
| `workspace_list_sessions` | — | `{ sessions, ungrouped, complete }` |
| `workspace_send_message` | `sessionId`, `message` | `{ success, error? }` |
| `workspace_create_session` | `workspacePath?`, `workspaceTitle?`, `task?` | `{ success, sessionId?, workspaceId?, error? }` |
| `workspace_await_reply` | `sessionId`, `timeoutMs?`, `maxReplyChars?` | `{ sessionId, summary?, workspaceId?, workspaceName?, timedOut, error? }` |

> `workspace_create_session` 的 `workspacePath` 可省略：省略时自动在 DSH 默认工作区根目录 `~/.dsh/workspaces/<workspaceTitle>/` 创建文件夹，工作区会话执行产物都放在该目录下。

工具通过 `defineTool` 定义，`execute` 返回纯 JSON 值，`render` 转为文本块。注册在 `agent.ctx`（setup 闭包内），因此**只对主会话模型可见**——工作区会话看不到也不受其影响。

### 5.1 主会话 persona（persona.ts）

主会话额外注册一个 **agent 作用域的系统提示词段**（`main-session:persona`，order 50），定义简洁调度者行为：

- 只发布任务、等待结果、简洁汇报；
- 汇报只给「进度 + 结果摘要」（一两句话）；
- **绝不回显工作区会话的实时执行细节/完整输出**；
- 需要完整结果时引导用户到对应工作区会话查看（附 workspaceName/sessionId）。

该段通过 `agent.ctx` 注册，只出现在主会话的 prompt assembly 中。

---

## 6. 依赖解析

DSH 的 service 类型声明未发布，desktop 插件按既有惯例用 `ctx.get()` 动态解析：

| 服务 | ctx key | 用途 |
|------|---------|------|
| `agents` | `agents` | 创建/枚举 live agent、按 id 查 |
| `sessions` | `sessions` | 读 session header（活跃时间）、deriveMessages（计数/回复） |
| `workspaceRegistry` | `workspaceRegistry` | 工作区 → sessionIds 归属（可选，缺失时枚举只含 ungrouped） |
| `sessionQuery` | `sessionQuery` | 会话标题（可选，缺失时无标题） |

插件 `inject: ['agents', 'sessions']`（静态）；workspaceRegistry/sessionQuery 用 `ctx.get` 动态探测，缺失时优雅降级。

---

## 7. 装配

- `cordis.patch.yml`：新增 `- id: main-session, name: dsh-plugin-desktop/main-session`；
- `tsdown.config.ts`：新增 `main-session` 入口；
- `package.json`：新增 `./main-session` export；
- `tsconfig.json`：include 扩展 `src/main-session/**`。

---

## 8. 验证结果

| 检查 | 结果 |
|------|------|
| `yarn typecheck` | ✅ |
| `yarn build`（lib/main-session.js 12.9 kB） | ✅ |
| `yarn test`（35 文件 / 308 测试，含 main-session 9 个） | ✅ |
| `yarn verify:profile`（插件装配） | ✅ |

---

## 9. 使用方式

主会话是普通 DSH agent（固定 id `main-session`），挂在专用工作区「主会话」下，启动后常驻会话列表。打开主会话后，模型自动拥有四个编排工具。对主会话说：

> "查看各工作区会话在做什么，把'重构订单模块'这个任务发给负责的会话，等它完成并汇报结果。"

主会话模型会：`workspace_list_sessions` → 判断目标 → `workspace_send_message` → `workspace_await_reply` → 汇总返回。

---

## 10. 后续迭代（Roadmap）

- [x] **会话恢复**：`ensureMainAgent` 支持从持久化恢复（`ctx.agents.resume`），重启后主会话历史延续；
- [ ] **自动恢复目标会话**：sendMessage 遇到非 live 会话时自动 `agents.resume`（从持久化恢复）；
- [ ] **结果回传增强**：awaitReply 支持多轮对话（连续收发）；
- [x] **UI**：主会话挂在专用工作区「主会话」下常驻会话列表（不再需要侧边栏独立入口按钮）；
- [ ] **权限边界**：明确主会话可管理的会话范围（全部 vs 指定工作区）。
