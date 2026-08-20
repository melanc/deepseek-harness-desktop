import { describe, expect, it } from 'vitest'
import { slugifyTitle, DEFAULT_WORKSPACES_ROOT } from '../src/main-session/workspace-path.ts'

// ============================================================
// Tests
// ============================================================

describe('slugifyTitle', () => {
  it('slugifies a title to kebab-case', () => {
    expect(slugifyTitle('Project Alpha')).toBe('project-alpha')
    expect(slugifyTitle('  My   Project  ')).toBe('my-project')
    expect(slugifyTitle('A/B\\C: D')).toBe('a-b-c-d')
  })

  it('preserves CJK characters (valid folder names)', () => {
    expect(slugifyTitle('重构订单模块')).toBe('重构订单模块')
  })

  it('falls back to a timestamped name for empty titles', () => {
    const slug = slugifyTitle('')
    expect(slug).toMatch(/^workspace-[a-z0-9]+$/)
    expect(slugifyTitle('  ')).toMatch(/^workspace-[a-z0-9]+$/)
  })
})

describe('DEFAULT_WORKSPACES_ROOT', () => {
  it('points under the DSH home workspaces directory', () => {
    // Ends with the workspaces segment; absolute on posix.
    expect(DEFAULT_WORKSPACES_ROOT.endsWith('workspaces')).toBe(true)
    expect(DEFAULT_WORKSPACES_ROOT.startsWith('/')).toBe(true)
  })
})
