/**
 * tal-gateway -- Host plugin
 *
 * Restores model access through the TAL coding gateway
 * (`http://ai-service.tal.com/coding`), which admits requests only from
 * clients that identify as Claude Code (`User-Agent: claude-cli/...`).
 *
 * DeepSeek Harness marks `user-agent` as a reserved attribution header
 * (`@deepseek-ai/dsh-llm/attribution`), so no `llm-pi-ai` profile header can
 * override it and every request from this app is rejected with HTTP 403.
 * This plugin patches pi-ai's auth-application step (`ModelsImpl#applyAuth`),
 * which runs after the harness attribution merge and before the provider
 * dispatch, and injects the Claude Code user agent for the configured
 * provider routes. The patch is provider-scoped, so other pi-ai routes keep
 * the harness identity.
 *
 * Composition: requires `llm-pi-ai` (which owns the shared `pi-ai` module
 * instance this patch targets) and `settings` (to discover which provider
 * routes to rewrite). Mounted via the desktop cordis patch
 * (see `cordis.patch.yml`).
 */

import { type Context } from '@deepseek-ai/cordis'
import { createModels } from '@earendil-works/pi-ai'

/** Stable Cordis plugin name. */
export const name = 'tal-gateway'

/** Services required from the host. */
export const inject = ['settings']

/**
 * The User-Agent the TAL coding gateway accepts. Pinned to the identity
 * Claude Code sends; the gateway's admission list matches `claude-cli/...`.
 */
const CLAUDE_CLI_UA = 'claude-cli/2.1.0'

/**
 * Provider routes that speak the TAL coding gateway protocol and must send
 * the Claude Code identity. Only these routes are rewritten; every other
 * provider keeps the harness attribution.
 */
const REWRITE_PROVIDERS = new Set(['tal-code-plan'])

/** Apply the user-agent rewrite as one prototype patch, disposed with the plugin. */
export function apply(ctx: Context): void {
  // `createModels()` returns a `ModelsImpl` instance; its constructor's
  // prototype is the shared class every pi-ai `Models` collection is built
  // from, so patching it once reaches the collections `llm-pi-ai` owns.
  const sample = createModels()
  const prototype = Object.getPrototypeOf(sample) as {
    applyAuth: (model: { provider: string }, options?: unknown) => Promise<{
      requestModel: unknown
      requestOptions: { headers?: Record<string, string> }
    }>
  }
  const original = prototype.applyAuth
  ctx.effect(() => {
    prototype.applyAuth = async function (this: unknown, model, options) {
      const resolved = await original.call(this, model, options)
      if (model?.provider !== undefined && REWRITE_PROVIDERS.has(model.provider)) {
        resolved.requestOptions.headers = {
          ...(resolved.requestOptions.headers ?? {}),
          'user-agent': CLAUDE_CLI_UA,
        }
      }
      return resolved
    }
    return () => {
      prototype.applyAuth = original
    }
  }, 'tal-gateway.applyAuth patch')
}
