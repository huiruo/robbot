import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { HarnessRuntimeStatus, SessionRecord, WorkspaceRecord } from '../robbot-api'

export type RenameTarget =
  | { kind: 'workspace'; target: WorkspaceRecord }
  | { kind: 'session'; target: SessionRecord }

export function useWorkspaceChat(accountId: string) {
  const [status, setStatus] = useState<HarnessRuntimeStatus | null>(null)
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([])
  const [sessions, setSessions] = useState<SessionRecord[]>([])
  const [workspaceId, setWorkspaceId] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [renameTarget, setRenameTarget] = useState<RenameTarget | null>(null)
  const warmedWorkspaceKeysRef = useRef<Set<string>>(new Set())
  const selectedWorkspaceId = workspaceId ?? workspaces[0]?.id ?? null
  const selectedSessionId = sessionId ?? sessions[0]?.id ?? null

  const workspace = useMemo(
    () => workspaces.find((item) => item.id === selectedWorkspaceId) ?? null,
    [selectedWorkspaceId, workspaces],
  )
  const session = useMemo(
    () => sessions.find((item) => item.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  )

  const refreshStatus = useCallback(async () => {
    setStatus(await window.robbot.harness.getStatus())
  }, [])

  const refreshWorkspaces = useCallback(async () => {
    setWorkspaces(await window.robbot.workspace.list(accountId))
  }, [accountId])

  const refreshSessions = useCallback(
    async (nextWorkspaceId: string | null = workspaceId) => {
      setSessions(await window.robbot.session.list(accountId, nextWorkspaceId ?? undefined))
    },
    [accountId, workspaceId],
  )

  const warmupRuntime = useCallback((targetWorkspace: WorkspaceRecord) => {
    const key = `${accountId}:${targetWorkspace.id}`
    if (warmedWorkspaceKeysRef.current.has(key)) {
      return
    }

    warmedWorkspaceKeysRef.current.add(key)
    void window.robbot.harness.warmupRuntime({
      accountId,
      workspaceId: targetWorkspace.id,
    }).catch((cause) => {
      warmedWorkspaceKeysRef.current.delete(key)
      console.warn('[robbot] DSH runtime warmup failed', cause)
    })
  }, [accountId])

  const loadOrCreateDefaultSession = useCallback(
    async (targetWorkspace: WorkspaceRecord) => {
      const existingSessions = await window.robbot.session.list(accountId, targetWorkspace.id)
      if (existingSessions.length) {
        setSessions(existingSessions)
        setSessionId((current) => current && existingSessions.some((item) => item.id === current) ? current : existingSessions[0].id)
        return
      }

      const created = await window.robbot.session.create({
        accountId,
        workspaceId: targetWorkspace.id,
        title: 'New Chat',
      })
      setSessions([created])
      setSessionId(created.id)
    },
    [accountId],
  )

  const bootstrap = useCallback(async () => {
    try {
      await window.robbot.account.upsertCurrent({ id: accountId, username: 'Local' })
      await refreshStatus()
      const loadedWorkspaces = await window.robbot.workspace.list(accountId)
      setWorkspaces(loadedWorkspaces)
      const targetWorkspace = loadedWorkspaces.find((item) => item.id === workspaceId) ?? loadedWorkspaces[0]
      if (targetWorkspace) {
        setWorkspaceId(targetWorkspace.id)
        await loadOrCreateDefaultSession(targetWorkspace)
        warmupRuntime(targetWorkspace)
      } else {
        setSessions([])
      }
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [accountId, loadOrCreateDefaultSession, refreshStatus, warmupRuntime, workspaceId])

  useEffect(() => {
    queueMicrotask(() => void bootstrap())
  }, [bootstrap])

  const selectDirectory = useCallback(async () => {
    try {
      const selected = await window.robbot.workspace.selectDirectory(accountId)
      if (!selected) {
        return
      }

      setWorkspaceId(selected.id)
      await refreshWorkspaces()
      await loadOrCreateDefaultSession(selected)
      warmupRuntime(selected)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [accountId, loadOrCreateDefaultSession, refreshWorkspaces, warmupRuntime])

  const openWorkspace = useCallback(
    async (target: WorkspaceRecord) => {
      setWorkspaceId(target.id)
      await loadOrCreateDefaultSession(target)
      warmupRuntime(target)
    },
    [loadOrCreateDefaultSession, warmupRuntime],
  )

  const createSession = useCallback(
    async (targetWorkspace = workspace) => {
      if (!targetWorkspace) {
        return
      }

      const created = await window.robbot.session.create({
        accountId,
        workspaceId: targetWorkspace.id,
        title: 'New Chat',
      })
      setSessionId(created.id)
      await refreshSessions(targetWorkspace.id)
      warmupRuntime(targetWorkspace)
    },
    [accountId, refreshSessions, warmupRuntime, workspace],
  )

  const startRename = useCallback((target: WorkspaceRecord | SessionRecord) => {
    setRenameTarget('name' in target ? { kind: 'workspace', target } : { kind: 'session', target })
  }, [])

  const renameItem = useCallback(
    async (value: string) => {
      const target = renameTarget
      const trimmed = value.trim()
      if (!target || !trimmed) {
        return
      }

      if (target.kind === 'workspace') {
        await window.robbot.workspace.rename(accountId, target.target.id, trimmed)
        await refreshWorkspaces()
      } else {
        await window.robbot.session.rename(accountId, target.target.id, trimmed)
        await refreshSessions(workspaceId)
      }
      setRenameTarget(null)
    },
    [accountId, refreshSessions, refreshWorkspaces, renameTarget, workspaceId],
  )

  const deleteWorkspace = useCallback(
    async (target: WorkspaceRecord) => {
      if (!window.confirm(`Delete workspace "${target.name}"?`)) {
        return
      }

      await window.robbot.workspace.delete(accountId, target.id)
      if (workspaceId === target.id) {
        setWorkspaceId(null)
        setSessionId(null)
      }
      await refreshWorkspaces()
      await refreshSessions(null)
    },
    [accountId, refreshSessions, refreshWorkspaces, workspaceId],
  )

  const deleteSession = useCallback(
    async (target: SessionRecord) => {
      if (!window.confirm(`Delete chat "${target.title ?? 'New Chat'}"?`)) {
        return
      }

      await window.robbot.session.delete(accountId, target.id)
      if (sessionId === target.id) {
        setSessionId(null)
      }
      await refreshSessions(workspaceId)
    },
    [accountId, refreshSessions, sessionId, workspaceId],
  )

  return {
    status,
    workspaces,
    sessions,
    workspace,
    workspaceId: selectedWorkspaceId,
    session,
    sessionId: selectedSessionId,
    error,
    renameTarget,
    setError,
    setSessionId,
    setRenameTarget,
    bootstrap,
    refreshStatus,
    refreshSessions,
    selectDirectory,
    openWorkspace,
    createSession,
    startRename,
    renameItem,
    deleteWorkspace,
    deleteSession,
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
