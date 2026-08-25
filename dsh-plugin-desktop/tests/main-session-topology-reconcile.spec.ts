import { describe, expect, it, vi } from 'vitest'
import {
  reconcileWorkspaceTopology,
  type ReconcileDeps,
  type ReconcileWorkspaceRegistry,
} from '../src/main-session/topology-reconcile.ts'

// ============================================================
// Test doubles
// ============================================================

interface FakeWorkspace {
  id: string
  sessionIds: string[]
  status: () => Promise<'ok' | 'missing-dir'>
}

function registry(overrides: Partial<{
  workspaces: FakeWorkspace[]
  archived: string[]
  onDelete: (id: string) => Promise<boolean>
  onArchive: (id: string) => Promise<void>
}> = {}): ReconcileWorkspaceRegistry {
  const workspaces = overrides.workspaces ?? []
  const archived = overrides.archived ?? []
  return {
    list: () => workspaces.map(w => ({
      id: w.id,
      sessionIds: w.sessionIds,
      status: w.status,
    })),
    delete: overrides.onDelete ?? (async () => true),
    archiveSession: overrides.onArchive ?? (async () => {}),
    archivedSessionIds: archived,
  }
}

function deps(overrides: Partial<{
  workspaceRegistry: ReconcileWorkspaceRegistry
  live: string[]
  persisted: string[]
  onPersisted: () => Promise<Array<{ id: string }>>
}> = {}): ReconcileDeps {
  return {
    workspaceRegistry: overrides.workspaceRegistry ?? registry(),
    listLiveAgents: () => (overrides.live ?? []).map(id => ({ id })),
    listPersisted: overrides.onPersisted
      ?? (async () => (overrides.persisted ?? []).map(id => ({ id }))),
  }
}

function okWorkspace(id: string, sessionIds: string[] = []): FakeWorkspace {
  return { id, sessionIds, status: async () => 'ok' }
}

function missingWorkspace(id: string, sessionIds: string[] = []): FakeWorkspace {
  return { id, sessionIds, status: async () => 'missing-dir' }
}

// ============================================================
// Tests
// ============================================================

describe('reconcileWorkspaceTopology', () => {
  it('removes workspaces whose directory is missing', async () => {
    const onDelete = vi.fn(async () => true)
    const report = await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({
        workspaces: [okWorkspace('ws-ok'), missingWorkspace('ws-gone')],
        onDelete,
      }),
    }))
    expect(onDelete).toHaveBeenCalledTimes(1)
    expect(onDelete).toHaveBeenCalledWith('ws-gone')
    expect(report.removedWorkspaces).toEqual(['ws-gone'])
    expect(report.archivedSessions).toEqual([])
  })

  it('keeps workspaces with an existing directory', async () => {
    const onDelete = vi.fn(async () => true)
    await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({
        workspaces: [okWorkspace('ws-ok', ['s-1'])],
        onDelete,
      }),
    }))
    expect(onDelete).not.toHaveBeenCalled()
  })

  it('archives stray live and persisted sessions', async () => {
    const onArchive = vi.fn(async () => {})
    const report = await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({
        workspaces: [okWorkspace('ws-1', ['s-accounted'])],
        onArchive,
      }),
      live: ['s-live-stray'],
      persisted: ['s-persisted-stray', 's-accounted'],
    }))
    expect(onArchive).toHaveBeenCalledTimes(2)
    expect(onArchive).toHaveBeenCalledWith('s-live-stray')
    expect(onArchive).toHaveBeenCalledWith('s-persisted-stray')
    expect(report.archivedSessions).toEqual(['s-live-stray', 's-persisted-stray'])
  })

  it('does not archive accounted or already-archived sessions', async () => {
    const onArchive = vi.fn(async () => {})
    await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({
        workspaces: [okWorkspace('ws-1', ['s-accounted'])],
        archived: ['s-already-archived'],
        onArchive,
      }),
      live: ['s-accounted', 's-already-archived'],
      persisted: [],
    }))
    expect(onArchive).not.toHaveBeenCalled()
  })

  it('never archives the main session id', async () => {
    const onArchive = vi.fn(async () => {})
    await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({ onArchive }),
      live: ['main-session'],
      persisted: ['main-session'],
    }))
    expect(onArchive).not.toHaveBeenCalled()
  })

  it('continues after a workspace status failure', async () => {
    const onDelete = vi.fn(async () => true)
    const failing = {
      id: 'ws-boom',
      sessionIds: [],
      status: async (): Promise<'ok' | 'missing-dir'> => { throw new Error('stat failed') },
    }
    const report = await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({
        workspaces: [failing, missingWorkspace('ws-gone')],
        onDelete,
      }),
    }))
    expect(onDelete).toHaveBeenCalledWith('ws-gone')
    expect(report.removedWorkspaces).toEqual(['ws-gone'])
  })

  it('continues after an archive failure', async () => {
    const onArchive = vi.fn(async (id: string) => {
      if (id === 's-boom') throw new Error('unknown session')
    })
    const report = await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({ onArchive }),
      live: ['s-boom', 's-ok'],
      persisted: [],
    }))
    expect(onArchive).toHaveBeenCalledWith('s-boom')
    expect(onArchive).toHaveBeenCalledWith('s-ok')
    expect(report.archivedSessions).toEqual(['s-ok'])
  })

  it('continues after a persisted listing failure', async () => {
    const onArchive = vi.fn(async () => {})
    const report = await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({ onArchive }),
      live: ['s-live-stray'],
      onPersisted: async () => { throw new Error('storage fault') },
    }))
    expect(onArchive).toHaveBeenCalledWith('s-live-stray')
    expect(report.archivedSessions).toEqual(['s-live-stray'])
  })

  it('deduplicates ids appearing in both live and persisted sets', async () => {
    const onArchive = vi.fn(async () => {})
    const report = await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({ onArchive }),
      live: ['s-dup'],
      persisted: ['s-dup'],
    }))
    expect(onArchive).toHaveBeenCalledTimes(1)
    expect(report.archivedSessions).toEqual(['s-dup'])
  })

  it('reports failures through the provided logger without throwing', async () => {
    const warn = vi.fn()
    const report = await reconcileWorkspaceTopology({
      ...deps({
        workspaceRegistry: registry({
          onArchive: async () => { throw new Error('boom') },
        }),
        live: ['s-stray'],
        persisted: [],
      }),
      log: { info: vi.fn(), warn },
    })
    expect(warn).toHaveBeenCalled()
    expect(report.archivedSessions).toEqual([])
  })

  it('resolves without error when there is nothing to change', async () => {
    const report = await reconcileWorkspaceTopology(deps({
      workspaceRegistry: registry({ workspaces: [okWorkspace('ws-1', ['s-1'])] }),
      live: ['s-1'],
      persisted: [],
    }))
    expect(report).toEqual({ removedWorkspaces: [], archivedSessions: [] })
  })
})
