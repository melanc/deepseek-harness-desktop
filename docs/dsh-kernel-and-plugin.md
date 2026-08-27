# DSH 内核与插件机制（源码级分析）

> 本文聚焦两个主轴：**DSH 内核（执行引擎）** 与 **DSH 可扩展插件机制（Cordis）**。
> 所有代码片段均为真实源码原样引用，标注文件路径（相对 `deepseek-harness/`，vendored 框架在 `vendor/`）与行号。
> 目标：对着源码看懂内核循环，并能照抄写一个最小插件。

---

# 第一章 DSH 内核：执行引擎

## 1.1 谁在跑循环：AgentLoop 与依赖注入

`AgentLoop` 是一个 Cordis Service，实现 `AgentFactory`，负责 create/resume 驱动循环的 `ReactLoopAgent`。

```ts
// deepseek-harness/packages/core/agent-loop/src/index.ts:296-297
export class AgentLoop extends Service implements AgentFactory {
  static inject = ['agents', 'sessions', 'llm', 'tools', 'systemPrompt']
```

`static inject` 声明这个服务**依赖**的五个服务，Cordis 会等它们全部就绪才激活 `AgentLoop`（详见第二章的 Fiber 机制）。这五个服务正是循环与外部模块的全部交互面：

| 服务名 | 作用 | 循环里的用法 |
|---|---|---|
| `agents` | Agent registry | `ctx.agents.get()` / `withInitiator()` |
| `sessions` | session 日志 store | `session.append()` / `deriveMessages()` |
| `llm` | 模型适配器 | `ctx.llm.stream(request)` |
| `tools` | 工具注册表 | `ctx.tools.executionMode()` / 调度器 |
| `systemPrompt` | prompt 组装 | `systemPrompt.assemble()` |

## 1.2 ReactLoopAgent：状态机与入口

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:38-46
type Phase =
  | { kind: 'idle'; lastTurn: number }
  | {
    kind: 'maintenance'
    abort: AbortController
    lastTurn: number
    wakeRequested: boolean
  }
  | { kind: 'running'; abort: AbortController; turn: number; step: number; wakeRequested: boolean }
```

三态：`idle`（空闲）、`maintenance`（维护/等待）、`running`（正在跑）。`abort` 是每 turn 一换的 `AbortController`，是取消的统一入口。

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:64, 92-97
export class ReactLoopAgent implements Agent {
  readonly inbox: Inbox
  private phase: Phase
  private activityDone: Promise<void> = Promise.resolve()
  // ...
  constructor(
    private loopCtx: Context,
    public readonly id: SessionId,
    public readonly options: AgentOptions,
    public readonly session: Session,
  ) {
    // ...
    const lastTurn = session.events.findLast(event => event.type === 'turn/start')?.data.turn ?? 0
    this.phase = { kind: 'idle', lastTurn }
    this.scope = createScope(loopCtx, this)
    this.ctx = this.scope.ctx.extend({ agent: this })
    this.runtimeContext = new RuntimeContextProjection(this.ctx, session)
  }
```

`this.ctx = this.scope.ctx.extend({ agent: this })` 是 per-agent 作用域的来源——每个 agent 有自己的 scoped context，工具注册/限制都落在这个作用域里（`core/scope`）。

### send：消息入口

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:113-120
send(message: UserMessage, target: InboxTarget, wakeup: boolean): void {
  // Waking input cannot join an aborted activity, so it starts the next turn.
  // Captured before the insertion so a reentrant cancel from a splice observer cannot reclassify it.
  const wakingAfterAbort = wakeup && this.phase.kind !== 'idle' && this.phase.abort.signal.aborted
  const resolvedTarget = wakingAfterAbort ? 'next-turn' : target
  this.inbox.splice(resolvedTarget, Infinity, 0, [message])
  if (wakeup) this.wakeDriver(wakingAfterAbort)
}
```

`Inbox` 区分两类输入：**waking message**（立即唤醒）与 **next-step context**（等下一轮才被 claim）。

### wakeDriver + kick：驱动启动

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:172-193
private wakeDriver(wakeAfterAbort = false): void {
  if (this.phase.kind !== 'idle') {
    // Maintenance and aborted drivers cannot deliver the wake: latch it for
    // replay at convergence. Live drivers claim queued work themselves;
    // disposal never latches, so teardown waits on no model turn.
    const reason = this.phase.abort.signal.reason as AgentCancelCause | undefined
    if (reason?.kind !== 'disposed' && (this.phase.kind === 'maintenance' || wakeAfterAbort)) {
      this.phase.wakeRequested = true
    }
    return
  }
  const driver = Promise.withResolvers<void>()
  this.activityDone = driver.promise
  this.setPhase({
    kind: 'running',
    abort: new AbortController(),
    turn: this.phase.lastTurn,
    step: 0,
    wakeRequested: false,
  })
  this.loopCtx.agents.withInitiator(this, () => this.kick()).then(driver.resolve, driver.reject)
}
```

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:210-223
private async kick(): Promise<void> {
  try {
    while (await this.turn()) {}
  } catch (_error) {
    // Reported failures and cancellation are contained at the driver boundary.
  } finally {
    /* v8 ignore next -- kick owns a running phase until this driver boundary */
    if (this.phase.kind === 'running') {
      const { turn, wakeRequested } = this.phase
      this.setPhase({ kind: 'idle', lastTurn: turn })
      if (wakeRequested && this.inbox.hasPending) this.wakeDriver()
    }
  }
}
```

`kick()` 是驱动循环的边界：`while (await this.turn()) {}` 一直跑 turn，直到 turn 返回 false（没有 pending 工作）。

### preStep：claim 输入 + 组装 prompt + agent/pre-step 瀑布

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:225-243
private async preStep(target: InboxTarget, position: { turn: number; step: number }): Promise<PreparedStep> {
  /* v8 ignore next -- private callers establish the running phase before proposing a step */
  if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": pre-step outside running phase`)
  const signal = this.phase.abort.signal
  const claimed = this.inbox.claim(target, position.turn)
  const assembly = await this.loopCtx.systemPrompt.assemble(assembleContextFor(this, signal))
  signal.throwIfAborted()
  const sections = renderContextSections(assembly)
  const context = this.runtimeContext.project(joinContextSections(sections), sections)
  const decision = await this.dispatch.waterfall(
    'agent/pre-step', { messages: claimed, ...position, signal },
    (): Promise<PreStepDecision> => Promise.resolve<PreStepDecision>({
      kind: 'enter',
      messages: context === undefined ? claimed : [...claimed, context],
    }),
  )
  signal.throwIfAborted()
  return decision.kind === 'reject' ? decision : { ...decision, assembly }
}
```

`agent/pre-step` 是**第一个扩展点**（瀑布）：插件可以改写/reject 这一 step 模型要看到的消息。`context` 是 runtimeContext 投影（压缩、注入上下文等都从这里进）。

## 1.3 turn 循环：完整生命周期

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:246-330
private async turn(): Promise<boolean> {
  if (this.phase.kind !== 'running') {
    this.throwError(new Error(`agent "${this.id}": turn without driver reservation`))
  }
  const phase = this.phase
  const { signal } = phase.abort
  signal.throwIfAborted()
  const turn = phase.turn + 1
  try {
    this.session.append('turn/start', { turn })
  } catch (error: unknown) {
    this.throwError(error)
  }
  phase.turn = turn
  let turnEnds: TurnEndReason | null = null
  let target: InboxTarget = 'next-turn'
  try {
    while (true) {
      signal.throwIfAborted()
      const step = phase.step + 1
      const decision = await this.preStep(target, { turn, step })
      if (decision.kind === 'reject') {
        turnEnds = { kind: 'blocked' }
        return false
      }
      if (turnEnds && decision.messages.length === 0) break
      // A removed waking message or an enter decision rewritten to empty
      // still owns the initial turn boundary, but it spends no model call.
      if (phase.step === 0 && decision.messages.length === 0) {
        turnEnds = { kind: 'completed' }
        return false
      }
      signal.throwIfAborted()
      this.session.append('step/start', { turn, step })
      phase.step = step
      try {
        for (const message of decision.messages) {
          this.session.append('user/message', message, { surfaceOp: 'append' })
        }
        // max-tokens is sticky: once any step hits the ceiling, later steps
        // that complete normally must not downgrade the turn outcome.
        const stepEnd = await this.step(decision.assembly)
        // max-tokens stays sticky: a later completed step must not
        // downgrade the turn outcome.
        if (turnEnds === null || turnEnds.kind !== 'max-tokens') turnEnds = stepEnd
      } finally {
        this.session.append('step/end', { turn, step })
      }
      signal.throwIfAborted()
      if (turnEnds && this.inbox.nextStep.length === 0) {
        await this.dispatch.serial('agent/turn-stopping', { turn, signal })
        signal.throwIfAborted()
      }
      if (turnEnds && this.inbox.nextStep.length === 0) break
      target = 'next-step'
    }
  } catch (error: unknown) {
    if (signal.aborted) {
      turnEnds = { kind: 'aborted', reason: signal.reason as AgentCancelCause }
      throw error
    }
    // Every failure is structured: an `LlmError` keeps its facts, anything
    // else flattens to `errorChain` text under the `UNKNOWN` code.
    turnEnds = {
      kind: 'error',
      error: error instanceof LlmError
        ? error.failure
        : { message: errorChain(error), code: 'UNKNOWN' },
    }
    this.throwError(error)
  } finally {
    try {
      // oxlint-disable-next-line typescript/no-non-null-assertion -- every exit assigns a turn ending
      this.session.append('turn/end', { turn, reason: turnEnds! })
    } catch (error: unknown) {
      this.throwError(error)
    }
  }
  if (!this.inbox.hasPending) return false
  phase.abort = new AbortController()
  // A fresh controller makes a latch set on the old one stale: the live driver claims the queue itself.
  phase.wakeRequested = false
  phase.step = 0
  return true
}
```

### turn 终止条件

`turnEnds` 的取值即终止条件（`agent.ts:268, 275, 304, 309-314`）：

| kind | 触发点 | 代码位置 |
|---|---|---|
| `blocked` | `decision.kind === 'reject'` | agent.ts:268 |
| `completed` | 首 step 空输入，或 step 返回 completed | agent.ts:275 / agent.ts:413 |
| `max-tokens` | 模型输出撞上限（sticky，不降级） | agent.ts:290 / agent.ts:410 |
| `aborted` | `signal.aborted` | agent.ts:304 |
| `error` | 非 abort 异常，结构化 `LlmError` | agent.ts:309-314 |

## 1.4 step 循环：模型调用 → 工具执行 → 回流

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:332-420
private async step(assembly: PromptAssembly): Promise<StepEndReason | null> {
  /* v8 ignore next -- private callers establish the running phase before executing a step */
  if (this.phase.kind !== 'running') throw new Error(`agent "${this.id}": step outside running phase`)
  const { turn, step, abort: { signal } } = this.phase
  signal.throwIfAborted()
  const system = renderPrompt(assembly)

  while (true) {
    const { request, preparedCall } = await this.buildRequest(
      turn, step, assembly.tools, system, this.session.deriveMessages(), signal,
    )
    const assembler = new BlockAssembler()
    const chunkSeqs: number[] = []
    try {
      const stream = preparedCall?.stream(request) ?? this.loopCtx.llm.stream(request)
      signal.throwIfAborted()
      for await (const chunk of stream) {
        signal.throwIfAborted()
        chunkSeqs.push(this.session.append('assistant/chunk', { turn, step, chunk }).seq)
        assembler.push(chunk)
      }
      signal.throwIfAborted()
    } catch (error: unknown) {
      if (signal.aborted) {
        const content = assembler.interruptedBlocks()
        if (content.length > 0) {
          this.session.append('assistant/message', {
            turn,
            step,
            message: createAssistantMessage({
              content,
              source: { provider: request.provider, model: request.model },
            }),
            interrupted: true,
            ...assembler.usage === undefined ? {} : { usage: assembler.usage },
          }, { surfaceOp: 'append', sourceEventSeqs: chunkSeqs })
        }
      }
      throw error
    }
    const finish = assembler.finish
    if (finish.kind === 'error' || finish.kind === 'aborted') {
      const action = await this.dispatch.waterfall(
        'agent/request-error', {
          turn,
          step,
          provider: request.provider,
          failure: finish.failure,
          retryPolicy: preparedCall?.retryPolicy,
          signal,
        },
        () => Promise.resolve<RequestErrorAction>(undefined),
      )
      signal.throwIfAborted()
      if (action?.kind !== 'retry') {
        throw new LlmError(finish.failure.message, finish.failure.code, finish.failure)
      }
      continue
    }

    const message = createAssistantMessage({
      content: assembler.blocks(),
      source: {
        provider: request.provider,
        model: request.model,
        ...assembler.replayState !== undefined ? { replayState: assembler.replayState } : {},
      },
    })
    this.session.append(
      'assistant/message',
      {
        turn,
        step,
        message,
        ...assembler.usage === undefined ? {} : { usage: assembler.usage },
      },
      { surfaceOp: 'append', sourceEventSeqs: chunkSeqs },
    )
    if (finish.kind === 'max-tokens') return { kind: 'max-tokens' }

    const toolCalls = message.content.filter(block => block.type === 'tool-call')
    if (toolCalls.length === 0) return { kind: 'completed' }
    const { concluded } = await executeToolCalls(
      this.loopCtx, turn, step, toolCalls, signal,
      context => this.inbox.splice('next-step', this.inbox.nextStep.length, 0, [context]),
    )
    return concluded ? { kind: 'completed' } : null
  }
}
```

**step 循环的关键点**：

1. `this.session.deriveMessages()` 从日志投影模型历史（不是内存数组）。
2. `assistant/chunk` 每个流式块都落日志（replay/UI 保真）。
3. `agent/request-error` 瀑布可返回 `retry` 让循环 `continue`。
4. `toolCalls = message.content.filter(block => block.type === 'tool-call')`；无工具 → completed；有工具 → `executeToolCalls`；工具 `concludesTurn` 则 completed，否则返回 null 继续下一 step。

## 1.5 buildRequest：请求组装与「模型可见 ⟺ 已落日志」

```ts
// deepseek-harness/packages/core/agent-loop/src/agent.ts:457-489（节选）
const proposedConfig = await this.dispatch.waterfall(
  'agent/request', { turn, step, signal },
  () => Promise.resolve(seedConfig),
)
signal.throwIfAborted()
if (!proposedConfig.provider || !proposedConfig.model) {
  throw new Error(`agent "${this.id}" has no provider/model: set AgentOptions.provider and AgentOptions.model or supply both via the agent/request waterfall`)
}
let config: LlmCallConfig
let preparedCall: PreparedLlmCall | undefined
try {
  preparedCall = await this.loopCtx.llm.prepareCall(proposedConfig, signal)
  config = preparedCall.config
} catch (error: unknown) {
  if (!(error instanceof LlmError) || error.code !== 'NO_ADAPTER') throw error
  config = proposedConfig
}
signal.throwIfAborted()

const header = canonicalHeader({
  config,
  ...preparedCall === undefined ? {} : { adapterDefaults: preparedCall.adapterDefaults },
  ...system ? { system } : {},
  ...tools.length > 0 ? { tools } : {},
})
const baseline = this.session.requestHeader()
if (!this.requestHeaderLogged) {
  this.session.append('request/header', { header, reason: baseline === undefined ? 'initial' : 'resume' })
  this.requestHeaderLogged = true
} else if (baseline === undefined || !headerEquals(baseline, header)) {
  this.session.append('request/header', { header, reason: 'change' })
}
```

`agent/request` 瀑布让插件改 provider/model/effort/tools；最终 header 落 `request/header` 事件——这就是「模型可见 ⟺ 已落日志」不变式的落点。

## 1.6 工具调度：executeToolCalls

```ts
// deepseek-harness/packages/core/agent-loop/src/tool-calls.ts:59-101
export async function executeToolCalls(
  ctx: Context,
  turn: number,
  step: number,
  toolCalls: ToolCallBlock[],
  signal: AbortSignal,
  acceptContext: (context: UserMessage) => void,
): Promise<{ concluded: boolean }> {
  const agent = ctx.agents.requireInitiator()
  const { session } = agent

  // Inputs are distinct because tools/execute wrappers may replace `exec.signal`.
  const planned: PlannedCall[] = toolCalls.map(block => ({
    block,
    exec: {
      callId: block.id,
      name: block.name,
      arguments: parseArguments(block.arguments),
      agent,
      signal,
    },
  }))

  let next = 0
  let concluded = false
  while (next < planned.length) {
    // Commit before classifying again so registry changes affect unstarted calls.
    const first = planned[next]!
    const mode = ctx.tools.executionMode(first.exec).kind
    const group = mode === 'parallel' ? planned.slice(next) : [first]
    const outcome = await runGroup(
      ctx, turn, step, group, mode, signal, acceptContext,
    )
    next += outcome.consumed
    concluded ||= outcome.concluded
    if (outcome.aborted) {
      for (const call of planned.slice(next)) appendSkippedToolCall(session, turn, step, call.block)
      return { concluded }
    }
  }
  return { concluded }
}
```

`runGroup` 内部（`tool-calls.ts:164-196`）是调度核心：先 `appendToolCall`（落 `tool/call`），再 `prepare`（pre-execute 策略 + 守卫），然后 `dispatch`（执行）或直接 `post-result`/`final-result`。结果按模型顺序 commit（`commitReady`，`tool-calls.ts:146-160`）。

## 1.7 ToolRuntime：注册 / 执行模式 / 执行管线

```ts
// deepseek-harness/packages/core/tools/src/index.ts:787-788
export class ToolRuntime extends Service {
  static inject = ['systemPrompt']
```

### 注册

```ts
// deepseek-harness/packages/core/tools/src/index.ts:1037-1062
register(definition: ToolDefinition): () => void {
  const name = definition.name
  const output = (definition as Partial<ToolDefinition>).output
  if (output === undefined || typeof output !== 'object'
    || typeof output.render !== 'function'
    || (output.presentationMeta !== undefined && typeof output.presentationMeta !== 'function')) {
    throw new TypeError(`tool "${name}" must declare output { schema, render, presentationMeta? }`)
  }
  assertSupportedJsonSchema(output.schema)
  const timeoutMs = definition.timeoutMs
  if (timeoutMs !== undefined
    && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
    throw new TypeError(`tool "${name}" timeoutMs must be a positive finite number`)
  }
  // Reserved unconditionally: any agent may select a code mode for itself,
  // so a name free to take under the deployment default would become a
  // collision the moment a preset mounted.
  if (name === RUN_CODE_NAME) {
    throw new Error(`tool name "${RUN_CODE_NAME}" is reserved for the Code Mode presentation transport and cannot be registered or shadowed`)
  }
  return this.layers.effect(
    this.ctx,
    layer => layer.tools.insert(name, definition),
    { label: 'tools.register()' },
  )
}
```

注册经 `layers.effect` 插入**作用域化工具层**，返回 disposer（fiber 卸载自动移除）。

### 并发模式判定

```ts
// deepseek-harness/packages/core/tools/src/index.ts:1276-1285
executionMode(exec: ToolExecutionInput): ToolExecutionMode {
  const tool = this.resolveExecution(exec.name, exec.agent, exec.parent !== undefined)
  if (!tool?.isConcurrencySafe) return { kind: 'exclusive' }
  try {
    const concurrencySafe: unknown = tool.isConcurrencySafe(exec.arguments)
    return concurrencySafe === true ? { kind: 'parallel' } : { kind: 'exclusive' }
  } catch {
    return { kind: 'exclusive' }
  }
}
```

fail-closed：只有 `isConcurrencySafe === true` 才并行，其余一律 exclusive。

### 执行管线（execute → prepareExecution）

```ts
// deepseek-harness/packages/core/tools/src/index.ts:1342-1344
async execute(exec: ToolExecutionInput): Promise<ToolExecutionResult> {
  return this.prepareExecution(exec, prepared => this.completeScheduledExecution(prepared))
}
```

```ts
// deepseek-harness/packages/core/tools/src/index.ts:1463-1493（节选）
private async prepareExecution<T>(
  input: ToolExecutionInput,
  next: (prepared: ScheduledToolPreparation) => T | PromiseLike<T>,
): Promise<T> {
  const created = this.createExecution(input)
  if (created.kind !== 'ready') return next(created)
  const exec = created.exec
  if (this.callerCancelled(exec)) {
    return next({ kind: 'final-result', exec, result: toolAbortedBeforeDispatchResult() })
  }
  try {
    const carrier = scopeTarget(this, exec.agent)
    const gate = await this.ctx.waterfall(
      carrier, 'tools/pre-execute', exec,
      () => Promise.resolve<PreToolDecision>({ kind: 'allow' }),
    )
    const askResolution: ToolAskResolution = gate.kind === 'ask'
      ? await this.serviceAsk(exec, gate)
      : { decision: gate, approvalCancelled: false }
    const { decision } = askResolution
    if (this.callerCancelled(exec) && askResolution.approvalCancelled) {
      return await next({ kind: 'post-result', exec, result: toolAbortedBeforeDispatchResult() })
    }
    const denialReason = decision.kind === 'allow'
      ? this.guardReason(exec)
      : decision.reason
    if (denialReason !== undefined) {
      return await next({
        kind: 'post-result',
        exec,
        result: this.materializeFinalResult({
```

管线顺序：`createExecution`（collapse 拒绝 / 参数快照）→ `tools/pre-execute` 瀑布（策略/审批 `ask`）→ `guardReason`（monotonic 守卫）→ dispatch（执行）→ post-execute → materialize。

### code-mode：native | code | both

```ts
// deepseek-harness/packages/core/tools/src/index.ts:651
export type ToolPresentationMode = 'native' | 'code' | 'both'
```

```ts
// deepseek-harness/packages/core/tools/src/index.ts:791
mode: z.union(['native', 'code', 'both'] as const).default('native'),
```

`code` 模式把所有工具折叠成一个 `run_code`（`code-mode.ts:20`），模型只能调 `run_code`。**code 模式下模型直接点名非 `run_code` 工具会被拒绝**：

```ts
// deepseek-harness/packages/core/tools/src/index.ts:1324-1326
private collapses(name: string, scope: ScopeKey | undefined, nested: boolean): boolean {
  return !nested && this.modeFor(scope) === 'code' && name !== RUN_CODE_NAME
}
```

这个拒绝发生在策略管线**之前**（`index.ts:1373-1377`），所以 pre-execute/approval 永远看不到注定失败的调用。

## 1.8 「permission denied / sandbox_permissions 升级」在哪拦

**不在 core/tools，在 capability seam 的 provider 层**（`packages/fs`）。

```ts
// deepseek-harness/packages/fs/tool-fs/src/sandbox.ts:20-22
/** The two escalation arguments a mutating tool may carry (advertised only under a confining backend). */
export interface FsEscalationArgs {
  sandbox_permissions?: string
```

```ts
// deepseek-harness/packages/sandbox/sandbox-policy/src/index.ts:94
mode: z.union(['read-only', 'workspace-write', 'danger-full-access'] as const).default('read-only'),
```

三档模式 `read-only / workspace-write / danger-full-access`，默认 `read-only`。`FsSandboxController`（`fs/tool-fs/src/sandbox.ts:37`）是 write/edit 工具挂的升级 API：文件操作被拒 → 抛 `FS_SANDBOX_DENIED`，错误带 `sandboxDenialMarker` + `escalationHintMarker`（`tool-fs/src/sandbox.ts:111-129`），模型带着提示语在下一次 tool-call 带上 `sandbox_permissions` 重试 → 走审批。

在 tools 管线里的位置：**provider 的拒绝发生在 `tools/execute` 阶段（tool body 内部）**，即 pre-execute（管 approval/策略）之后。

---

# 第二章 DSH 可扩展插件机制（Cordis）

## 2.1 Service 基类：注册与生命周期

```ts
// deepseek-harness/vendor/cordis/src/service.ts:11-59（节选）
export abstract class Service<out T = never> {
  static readonly init: unique symbol = symbols.init
  static readonly check: unique symbol = symbols.check
  static readonly config: unique symbol = symbols.config
  static readonly invoke: unique symbol = symbols.invoke
  static readonly extend: unique symbol = symbols.extend
  static readonly tracker: unique symbol = symbols.tracker
  static readonly resolveConfig: unique symbol = symbols.resolveConfig

  declare [symbols.config]: T

  /** The service name this instance is registered under. */
  public name!: string

  constructor(protected ctx: Context, name: string) {
    name ??= this.constructor['provide'] as string

    let self = this
    const tracker: Tracker = {
      associate: name,
      property: 'ctx',
    }
    if (self[symbols.invoke]) {
      self = createCallable(name, joinPrototype(Object.getPrototypeOf(this), Function.prototype), tracker)
    }
    self.ctx = ctx
    self.name = name
    defineProperty(self, symbols.tracker, tracker)

    self.ctx.reflect.provide(name, self, this[symbols.check])
    return self
  }
```

子类在构造里 `super(ctx, 'name')`，**立即注册**到 ctx，**随 owning fiber 卸载自动移除**（`service.ts:9` 注释）。`Service.invoke` 让服务可调用（如 `ctx.logger()`）。

现实例子：

- `ToolRuntime extends Service` 注册为 `ctx.tools`（`core/tools/src/index.ts:787`）。
- `AgentLoop extends Service` 注册为 `ctx.agentLoop`（`core/agent-loop/src/index.ts:296`）。
- `SqliteSessionQueryEngine extends SessionQueryEngine extends Service` 注册为 `ctx.sessionQuery`（`session-query/session-query-sqlite/src/index.ts:196,233`）。

## 2.2 Context：proxy + 三个作用域操作

```ts
// deepseek-harness/vendor/cordis/src/context.ts:70-84（节选）
constructor() {
  this[symbols.isolate] = Object.create(null)
  this[symbols.intercept] = Object.create(null)
  const self = new Proxy<this>(this, ReflectService.handler)
  this.root = self
  this.baseUrl = undefined
  this.fiber = new Fiber(self, {}, Object.create(null), null, () => [])
  this.reflect = new ReflectService(self)
  this.registry = new RegistryService(self)
  this.events = new EventsService(self)
  this.logger = new LoggerService(self)
  this.fiber._disposables.clear()
  return self
}
```

`Context` 是一个 proxy：普通属性读走服务解析器。三个作用域操作（都**不突变父 context**）：

```ts
// deepseek-harness/vendor/cordis/src/context.ts:99-107
extend(meta = {}): this {
  const shadow = Reflect.getOwnPropertyDescriptor(this, symbols.shadow)?.value
  const self = Object.create(getTraceable(this, this))
  for (const prop of Reflect.ownKeys(meta)) {
    Object.defineProperty(self, prop, Reflect.getOwnPropertyDescriptor(meta, prop)!)
  }
  if (!shadow) return self
  return Object.assign(Object.create(self), { [symbols.shadow]: shadow })
}
```

```ts
// deepseek-harness/vendor/cordis/src/context.ts:121-125
isolate(name: string, label?: symbol) {
  const shadow = Object.create(this[symbols.isolate])
  shadow[name] = label ?? Symbol(name)
  return this.extend({ [symbols.isolate]: shadow })
}
```

```ts
// deepseek-harness/vendor/cordis/src/context.ts:139-145
intercept(name: string, config: any) {
  const intercept = Object.create(this[symbols.intercept])
  intercept[name] = config
  return this.extend({ [symbols.intercept]: intercept })
}
```

- `extend`：子 context（原型继承）。
- `isolate`：给某服务名开独立作用域（per-agent 工具注册靠它）。
- `intercept`：给某服务注入拦截配置。

## 2.3 依赖注入：static inject vs ctx.get

### 声明式依赖（必须）

```ts
// deepseek-harness/packages/extensions/tool-cordis/src/index.ts:27
export const inject = ['tools', 'systemPrompt', 'dynamicCordisRunner', 'cordisInspect']
```

`static inject` / `export const inject` 声明插件**必须**的服务，Cordis 等它们全部就绪才激活插件。

### 动态读（可选）

规则（`packages/AGENTS.md`）：**可选服务用 `ctx.get(name)`**，`ctx.<name>` 保留给已声明 inject（属性 proxy 拓扑敏感）。

```ts
// deepseek-harness/packages/core/agent-loop/src/index.ts:199-200（节选，懒读可选服务）
const resolveSessionTitle = (): { rename(session: unknown, title: string): { title: string; eventSeq: number } } | undefined =>
  ctx.get('sessionTitle') as unknown as { rename(session: unknown, title: string): { title: string; eventSeq: number } } | undefined
```

> 这是本次会话修过的坑：可选服务 `sessionQuery` 在 apply 里被 `ctx.get('sessionQuery')` 同步缓存成 `undefined`，后续一直用这个旧值。正确做法是像 `resolveSessionTitle` 一样**每次懒读**。

## 2.4 插件生命周期：Fiber 状态

```ts
// deepseek-harness/vendor/cordis/src/fiber.ts:147-154
export const enum FiberState {
  PENDING,
  LOADING,
  ACTIVE,
  FAILED,
  DISPOSED,
  UNLOADING,
}
```

```
PENDING → LOADING → ACTIVE（或 FAILED）
                    ↓
                UNLOADING → DISPOSED
```

驱动机制（`fiber.ts:314-319, 611-639`）：

```ts
// deepseek-harness/vendor/cordis/src/fiber.ts:611-623
_refresh() {
  let epoch: string | boolean = false
  epoch = ''
  for (const name of Object.keys(this.inject)) {
    const impl = this._store[name]
    if (!impl) {
      epoch = INACTIVE
      break
    }
    epoch += ':' + impl.fiber.uid
  }
  this._setEpoch(epoch)
}
```

```ts
// deepseek-harness/vendor/cordis/src/fiber.ts:625-639
private _setEpoch(epoch: string) {
  const oldEpoch = this._runner.epoch
  if (epoch === oldEpoch) return
  this._runner.epoch = epoch
  if (this.inertia) return
  this._updateState(() => {
    if (epoch !== INACTIVE && oldEpoch === INACTIVE) {
      this.inertia = this._reload()
      return FiberState.LOADING
    } else {
      this.inertia = this._unload()
      return FiberState.UNLOADING
    }
  })
}
```

含义：插件激活是**服务可用性驱动**的——所有 `inject` 依赖就绪 → LOADING（执行 apply）→ ACTIVE；任一依赖消失 → UNLOADING。

## 2.5 插件启动：ctx.plugin / ctx.inject

```ts
// deepseek-harness/vendor/cordis/src/registry.ts:300-336
inject(inject: Inject, callback: Plugin.Function<void>) {
  return this.plugin({ inject, apply: callback, name: callback.name })
}

plugin(plugin: Plugin, config?: any, getOuterStack = buildOuterStack()) {
  // check if it's a valid plugin
  const callback = this.resolve(plugin)
  if (!callback) throw new Error('invalid plugin, expect function or object with an "apply" method, received ' + typeof plugin)
  this.ctx.fiber.assertActive()

  let runtime = this._internal.get(callback)
  if (!runtime) {
    let name = plugin.name
    if (name === 'apply') name = undefined
    runtime = { name, callback, fibers: new DisposableList(), Config: plugin.Config }
    this._internal.set(callback, runtime)
  }

  const fiber = new Fiber(this.ctx, config, Inject.resolve(plugin.inject), runtime, getOuterStack)
  const wrapped = Object.create(fiber) as Fiber & PromiseLike<Fiber>
  wrapped.then = (onFulfilled, onRejected) => {
    return fiber.await().then(onFulfilled, onRejected)
  }
  return wrapped
}
```

插件可以是函数（`apply` 形式）、类（Service 或带 apply 的类）、或 `{ apply }` 对象。`ctx.inject(deps, cb)` 等价 `ctx.plugin({inject, apply: cb})`。

## 2.6 配置层：cordis.yml 空 root + patch 覆盖

### 空 root

desktop profile 的 `~/.dsh/profiles/desktop/cordis.yml` 实测内容就是 `[]\n`（3 字节空数组）。它由 `Include` 挂载，`Include` 的 `[Service.init]` 在文件不存在且 `config.initial` 存在时写 `initial`（默认 `[]`）再读：

```ts
// deepseek-harness/vendor/include/src/index.ts:273-289（节选）
async* [Service.init]() {
  let candidate: ReadCandidate
  try {
    candidate = (await this.read(true))!
  } catch (error) {
    if (!(error instanceof ConfigFileError) || error.stage !== 'read' || (error.cause as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error
    if (this.config.initial) {
      await this._writeFile(this.config.initial as any)
      candidate = (await this.read(true))!
    } else {
      throw new Error(`config file not found: ${this.filename}`)
    }
  }

  yield () => this.stop()
  await this.apply(candidate)
}
```

真正的 entries 全部来自 bundle 的 `- insert:`。

### patch 覆盖的权威实现

```ts
// deepseek-harness/vendor/include/src/index.ts:58-128（节选）
export function applyEntryPatches(
  data: EntryOptions[],
  patches: PatchOptions[] | undefined,
  warn: (message: string, ...args: any[]) => void,
): EntryOptions[] {
  data = structuredClone(data)
  if (!patches?.length) return data

  const entryMap = new Map<string, EntryOptions>()
  const buildMap = (entries: EntryOptions[]) => {
    for (const entry of entries) {
      if (entry.id) entryMap.set(entry.id, entry)
      if (entry.group && Array.isArray(entry.config)) {
        buildMap(entry.config)
      }
    }
  }
  buildMap(data)

  for (const patch of patches) {
    const { id, insert, name, ...overrides } = patch

    if (insert) {
      if (id) {
        const target = entryMap.get(id)
        if (!target) {
          warn('patch insert: entry %C not found', id)
          continue
        }
        if (!target.group) {
          warn('patch insert: entry %C is not a group', id)
          continue
        }
        if (!Array.isArray(target.config)) target.config = []
        target.config.push(...insert)
      } else {
        data.push(...insert)
      }
      buildMap(insert)
      continue
    }

    if (!id) {
      warn('patch: id is required for non-insert patches')
      continue
    }

    const target = entryMap.get(id)
    if (!target) {
      warn('patch: entry %C not found', id)
      continue
    }

    if (name && name !== target.name) {
      warn('patch: name mismatch for %C (expected %C, got %C), skipping', id, target.name, name)
      continue
    }

    for (const [key, value] of Object.entries(overrides)) {
      if (key === 'id') continue
      target[key] = value
    }
  }

  return data
}
```

**三个关键语义**：

1. patch 按 `id` 找 target，只覆盖 `overrides`（解构后剩余的 config/disabled/inject 等字段）里显式列出的字段。
2. **`name` 是校验字段不是覆盖字段**（`:116-119`）：patch 写 name 且不匹配 → 跳过并警告；不写 name → 跳过校验。
3. `insert` 的 entries 会被 index（`:101`），后面的 layer 能 patch 前面插入的行。

> **纠正本次会话的一个误判**：曾担心「web-app 覆盖 session-query-sqlite 时 name 丢失」。实际上 patch 只覆盖显式字段，web-app 只写了 `config`，`target.name` 原样保留 base 的值，根本不会走到 Loader 的整体替换路径。`sessionQuery unavailable` 的真根因是**时序问题**（apply 时服务还没注册），不是 name 丢失。

## 2.7 组合层：bundle / profile / preset

### bundle 声明

```json
// deepseek-harness/packages/bundle/base/package.json:36-40
"dsh": {
  "bundle": {
    "patch": "./cordis.patch.yml"
  }
},
```

### bundle patch 里的 plugin entry 示例（session-query-sqlite）

```yaml
# deepseek-harness/packages/bundle/base/cordis.patch.yml:117-121
    - id: session-query-sqlite
      name: '@deepseek-ai/dsh-session-query-sqlite'
      config:
        path: ':memory:'
        openAt: never
```

`id` 是后续 layer patch 的锚点；`name` 是 Loader `import()` 的模块说明符；`config` 是该插件自己的配置。

### profile 的 bundles 列表（第三方插件挂载点）

```json
// ~/.dsh/profiles/desktop/package.json
{
  "name": "dsh-profile-desktop",
  "private": true,
  "dependencies": {
    "@linxin666/dsh-ssh": "0.3.4",
    "@nanmicoder/dsh-agent-teams": "0.1.10",
    "@openviking/dsh-memory-plugin": "0.2.1",
    "@xmanrui/dsh-im": "0.16.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@openviking/dsh-memory-plugin",
        "@xmanrui/dsh-im",
        "@nanmicoder/dsh-agent-teams"
      ]
    }
  }
}
```

`dependencies` + `dsh.profile.bundles` 就是第三方插件挂进来的完整入口：npm/pnpm 装进 profile → 列进 bundles → 启动时按顺序应用它们的 `cordis.patch.yml`。

## 2.8 一个真实第三方插件：agent-teams

`@nanmicoder/dsh-agent-teams` 的入口（`node_modules/@nanmicoder/dsh-agent-teams/lib/index.js`）：

```js
export const inject = ['tools', 'llm', 'subagents', 'systemPrompt', 'agents'];   // :31

export function apply(ctx, config) {                                             // :54
  registerAgentTeamsTools(ctx, resolved);          // :84 → 注册 agent_teams_* 工具
  ctx.inject(['commands'], (commandCtx) => {       // :96 → 懒注册 command（可选服务）
    registerAgentTeamsCommand(commandCtx);
  });
  // 注册 web surface、监听事件、ctx.effect(...) 等
}
```

**要点**：
- `inject` 声明必需服务（tools/llm/subagents/systemPrompt/agents），Cordis 等它们就绪才执行 `apply`。
- 注册工具 = `ctx.tools.register(defineTool({...}))`，schema 自动进 system prompt。
- 可选服务（commands）用 `ctx.inject(['commands'], cb)` 懒挂，而不是写进主 `inject`。

## 2.9 最小插件：从零写一个

一个最小 DSH 插件 = 一个 `apply(ctx, config)` 函数 + 一行 `insert` entry。

### 目录结构

```
my-dsh-plugin/
├── package.json
├── cordis.patch.yml
└── lib/index.js
```

### package.json

```json
{
  "name": "@me/dsh-my-plugin",
  "version": "0.1.0",
  "dsh": { "bundle": { "patch": "./cordis.patch.yml" } },
  "exports": {
    ".": { "types": "./lib/index.d.ts", "default": "./lib/index.js" },
    "./cordis.patch.yml": "./cordis.patch.yml",
    "./package.json": "./package.json"
  }
}
```

### cordis.patch.yml

```yaml
- insert:
    - id: my-plugin
      name: '@me/dsh-my-plugin'
      config:
        greeting: hello
```

### lib/index.js（插件主体）

```js
import { defineTool } from '@deepseek-ai/dsh-tools'

export const inject = ['tools']

export function apply(ctx, config) {
  // 1. 注册一个工具，agent 就能用自然语言调用它
  ctx.tools.register(defineTool({
    name: 'my_greeting',
    description: `Return the configured greeting: ${config.greeting}.`,
    parameters: {
      name: { type: 'string', required: true, description: 'Who to greet.' },
    },
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute(args) {
      return { greeting: `${config.greeting}, ${args.name}` }
    },
  }))

  // 2. 注册一个可撤销的 effect（监听事件），fiber 卸载时自动清理
  ctx.on('agent/status', ({ agent, status }) => {
    if (status === 'running') ctx.logger.info(`agent ${agent.id} started`)
  })
}
```

### 装进 profile 并验证

```sh
dsh plugin --profile desktop add @me/dsh-my-plugin
# 等价于：pnpm 安装进 profile + 加入 dsh.profile.bundles
dsh --profile web --dump-config   # 看 my-plugin 这一行
```

### 启动时完整执行链

```
app-boot 读 profile → mount 空 cordis.yml（Include，vendor/include/src/index.ts:174）
→ 按 bundles 顺序应用每个 bundle 的 cordis.patch.yml（applyEntryPatches，:58）
→ 用户 cordis.patch.yml 覆盖
→ Loader 对每个 entry：import(entry.name)（vendor/loader/src/config/entry.ts:216-217）
→ 拿到 apply 函数 → ctx.plugin({inject, apply})（vendor/cordis/src/registry.ts:316）
→ Fiber: PENDING 等 inject 服务 → LOADING → apply 执行 → ACTIVE（vendor/cordis/src/fiber.ts）
→ apply 里 ctx.tools.register(...) 注册工具 → schema 进 system prompt → agent 可见
→ fiber 卸载时 disposer 逆序执行，工具移除（HMR 安全）
```

## 2.10 服务暴露成 agent 工具（extensions/tool-cordis）

`extensions/` 四个包是「agent 自修改 runtime」的桥接层，不是普通插件必经路径。以 `tool-cordis` 为例，看它如何把 `ctx.cordisInspect` 服务暴露成 agent 工具：

```ts
// deepseek-harness/packages/extensions/tool-cordis/src/index.ts:34-60（节选）
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:cordis', order: 115, text: CORDIS_SYSTEM_PROMPT })
  for (const provider of hostInspectProviders(ctx)) {
    ctx.effect(() => ctx.cordisInspect.register(provider), `tool-cordis: inspect ${provider.manifest.id}`)
  }

  ctx.tools.register(defineTool({
    name: 'cordis_inspect_list',
    description:
      'List every Cordis Inspect Provider currently known to the Host, including local Host Providers and the latest '
      + 'manifests synchronized from the Client. ...',
    parameters: {},
    output: {
      schema: { type: 'json' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    },
    execute(_args, _exec): Promise<JsonValue> {
      return Promise.resolve({ providers: ctx.cordisInspect.list() } as unknown as JsonValue)
    },
    presentCall: presentInspectListCall,
  }))
```

**模式总结**：`apply` 里 `ctx.tools.register(defineTool({ name, description, parameters, output: {schema, render}, execute, presentCall }))` —— `execute` 就是工具体，内部调用 `ctx.<服务名>`（这里是 `ctx.cordisInspect`）。服务名通过 `inject` 声明，工具注册经 `ctx.tools.register` 暴露给 agent。

`extensions/` 四包职责：

| 包 | 角色 |
|---|---|
| `tool-cordis` | 自指工具集：`cordis_define`/`cordis_inspect_*`，让 agent 挂载/卸载自己写的插件 |
| `cordis-host-runner` | host 侧动态插件生命周期沙箱（`DynamicCordisRunnerService`） |
| `cordis-client-runner` | client 侧双半插件加载（事件订阅、closure 求值） |
| `ui-cordis` | client 侧 `cordis_define` 工具行的卡片（run/stop 开关） |

---

## 总结

- **内核**：`ReactLoopAgent` 驱动「日志派生请求 → 流式收模型输出 → 调度工具 → 结果落回日志 → 决定是否再来一步」的 turn/step 双循环；模型看到的每一字节都能从 session 日志重建。
- **插件机制**：一切皆插件。一个插件 = 一个 `apply(ctx, config)` 函数 + 一份 `cordis.patch.yml` entry；靠 `inject` 声明依赖、`ctx.get` 懒读可选服务、`ctx.effect`/`ctx.on`/`tools.register` 注册可撤销贡献；Loader 按 bundle 顺序组装，Fiber 按服务可用性激活。
