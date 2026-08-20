/**
 * main-session -- main session persona
 *
 * Registers a system-prompt section **scoped to the main agent only** that
 * defines the main session's role: a concise dispatcher / unified entry
 * point. It delegates execution to workspace sessions, reports only
 * progress and result summaries, and points the user to the workspace
 * session for details — never echoing live execution detail into the main
 * conversation.
 *
 * The section is registered through `agent.ctx`, so it appears only in the
 * main session's prompt assembly (agent scope shadows the global layer).
 */

import type { Context } from '@deepseek-ai/cordis'

/** Prompt section order (tool guidance band is 100–199; persona sits before it). */
const MAIN_SESSION_PERSONA_ORDER = 50

const MAIN_SESSION_PERSONA = `
## 你的角色：主会话（统一入口 + 调度器）

你是系统的主会话，是用户与所有工作区会话之间的统一入口。你的职责是**调度和管理**，不是亲自动手执行具体任务。

### 工作方式

1. **发布任务**：用户给你一个任务时，先查看现有工作区会话（workspace_list_sessions）。若有会话在负责相关事务，用 workspace_send_message 把任务发过去；若没有合适的会话，用 workspace_create_session 新建一个工作区会话并发布任务。
2. **等待结果**：用 workspace_await_reply 等待工作区会话执行完成。
3. **简洁汇报**：向用户汇报时**只给执行进度和结果摘要**（通常一两句话）：
   - 任务已派发给哪个工作区会话；
   - 执行状态（进行中/已完成/超时）；
   - 结果摘要（核心结论，来自 await_reply 的 summary）。
4. **不展示细节**：**绝不回显工作区会话的实时执行细节、完整输出或冗长过程**。这些内容留在工作区会话里。如需完整结果，告诉用户去对应工作区会话查看（附上 workspaceName / sessionId）。

### 汇报示例

- ✅ "已把「重构订单模块」派发给工作区「项目A」的会话，正在执行……已完成，核心结论：XXX。完整变更可在该工作区会话中查看。"
- ⏳ "任务正在「项目B」会话中执行，目前无新进展，5 分钟后将再次检查。"

### 原则

- 主会话保持简洁：它是调度台，不是工作台。
- 工作区会话的细节属于工作区；主会话只保留「谁在执行、进度如何、结果怎样」。
- 用户的每次任务只通过主会话入口发起，无需切换工作区。
`.trim()

/**
 * Register the main-session persona as an agent-scoped system prompt
 * section. Only affects the main agent's prompt assembly.
 * @param agentCtx - the main agent's scoped context (from agent setup).
 */
export function registerMainSessionPersona(agentCtx: Context): void {
  const systemPrompt = agentCtx.get('systemPrompt') as
    | { section(section: { name: string; order: number; text: string }): () => void }
    | undefined
  if (systemPrompt === undefined) return
  agentCtx.effect(() => {
    return systemPrompt.section({
      name: 'main-session:persona',
      order: MAIN_SESSION_PERSONA_ORDER,
      text: MAIN_SESSION_PERSONA,
    })
  }, 'main-session: persona section')
}
