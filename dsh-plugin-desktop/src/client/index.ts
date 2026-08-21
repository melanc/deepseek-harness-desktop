import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type convergence only: locale/theme declarations expose settings slot rows.
// The desktop client does not load or register a settings surface.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { applyAdvancedShell } from './advanced-shell.ts'
import { applyArchiveConfirm } from './archive-confirm/index.ts'
import { startRendererBootReporter } from './boot-health.ts'
import { installDesktopDirectoryPickerBridge, requestDesktopDirectoryValidation } from './directory-picker.ts'
import { parseDesktopClientEnvironment } from './environment.ts'
import { applyMessageChannelsSection } from './message-channels/index.tsx'
import { installSidebarFooterStyles } from './styles.ts'
import { applyTasksView } from './tasks-view/index.tsx'
import { installWorkspaceFolderDrop } from './workspace-folder-drop.ts'

export { applyAdvancedShell } from './advanced-shell.ts'
export { applyArchiveConfirm, ARCHIVE_CONFIRM_OVERLAY_ID } from './archive-confirm/index.ts'
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

/** Services required by advanced presentation. */
export const inject = [
  'slots',
  'sessions',
  'theme',
  'workspaces',
]

/** Register desktop-owned client surfaces for the current BrowserWindow mode. @param ctx - browser Cordis context. */
export function apply(ctx: ClientContext): void {
  const environment = parseDesktopClientEnvironment(window.location.search)
  if (!environment) return
  ctx.effect(
    () => startRendererBootReporter(ctx.loader),
    'dsh-plugin-desktop: renderer boot health report',
  )
  ctx.effect(
    () => installWorkspaceFolderDrop({
      create: input => ctx.workspaces.create(input),
      startSession: workspaceId => { ctx.workspaces.startSession(workspaceId) },
      ...(environment.platform === 'win32'
        ? { validateDirectory: (path: string) => requestDesktopDirectoryValidation(path) }
        : {}),
    }),
    'dsh-plugin-desktop: workspace folder drop',
  )
  // The sidebar footer hosts full-row actions (market launcher, Cordis panel);
  // stack them vertically so they never squeeze each other in the flex row.
  ctx.effect(
    () => installSidebarFooterStyles(),
    'dsh-plugin-desktop: sidebar footer stacking',
  )
  if (environment.platform === 'win32') {
    ctx.effect(
      () => installDesktopDirectoryPickerBridge(),
      'dsh-plugin-desktop: native directory picker bridge',
    )
  }
  if (environment.mode === 'advanced') applyAdvancedShell(ctx, environment)

  // Message-channels settings section: registers a `settings.section` page
  // when the settings scope service is available (composed by ui-settings).
  applyMessageChannelsSection(ctx)

  // Inputs view: registers the 会话页「输入」tab (records user inputs).
  applyTasksView(ctx)

  // Archive confirmation: wrap the archive RPC with a confirmation dialog.
  applyArchiveConfirm(ctx)
}
