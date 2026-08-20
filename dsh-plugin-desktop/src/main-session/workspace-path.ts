/**
 * main-session -- default workspace root
 *
 * DSH's default workspace directory convention: all main-session-created
 * workspace folders live under `~/.dsh/workspaces/` (or `$DSH_HOME/workspaces/`
 * when DSH_HOME is configured). Each workspace session gets its own folder,
 * and every file the session creates lands inside it.
 *
 * Layout:
 *
 *   ~/.dsh/
 *     workspaces/                     ← DEFAULT_WORKSPACES_ROOT
 *       <slugified-title>/            ← one folder per main-session workspace
 *         ... session-created files ...
 */

import { mkdir, realpath } from 'node:fs/promises'
import { join } from 'node:path'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'

/** Root directory for main-session-created workspaces. */
export const DEFAULT_WORKSPACES_ROOT = dshHomePath('workspaces')

/**
 * Slugify a title into a safe folder name (kebab-case). Falls back to a
 * timestamp when the title is empty or produces no usable characters.
 */
export function slugifyTitle(title: string | undefined): string {
  const base = (title ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
  if (base.length > 0) return base
  return `workspace-${Date.now().toString(36)}`
}

/**
 * Resolve (and create) the workspace directory for a main-session-created
 * workspace. When `title` is provided, the folder is
 * `DEFAULT_WORKSPACES_ROOT/<slug>/`; otherwise a timestamped folder. The
 * directory is created (recursively) and canonicalized before returning.
 */
export async function resolveDefaultWorkspacePath(
  title: string | undefined,
): Promise<string> {
  const dir = join(DEFAULT_WORKSPACES_ROOT, slugifyTitle(title))
  await mkdir(dir, { recursive: true })
  return realpath(dir)
}
