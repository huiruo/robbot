import { useCallback, useEffect, useRef, useState } from 'react'
import {
  clearApproval,
  seedActiveRuns,
  seedSessionMessages,
  seedSessionEvents,
  useActiveRun,
  useApproval,
  useSessionMessages,
  useSessionActivities,
  useSessionReasoning,
  useTerminalEvent,
  useTerminalEvents,
  type ApprovalState,
} from '../lib/harness-event-store'
import type { MessageRecord, SessionRecord, WorkspaceRecord } from '../robbot-api'

export function useChatRuntime(input: {
  accountId: string
  workspace: WorkspaceRecord | null
  session: SessionRecord | null
  onStatusRefresh: () => Promise<void>
  onSessionsRefresh: (workspaceId?: string | null) => Promise<void>
  onError: (message: string) => void
}) {
  const { accountId, workspace, session, onStatusRefresh, onSessionsRefresh, onError } = input
  const [prompt, setPrompt] = useState('')
  const [pendingRetryMessageId, setPendingRetryMessageId] = useState<string | null>(null)
  const terminalReloadedRef = useRef<Record<string, string>>({})
  const pendingRetryMessageIdRef = useRef<string | null>(null)
  const messages = useSessionMessages(session?.id ?? null)
  const activities = useSessionActivities(session?.id ?? null)
  const reasoning = useSessionReasoning(session?.id ?? null)
  const activeRun = useActiveRun(session?.id ?? null)
  const approval = useApproval(session?.id ?? null)
  const terminalEvent = useTerminalEvent(session?.id ?? null)
  const terminalEvents = useTerminalEvents()

  const loadMessages = useCallback(async (sessionId: string) => {
    seedSessionMessages(sessionId, await window.robbot.message.list(sessionId))
    seedSessionEvents(sessionId, await window.robbot.message.listEvents(sessionId))
  }, [])

  const refreshActiveRuns = useCallback(async () => {
    seedActiveRuns(await window.robbot.harness.listActiveRuns())
  }, [])

  useEffect(() => {
    void refreshActiveRuns()
  }, [refreshActiveRuns])

  useEffect(() => {
    if (session) {
      void loadMessages(session.id)
    }
  }, [loadMessages, session])

  useEffect(() => {
    const terminalEventItems = Object.values(terminalEvents)
    const latestEvent = terminalEventItems.find((event) => terminalReloadedRef.current[event.sessionId] !== event.runId)
    if (!latestEvent) {
      return
    }

    terminalReloadedRef.current[latestEvent.sessionId] = latestEvent.runId
    void onSessionsRefresh(workspace?.id ?? null)
    void onStatusRefresh()
  }, [onSessionsRefresh, onStatusRefresh, terminalEvents, workspace])

  useEffect(() => {
    if (terminalEvent) {
      void loadMessages(terminalEvent.sessionId)
      if (terminalEvent.type === 'run.failed') {
        const payload = terminalEvent.payload
        onError(typeof payload === 'object' && payload !== null && 'message' in payload ? String((payload as { message?: unknown }).message ?? 'DSH run failed') : 'DSH run failed')
      }
    }
  }, [loadMessages, onError, terminalEvent])

  const send = useCallback(async () => {
    if (!workspace || !session || !prompt.trim() || activeRun) {
      return
    }

    const normalizedPrompt = prompt.trim()
    setPrompt('')
    onError('')
    try {
      await window.robbot.harness.runPrompt({
        accountId,
        workspaceId: workspace.id,
        sessionId: session.id,
        prompt: normalizedPrompt,
      })
      await Promise.all([
        loadMessages(session.id),
        onSessionsRefresh(workspace.id),
        refreshActiveRuns(),
        onStatusRefresh(),
      ])
    } catch (cause) {
      setPrompt(normalizedPrompt)
      onError(errorMessage(cause))
    }
  }, [accountId, activeRun, loadMessages, onError, onSessionsRefresh, onStatusRefresh, prompt, refreshActiveRuns, session, workspace])

  const retry = useCallback(async (message: MessageRecord) => {
    if (!workspace || !session || activeRun || pendingRetryMessageIdRef.current) {
      return
    }

    pendingRetryMessageIdRef.current = message.id
    setPendingRetryMessageId(message.id)
    onError('')
    try {
      await window.robbot.harness.retryMessage(message.id)
      await Promise.all([
        loadMessages(session.id),
        onSessionsRefresh(workspace.id),
        refreshActiveRuns(),
        onStatusRefresh(),
      ])
    } catch (cause) {
      onError(errorMessage(cause))
    } finally {
      pendingRetryMessageIdRef.current = null
      setPendingRetryMessageId(null)
    }
  }, [
    activeRun,
    loadMessages,
    onError,
    onSessionsRefresh,
    onStatusRefresh,
    refreshActiveRuns,
    session,
    workspace,
  ])

  const cancel = useCallback(async () => {
    if (!session) {
      return
    }

    await window.robbot.harness.cancel(session.id)
    await refreshActiveRuns()
  }, [refreshActiveRuns, session])

  const decideApproval = useCallback(
    async (target: ApprovalState, approved: boolean) => {
      await window.robbot.harness.approve(target.sessionId, target.id, approved)
      clearApproval(target.sessionId)
      await refreshActiveRuns()
    },
    [refreshActiveRuns],
  )

  return {
    prompt,
    setPrompt,
    messages,
    activities,
    reasoning,
    activeRun,
    approval,
    pendingRetryMessageId,
    send,
    retry,
    cancel,
    decideApproval,
  }
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
