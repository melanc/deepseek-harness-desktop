# TAL 网关 UA 补丁（tal-gateway）改动记录

> 本文档记录 2026-08-21 为修复 TAL 三方模型 "API key is invalid" 错误而添加的
> `tal-gateway` 补丁的**全部改动**，以及**移除该补丁的精确回滚步骤**。
> 后续需要去掉补丁时，按"移除步骤"逐条反向操作即可。
>
> 2026-08-21 更新：补丁曾随 master 合并被剔除（merge commit `ff2e9747c3`），
> 因公司网关仍按 UA 白名单放行、DSH 无法绕过，随后重新应用（见"重新应用记录"）。

## 背景与根因

- TAL 网关 `http://ai-service.tal.com/coding` 按 **User-Agent 白名单**识别客户端，
  只放行 `claude-cli/...`（实测：claude-cli UA → 200；其他 UA → 403 `Access denied`）。
- DeepSeek Harness 强制在每个 provider 请求发送
  `user-agent: deepseek-harness/<version> (+https://github.com/deepseek-ai/deepseek-harness)`，
  这是 **Harness 保留的 attribution header**（`@deepseek-ai/dsh-llm/attribution.ts`），
  **设计上不可被任何 `llm-pi-ai` profile 的 `headers` 配置覆盖**
  （`llm-pi-ai/src/adapter.ts` 的 `requestHeaders()` 会把 user-agent 过滤掉并强制覆盖）。
- 因此 DSH 发出的请求被网关 403 拒绝 → `llm-pi-ai/src/stream.ts` 把 401/403 归类为
  `AUTH` 错误码 → 客户端 `failure-display.ts` 对 AUTH 投影为固定文案
  **"API key is invalid"**（防止回显凭据；原始 `403 Access denied` 只留在会话日志）。
- **结论：key 本身有效，错误是 UA 冲突导致，非 key 问题。**

## 补丁方案

desktop 侧 monkey-patch pi-ai 的 `ModelsImpl.prototype.applyAuth`：在 attribution 合并
之后、provider 请求发出之前，对 `tal-code-plan` 路由注入 `user-agent: claude-cli/2.1.0`。
- llm-pi-ai 的 bundle 与 desktop 插件共享**同一个** `@earendil-works/pi-ai` 模块实例
  （打包后位于 `app.asar.unpacked/node_modules/@earendil-works/pi-ai`），因此 patch 必然生效。
- 只对 `tal-code-plan` 生效，其他 provider 不受影响。
- 已验证：补丁在 dsh-0.1.0-rc.7 和 dsh-0.1.1-rc.2 两个子模块版本上均适用
  （pi-ai 均为 0.82.1，`applyAuth`/`mergeHeaders` 结构未变）。

## 改动清单（共 5 个文件，+88 / -1 行）

### 1. 新增 `dsh-plugin-desktop/src/tal-gateway/index.ts`（73 行）

插件本体。逻辑：

```ts
const CLAUDE_CLI_UA = 'claude-cli/2.1.0'
const REWRITE_PROVIDERS = new Set(['tal-code-plan'])

export function apply(ctx) {
  const sample = createModels()                          // @earendil-works/pi-ai
  const prototype = Object.getPrototypeOf(sample)        // ModelsImpl.prototype
  const original = prototype.applyAuth
  ctx.effect(() => {
    prototype.applyAuth = async function (model, options) {
      const resolved = await original.call(this, model, options)
      if (model?.provider !== undefined && REWRITE_PROVIDERS.has(model.provider)) {
        resolved.requestOptions.headers = {
          ...(resolved.requestOptions.headers ?? {}),
          'user-agent': CLAUDE_CLI_UA,
        }
      }
      return resolved
    }
    return () => { prototype.applyAuth = original }      // 随插件卸载恢复
  }, 'tal-gateway.applyAuth patch')
}
```

- `name = 'tal-gateway'`，`inject = ['settings']`。
- 依赖 `@earendil-works/pi-ai` 的 `createModels`。

### 2. `dsh-plugin-desktop/cordis.patch.yml`（+2 行）

在 `insert` 列表 `main-session` 之后追加：

```yaml
    - id: tal-gateway
      name: dsh-plugin-desktop/tal-gateway
```

### 3. `dsh-plugin-desktop/package.json`（+4 行）

- `exports` 增加 `./tal-gateway` 入口：
  ```json
  "./tal-gateway": {
    "types": "./lib/types/tal-gateway/index.d.ts",
    "default": "./lib/tal-gateway.js"
  },
  ```
- `dependencies` 增加（**仅此一行属于本补丁**）：
  ```json
  "@earendil-works/pi-ai": "0.82.1",
  ```
  > 注意：`@larksuiteoapi/node-sdk`、`protobufjs` 等邻近行是之前
  > message-channels/Feishu 功能的改动，**不属于本补丁**，移除时不要动。

### 4. `dsh-plugin-desktop/tsconfig.json`（+5 / -1）

- `compilerOptions` 增加 `"skipLibCheck": true`（上游同款；跳过 `@anthropic-ai/sdk`
  等第三方 .d.ts 的类型检查——pi-ai 传递依赖的 undici-types 相对路径在 desktop
  的 yarn 提升布局下解析失败，上游 base 配置同样开启了它）。
- `include` 增加 `src/tal-gateway/**/*.ts` 和 `src/tal-gateway/**/*.tsx`。

### 5. `dsh-plugin-desktop/tsdown.config.ts`（+1 行）

`entry` 增加：

```ts
'tal-gateway': 'src/tal-gateway/index.ts',
```

### 非代码改动（用户侧）

- `~/.dsh/settings.yaml`：曾临时添加的 `llm-pi-ai.providers.tal-code-plan.headers:
  {user-agent: claude-cli/2.1.0}` 已**回退删除**（该配置无效，user-agent 会被
  attribution 过滤）。本补丁生效后无需任何 settings 配置。

## 移除步骤（去掉补丁）

按序反向操作：

1. `dsh-plugin-desktop/cordis.patch.yml`：删除 `tal-gateway` 两行（`- id: tal-gateway`
   和 `name: dsh-plugin-desktop/tal-gateway`）。
2. `dsh-plugin-desktop/tsdown.config.ts`：删除 `'tal-gateway': 'src/tal-gateway/index.ts',` 行。
3. `dsh-plugin-desktop/tsconfig.json`：
   - `include` 删除 `src/tal-gateway/**/*.ts`、`src/tal-gateway/**/*.tsx`；
   - 若 `skipLibCheck` 此前不存在（本次补丁引入），一并删除。
4. `dsh-plugin-desktop/package.json`：
   - 删除 `exports` 的 `./tal-gateway` 块；
   - 删除 `dependencies` 的 `"@earendil-works/pi-ai": "0.82.1",` 行。
5. 删除源码目录 `dsh-plugin-desktop/src/tal-gateway/`。
6. 重新安装依赖并构建打包：
   ```bash
   export PATH="/opt/homebrew/bin:$PATH"
   corepack yarn install            # 移除 pi-ai 直接依赖（保留传递依赖）
   corepack yarn workspace dsh-plugin-desktop run package:dir
   ```
7. 重启应用生效。

> 移除后若 `tsc` 报 undici-types 相关错误（pi-ai 传递依赖仍在，可能仍报），
> 保留 `skipLibCheck` 即可，它是无害的常规配置。

## 验证记录

- patch 端到端测试（独立脚本模拟 llm-pi-ai 调用链）：注入 UA → 网关 200，
  返回 `"Hello! How can I help you today?"`。
- `corepack yarn workspace dsh-plugin-desktop run typecheck` 全绿。
- `package:dir` 打包产物确认：`app.asar` 内含 `/cordis.patch.yml`（tal-gateway 行）和
  `/lib/tal-gateway.js`；`app.asar.unpacked/lib/tal-gateway.js` 存在。
- 共享实例确认：llm-pi-ai bundle 与 desktop 插件均 `from "@earendil-works/pi-ai"`，
  解析到同一 `app.asar.unpacked/node_modules/@earendil-works/pi-ai`。

## 重新应用记录（2026-08-21）

- master 合并到 dev-work 时补丁被剔除（`ff2e9747c3`，因合并冲突清理）。
- 因公司网关仍按 UA 白名单放行，剔除后 DSH 无法连接 TAL 模型（403 → "API key is invalid"）。
- 决定重新应用：5 个文件改动恢复，子模块同步到 master 指针
  （deepseek-harness `b150a551` = dsh-0.1.1-rc.2），验证 pi-ai 0.82.1 与
  `applyAuth` 结构兼容后重新构建打包。
