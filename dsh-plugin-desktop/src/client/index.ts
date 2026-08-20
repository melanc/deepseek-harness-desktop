import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type convergence only: locale/theme declarations expose settings slot rows.
// The desktop client does not load or register a settings surface.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { startRendererBootReporter } from './boot-health.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyMessageChannelsSection } from './message-channels/index.tsx'
import { applyTasksView } from './tasks-view/index.tsx'
import { applyMainSessionEntry } from './main-session-entry/index.tsx'

export { applyAdvancedShell } from './advanced-shell.ts'
export {
  RENDERER_BOOT_REPORT_PATH,
  rendererBootReport,
  sendRendererBootReport,
  startRendererBootReporter,
} from './boot-health.ts'
export type { RendererBootLoader, RendererBootReport } from './boot-health.ts'
export { parseDesktopClientEnvironment } from './environment.ts'
export type { DesktopClientEnvironment, DesktopClientMode, DesktopClientPlatform } from './environment.ts'
export { applyMessageChannelsSection } from './message-channels/index.tsx'
export { applyTasksView, TASKS_VIEW_ID } from './tasks-view/index.tsx'
export { applyMainSessionEntry, MAIN_SESSION_ENTRY_ID } from './main-session-entry/index.tsx'

/** Services required by advanced presentation. */
export const inject = [
  'slots',
  'sessions',
  'theme',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)

  // Message-channels settings section: registers a `settings.section` page
  // when the settings scope service is available (composed by ui-settings).
  applyMessageChannelsSection(ctx)

  // Tasks view: registers the 会话页「任务」tab (records user inputs).
  applyTasksView(ctx)

  // Main session entry: fixed sidebar footer button opening the main session.
  applyMainSessionEntry(ctx)
}
