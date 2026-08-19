import { useCallback, useEffect, useMemo, useState } from 'react'
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

  const bootstrap = useCallback(async () => {
    try {
      await window.robbot.account.upsertCurrent({ id: accountId, username: 'Local' })
      await Promise.all([refreshStatus(), refreshWorkspaces(), refreshSessions()])
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [accountId, refreshSessions, refreshStatus, refreshWorkspaces])

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
      setSessionId(null)
      await refreshWorkspaces()
      await refreshSessions(selected.id)
    } catch (cause) {
      setError(errorMessage(cause))
    }
  }, [accountId, refreshSessions, refreshWorkspaces])

  const openWorkspace = useCallback(
    async (target: WorkspaceRecord) => {
      setWorkspaceId(target.id)
      setSessionId(null)
      await refreshSessions(target.id)
    },
    [refreshSessions],
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
    },
    [accountId, refreshSessions, workspace],
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
