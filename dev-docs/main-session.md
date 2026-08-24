# 主会话功能（main-session）— 本次修改摘要

> 日期: 2026-08-20
> 分支: dev_0820
> 功能: 系统级主会话，可查看/管理所有工作区会话（发消息、收结果）
> 详细设计: [`dsh-plugin-desktop/src/main-session/DESIGN.md`](../dsh-plugin-desktop/src/main-session/DESIGN.md)

---

## 1. 本次改了什么

在 `dsh-plugin-desktop` 中新增 **main-session 主会话功能**：一个系统级会话（固定 id `main-session`，不隶属于任何工作区），可编排所有工作区会话——查看它们的状态、给目标会话发消息、等待并收集结果。

### 1.1 新增文件

```
dsh-plugin-desktop/src/main-session/
  types.ts       WorkspaceSessionView / ListSessionsResult / SendMessageResult / AwaitReplyResult / MAIN_SESSION_ID
  service.ts     MainSessionService：agent 生命周期 + listSessions + sendMessage + awaitReply（纯逻辑，deps 注入）
  tools.ts       三个编排工具（workspace_list_sessions / workspace_send_message / workspace_await_reply）
  index.ts       Host 插件：ctx.get 解析依赖 + 惰性 agent 创建 + ctx.mainSession service
  DESIGN.md      设计文档

dsh-plugin-desktop/tests/
  main-session.spec.ts   9 个单元测试
```

### 1.2 修改的装配文件

| 文件 | 改动 |
|------|------|
| `dsh-plugin-desktop/cordis.patch.yml` | 新增 `- id: main-session, name: dsh-plugin-desktop/main-session` |
| `dsh-plugin-desktop/tsdown.config.ts` | 新增 `main-session` 打包入口 |
| `dsh-plugin-desktop/package.json` | 新增 `./main-session` export |
| `dsh-plugin-desktop/tsconfig.json` | include 扩展 `src/main-session/**` |

---

## 2. 功能范围

主会话的定位：**统一入口 + 全局记忆 + 管理调度 + 简洁汇报**（具体执行交给工作区会话）。

| 能力 | 工具 | 说明 |
|------|------|------|
| 查看工作区会话 | `workspace_list_sessions` | 枚举所有工作区会话 + 未分组 live 会话（标题/活跃度/是否 live） |
| 发送消息 | `workspace_send_message` | 给目标会话注入消息（`agent.followup`），目标需有 live agent |
| **创建工作区会话** | `workspace_create_session` | **主会话自主创建 worker 会话**（workspace 注册/挂载 + 发布初始任务） |
| 收集结果 | `workspace_await_reply` | 等待目标会话的 assistant 回复，**返回摘要**（默认 800 字符）+ 工作区跳转信息 |

**默认工作区目录**（`workspace-path.ts`）：
- DSH 默认工作区根目录：`~/.dsh/workspaces/`（`$DSH_HOME` 配置时用 `$DSH_HOME/workspaces/`）
- `workspace_create_session` 的 `workspacePath` **可省略**：省略时自动创建 `~/.dsh/workspaces/<workspaceTitle>/` 文件夹
- 工作区会话执行期间创建的所有文件都落在该文件夹下——每个工作区独立隔离

**简洁汇报（交互定位）**：
- 主会话**不回显工作区会话的实时执行细节**；
- 派发任务后**本轮立即静默结束**，不主动轮询/追问；
- 工作区会话完成时，由**完成回调**（监听 `turn/end` 事件）把结果摘要主动注入主会话，主会话据此一次性汇报**进度 + 结果摘要**（一两句话）；
- 完整结果留在工作区会话，主会话把用户引导过去查看（附 workspaceName/sessionId）；
- 通过主会话专属 persona（`persona.ts` 注册的 system prompt 段）+ 完成回调（`completion-callback.ts`）共同强制这一行为。

**设计要点**：
- 主会话 = root agent，固定 id `main-session`，**惰性创建**（首次使用时 `ctx.agents.create()`，之后重启通过 `ctx.agents.resume()` 从持久化恢复，历史延续）；
- 编排工具 + persona 都注册在**主 agent 的 scope**（`agent.ctx`），只有主会话能看到；
- `workspace_create_session` 流程：解析目录（显式路径或 `~/.dsh/workspaces/<title>/` 自动创建）→ `workspaceRegistry.create(path, title)` → `agents.create({ meta: { cwd } })` → `attachSession()` 挂载 → `followup()` 发布任务；
- 消息注入用 `createUserMessage` + `agent.followup()`，source 标记 `main-session`；
- 依赖通过 `ctx.get()` 动态解析（agents/sessions 静态注入；workspaceRegistry/sessionQuery 可选，缺失时降级）。

**主会话的工作区归属（关键修复）**：
- 主会话 cwd 固定为 `~/.dsh/main-session/`（`MAIN_SESSION_CWD_NAME`），插件激活时把该目录注册为专用工作区「主会话」并 `attachSession`，因此主会话**不会落入「未分组」**，侧边栏会话列表能直接打开它；
- **必须用 `agents.resume` 而非 `agents.create` 恢复已持久化的主会话**：`create` 构造的是空 seed 的全新会话，持久化后端发现同 id 已有日志时拒绝（seed 无法覆盖已存前缀），导致主会话 live 但永不落盘、`attachSession` 也失败（读不到持久化 header）——重启后仍停在「未分组」。`resume` 会加载日志重建 seed，采纳成功；`isMainSessionPersisted()`（读 `sessionPersistence.list()`）决定走 resume 还是 create；
- setup 中 best-effort 加入部署默认 agent preset（`agentPresets.resolve() + mount()`，与 Web host 一致），避免工具/persona 解析到空全局层（消除 `agent-presets` 警告）。

---

## 3. 使用方式

### 3.1 主会话入口（工作区「主会话」下的常驻会话）

主会话挂在**专用工作区「主会话」**下，启动后常驻侧边栏会话列表（无需独立入口按钮）：

- **归属**：插件激活时把 `~/.dsh/main-session/` 注册为工作区「主会话」并 `attachSession`，主会话作为该工作区下的第一个会话显示，展开「主会话」工作区即可打开；
- **主 agent 生命周期**：Host 插件**激活时创建**（不再纯惰性），保证列表里主会话始终 live；
- **布局**：侧边栏 footer 不再有独立主会话按钮（已移除）；footer 保留插件市场与 Cordis 面板，二者仍垂直堆叠（column 修复保留，避免整行组件互相挤压）。

**使用流程**：打开 DSH Desktop → 侧边栏「主会话」工作区 → 点击主会话 → 进入系统级主会话，发布任务即可，无需切换工作区。

### 3.2 在主会话中发布任务

主会话模型自带四个编排工具（list/send/create/await）。

**示例指令**：

> 查看各工作区会话在做什么。如果没有会话负责「重构订单模块」，就新建一个工作区会话来做，等它完成并汇报结果。

**执行流程**（模型自动完成）：
1. `workspace_list_sessions` → 查看各工作区会话及状态；
2. 判断：已有会话负责 → `workspace_send_message`；没有 → `workspace_create_session(workspacePath, task)` 新建并发布任务；
3. `workspace_await_reply(sessionId)` → 等待结果摘要；
4. **简洁汇报**：一两句话说明进度和结论（如"已派发给工作区「项目A」，完成，核心结论：XXX"），并告知完整结果在哪个工作区会话查看。

> **用户视角**：全程只需在主会话中发布任务，无需切换工作区，也无需被实时细节打扰。主会话的会话历史即全局记忆——所有委派过的任务和结果摘要都在主会话上下文里；要深究细节，点进对应工作区会话即可。

---

## 4. 验证结果（本次实测）

| 检查 | 结果 |
|------|------|
| `yarn typecheck` | ✅ |
| `yarn build`（lib/main-session.js + client bundle） | ✅ |
| `yarn test`（35 文件 / 315 测试，含 main-session 12 个） | ✅ |
| `yarn verify:profile`（插件装配） | ✅ |

---

## 5. 后续迭代（Roadmap）

- [x] 主会话持久化恢复（`ctx.agents.resume`，重启后历史延续）
- [ ] sendMessage 对非 live 会话自动恢复
- [ ] awaitReply 支持多轮对话（连续收发）
- [x] 主会话 UI 入口（挂在专用工作区「主会话」下常驻会话列表）
- [ ] 权限边界：主会话可管理的会话范围
