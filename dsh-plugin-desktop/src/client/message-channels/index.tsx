/**
 * message-channels -- Client settings section
 *
 * Web Client plugin registering a `settings.section` page for configuring
 * the message channels. The section reads/writes the `messageChannels`
 * settings namespace through `ctx.settingsScope` (loopback-only).
 *
 * v1 scope:
 * - per-channel enable + credentials (whole-channel object writes);
 * - target DSH session id for inbound routing.
 *
 * The target session field is a dropdown populated from `session.list`
 * (all persisted sessions, updatedAt descending), with a manual-input fallback
 * for ids not in the list (e.g. the system `main-session`).
 *
 * Status/test actions are intentionally deferred to a later revision (they
 * require a Host RPC channel); configuration is fully functional via the
 * settings document.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import * as React from 'react'

/** Settings namespace id for the message-channels feature. */
const MESSAGE_CHANNELS_NS = 'message-channels'

/** Select value selecting the manual-input branch. */
const MANUAL_VALUE = '__manual__'

// ============================================================
// Settings scope surface
// ============================================================

/** Snapshot store shape returned by the settings scope. */
interface SettingsSnapshot {
  status: string
  value?: Record<string, unknown>
  revision?: number
  writable: boolean
}

/** Minimal settings scope controller surface. */
interface SettingsScope {
  getSnapshot(): SettingsSnapshot
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<unknown>
}

/** Minimal settings-scope binder resolved dynamically from the client ctx. */
interface SettingsScopeBinder {
  bind(spec: { namespace: string }): SettingsScope
}

// ============================================================
// Session-list surface (loose projection of connection.api.sessions)
// ============================================================

/** One persisted session row projected from `session.list`. */
interface SessionRow {
  sessionId: string
  cwd?: string
}

/** Minimal `session.list` response envelope. */
interface SessionListResult {
  result: {
    ok: boolean
    value?: { items?: SessionRow[] }
    error?: { message?: string }
  }
}

/** Minimal sessions api surface resolved from the connection service. */
interface SessionsApi {
  list(request: { cursor?: string }): Promise<SessionListResult>
}

/** Dropdown option for one target session. */
interface SessionOption {
  sessionId: string
  label: string
}

// ============================================================
// Plugin entry
// ============================================================

/**
 * Register the message-channels settings section.
 *
 * Resolves `settingsScope` and `connection` dynamically (`ctx.get`) so the
 * desktop client bundle still activates in compositions without those
 * services; the section simply does nothing there. `ctx.slots` is always
 * present.
 */
export function applyMessageChannelsSection(ctx: ClientContext): void {
  const binder = ctx.get('settingsScope') as SettingsScopeBinder | undefined
  if (binder === undefined) return

  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'message-channels',
    order: 60,
    label: () => '消息通道',
    inject: () => ({
      scope: binder.bind({ namespace: MESSAGE_CHANNELS_NS }),
      listSessions,
    }),
  }, MessageChannelsSection))

  /**
   * Load all persisted sessions for the target-session dropdown, newest
   * first (host order). Falls back to the workspace basename, then the
   * session id, when the host has no nicer label.
   *
   * Resolves `connection` per call (the tasks-view precedent) so a section
   * opened before the connection service is present still lists sessions.
   * @returns the dropdown options; empty when the sessions api is absent.
   */
  async function listSessions(): Promise<SessionOption[]> {
    const connection = ctx.get('connection') as { api?: { sessions?: SessionsApi } } | undefined
    const sessions = connection?.api?.sessions
    if (sessions === undefined) return []
    const response = await sessions.list({})
    if (!response.result.ok || response.result.value === undefined) return []
    const items = response.result.value.items ?? []
    return items.map((row) => ({
      sessionId: row.sessionId,
      label: basename(row.cwd) || row.sessionId,
    }))
  }
}

/** Last path segment of a workspace path; empty for missing/unparseable paths. */
function basename(cwd: string | undefined): string {
  if (typeof cwd !== 'string' || cwd.length === 0) return ''
  const parts = cwd.split(/[\\/]/).filter(Boolean)
  return parts[parts.length - 1] ?? ''
}

// ============================================================
// Section component
// ============================================================

interface SectionProps {
  scope: SettingsScope
  listSessions: () => Promise<SessionOption[]>
}

function MessageChannelsSection({ scope, listSessions }: SectionProps): JSX.Element {
  const [value, setValue] = React.useState<Record<string, unknown>>(scope.getSnapshot().value ?? {})
  const [sessions, setSessions] = React.useState<SessionOption[]>([])
  const [sessionsLoaded, setSessionsLoaded] = React.useState(false)
  const [manualMode, setManualMode] = React.useState(false)

  React.useEffect(() => {
    return scope.subscribe(() => {
      setValue(scope.getSnapshot().value ?? {})
    })
  }, [scope])

  React.useEffect(() => {
    let cancelled = false
    listSessions()
      .then((options) => {
        if (cancelled) return
        setSessions(options)
        setSessionsLoaded(true)
      })
      .catch(() => {
        if (cancelled) return
        setSessionsLoaded(true)
      })
    return () => { cancelled = true }
  }, [listSessions])

  function updateWholeChannel(key: string, next: Record<string, unknown>): void {
    setValue((prev) => ({ ...prev, [key]: next }))
    void scope.set(key, next)
  }

  function updateField(key: string, value: unknown): void {
    setValue((prev) => ({ ...prev, [key]: value }))
    void scope.set(key, value)
  }

  const targetSessionId = (value.targetSessionId as string) ?? ''
  const knownSession = sessions.some((s) => s.sessionId === targetSessionId)
  const effectiveManual = manualMode || (targetSessionId !== '' && !knownSession)

  return (
    <div className="mc-section">
      <h3>消息通道</h3>
      <p className="mc-hint">
        配置即时通讯机器人，将收到的消息路由到指定的 DSH 会话。
        配置保存在 settings 文档中（打开配置文件即可查看）。
      </p>

      {renderChannel('wecomBot', '企业微信机器人', 'Bot ID', 'aib-xxx', 'Secret', 'WebSocket URL（可选）')}
      {renderChannel('feishuBot', '飞书机器人', 'App ID', '', 'App Secret', '')}

      <div className="mc-field">
        <label>目标会话 ID（入站消息路由）</label>
        {effectiveManual ? (
          <input
            type="text"
            value={targetSessionId}
            placeholder="输入 DSH 会话 ID"
            onChange={(e) => updateField('targetSessionId', e.target.value)}
          />
        ) : (
          <select
            value={knownSession ? targetSessionId : ''}
            onChange={(e) => {
              const next = e.target.value
              setManualMode(next === MANUAL_VALUE)
              if (next !== MANUAL_VALUE) updateField('targetSessionId', next)
            }}
          >
            <option value="">未设置</option>
            {sessions.map((s) => (
              <option key={s.sessionId} value={s.sessionId}>{s.label}（{s.sessionId}）</option>
            ))}
            <option value={MANUAL_VALUE}>手动输入…</option>
          </select>
        )}
        {!sessionsLoaded && <span className="mc-session-hint">加载会话列表…</span>}
        {effectiveManual && (
          <span className="mc-session-hint">
            会话 ID 不在列表中时请手动输入（例如主会话 main-session）。
          </span>
        )}
      </div>

      <style>{`
        .mc-section { display: flex; flex-direction: column; gap: 16px; padding: 4px 0; }
        .mc-hint { color: var(--dsw-alias-label-tertiary); font-size: 13px; }
        .mc-channel { border: 1px solid var(--dsw-alias-border-l2); border-radius: 12px; padding: 12px; }
        .mc-channel h4 { margin: 0 0 8px; font-size: 14px; color: var(--dsw-alias-label-primary); }
        .mc-field { display: flex; flex-direction: column; gap: 4px; margin-bottom: 8px; }
        .mc-field label { font-size: 12px; color: var(--dsw-alias-label-secondary); }
        .mc-field input,
        .mc-field select {
          border: 1px solid var(--dsw-alias-border-l2);
          background: var(--dsw-alias-bg-layer-3);
          height: 34px;
          border-radius: 8px;
          padding: 0 12px;
          font-size: 13px;
          color: var(--dsw-alias-label-primary);
          line-height: 1.5;
        }
        .mc-field input::placeholder { color: var(--dsw-alias-label-tertiary); }
        .mc-session-hint { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
        .mc-toggle { display: flex; flex-direction: row; align-items: center; gap: 8px; margin-bottom: 8px; color: var(--dsw-alias-label-primary); }
      `}</style>
    </div>
  )

  function renderChannel(
    key: 'wecomBot' | 'feishuBot',
    label: string,
    field1Label: string,
    field1Placeholder: string,
    field2Label: string,
    field3Label: string,
  ): JSX.Element {
    const cfg = ((value[key] as Record<string, unknown>) ?? {})
    const setCfg = (patch: Record<string, unknown>): void =>
      updateWholeChannel(key, { ...cfg, ...patch })

    return (
      <div className="mc-channel">
        <h4>{label}</h4>
        <label className="mc-toggle">
          <input
            type="checkbox"
            checked={!!cfg.enabled}
            onChange={(e) => setCfg({ enabled: e.target.checked })}
          />
          <span>启用</span>
        </label>
        <div className="mc-field">
          <label>{field1Label}</label>
          <input
            type="text"
            value={(cfg[key === 'wecomBot' ? 'botId' : 'appId'] as string) ?? ''}
            placeholder={field1Placeholder}
            onChange={(e) => setCfg({ [key === 'wecomBot' ? 'botId' : 'appId']: e.target.value })}
          />
        </div>
        <div className="mc-field">
          <label>{field2Label}</label>
          <input
            type="password"
            value={(cfg[key === 'wecomBot' ? 'secret' : 'appSecret'] as string) ?? ''}
            onChange={(e) => setCfg({ [key === 'wecomBot' ? 'secret' : 'appSecret']: e.target.value })}
          />
        </div>
        {field3Label !== '' && (
          <div className="mc-field">
            <label>{field3Label}</label>
            <input
              type="text"
              value={(cfg.wsUrl as string) ?? ''}
              placeholder="wss://openws.work.weixin.qq.com"
              onChange={(e) => setCfg({ wsUrl: e.target.value })}
            />
          </div>
        )}
      </div>
    )
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface Element {}
  }
}
