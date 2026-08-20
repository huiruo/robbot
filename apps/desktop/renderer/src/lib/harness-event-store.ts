import { useEffect, useSyncExternalStore } from 'react'
import type { ActiveRunRef, HarnessEvent, HarnessLogEntry, MessageRecord, MessageStatus } from '../robbot-api'

export type ApprovalState = {
  id: string
  sessionId: string
  title: string
  description?: string
}

export type HarnessEventSnapshot = {
  activeRunsBySessionId: Record<string, ActiveRunRef>
  messagesBySessionId: Record<string, MessageRecord[]>
  approvalsBySessionId: Record<string, ApprovalState>
  logs: HarnessLogEntry[]
  terminalEventBySessionId: Record<string, HarnessEvent>
}

const emptySnapshot: HarnessEventSnapshot = {
  activeRunsBySessionId: {},
  messagesBySessionId: {},
  approvalsBySessionId: {},
  logs: [],
  terminalEventBySessionId: {},
}
const emptyMessages: MessageRecord[] = []

let snapshot: HarnessEventSnapshot = emptySnapshot
const listeners = new Set<() => void>()
let disposeEvent: (() => void) | null = null
let disposeLog: (() => void) | null = null
let revealTimer: ReturnType<typeof setTimeout> | null = null
const revealQueues = new Map<
  string,
  {
    sessionId: string
    messageId: string
    pending: string
    terminalStatus?: MessageStatus
  }
>()

const revealIntervalMs = 24
const revealChunkSize = 12

export function startHarnessEventStore(): () => void {
  if (!disposeEvent) {
    disposeEvent = window.robbot.harness.onEvent(handleHarnessEvent)
  }

  if (!disposeLog) {
    disposeLog = window.robbot.harness.onLog((entry) => {
      setSnapshot({ ...snapshot, logs: [...snapshot.logs.slice(-99), entry] })
    })
  }

  return () => {
    disposeEvent?.()
    disposeLog?.()
    disposeEvent = null
    disposeLog = null
  }
}

export function useHarnessEvents(): void {
  useEffect(() => startHarnessEventStore(), [])
}

export function seedActiveRuns(activeRunsBySessionId: Record<string, ActiveRunRef>): void {
  setSnapshot({ ...snapshot, activeRunsBySessionId })
}

export function seedSessionMessages(sessionId: string, stored: MessageRecord[]): void {
  setSnapshot({
    ...snapshot,
    messagesBySessionId: {
      ...snapshot.messagesBySessionId,
      [sessionId]: mergeStoredMessages(snapshot.messagesBySessionId[sessionId] ?? [], stored, sessionId),
    },
  })
}

export function clearSessionMessages(sessionId: string): void {
  const nextMessages = { ...snapshot.messagesBySessionId }
  delete nextMessages[sessionId]
  setSnapshot({ ...snapshot, messagesBySessionId: nextMessages })
}

export function clearApproval(sessionId: string): void {
  const nextApprovals = { ...snapshot.approvalsBySessionId }
  delete nextApprovals[sessionId]
  setSnapshot({ ...snapshot, approvalsBySessionId: nextApprovals })
}

export function useHarnessSnapshot(): HarnessEventSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useActiveRuns(): Record<string, ActiveRunRef> {
  return useStoreSelector((state) => state.activeRunsBySessionId)
}

export function useActiveRun(sessionId: string | null): ActiveRunRef | undefined {
  return useStoreSelector((state) => (sessionId ? state.activeRunsBySessionId[sessionId] : undefined))
}

export function useSessionMessages(sessionId: string | null): MessageRecord[] {
  return useStoreSelector((state) => (sessionId ? state.messagesBySessionId[sessionId] ?? emptyMessages : emptyMessages))
}

export function useApproval(sessionId: string | null): ApprovalState | undefined {
  return useStoreSelector((state) => (sessionId ? state.approvalsBySessionId[sessionId] : undefined))
}

export function useApprovals(): Record<string, ApprovalState> {
  return useStoreSelector((state) => state.approvalsBySessionId)
}

export function useHarnessLogs(): HarnessLogEntry[] {
  return useStoreSelector((state) => state.logs)
}

export function useTerminalEvent(sessionId: string | null): HarnessEvent | undefined {
  return useStoreSelector((state) => (sessionId ? state.terminalEventBySessionId[sessionId] : undefined))
}

export function useTerminalEvents(): Record<string, HarnessEvent> {
  return useStoreSelector((state) => state.terminalEventBySessionId)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot(): HarnessEventSnapshot {
  return snapshot
}

function useStoreSelector<T>(selector: (state: HarnessEventSnapshot) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(snapshot),
    () => selector(snapshot),
  )
}

function setSnapshot(next: HarnessEventSnapshot): void {
  snapshot = next
  for (const listener of listeners) {
    listener()
  }
}

function handleHarnessEvent(event: HarnessEvent): void {
  const nextSnapshot = reduceHarnessEvent(snapshot, event)
  if (nextSnapshot !== snapshot) {
    setSnapshot(nextSnapshot)
  }
}

function reduceHarnessEvent(current: HarnessEventSnapshot, event: HarnessEvent): HarnessEventSnapshot {
  if (event.type === 'run.started') {
    const activeRun = parseStartedRun(event)
    if (!activeRun) {
      return current
    }

    return {
      ...current,
      activeRunsBySessionId: {
        ...current.activeRunsBySessionId,
        [event.sessionId]: activeRun,
      },
      terminalEventBySessionId: omitKey(current.terminalEventBySessionId, event.sessionId),
    }
  }

  if (event.type === 'assistant.delta') {
    const text = parseDelta(event)
    if (!text || !event.messageId) {
      return current
    }

    enqueueReveal(event.sessionId, event.messageId, text)

    return {
      ...current,
      messagesBySessionId: {
        ...current.messagesBySessionId,
        [event.sessionId]: ensureStreamingMessage(current.messagesBySessionId[event.sessionId] ?? [], event.messageId, event.sessionId),
      },
    }
  }

  if (event.type === 'assistant.message') {
    const text = parseDelta(event)
    if (!event.messageId) {
      return current
    }

    revealQueues.delete(event.messageId)
    return {
      ...current,
      messagesBySessionId: {
        ...current.messagesBySessionId,
        [event.sessionId]: replaceMessageContent(
          current.messagesBySessionId[event.sessionId] ?? [],
          event.messageId,
          event.sessionId,
          text,
        ),
      },
    }
  }

  if (event.type === 'approval.required') {
    const approval = parseApproval(event)
    if (!approval) {
      return current
    }

    const currentRun = current.activeRunsBySessionId[event.sessionId]
    const activeRunsBySessionId = currentRun
      ? {
          ...current.activeRunsBySessionId,
          [event.sessionId]: { ...currentRun, status: 'waiting_approval' as const },
        }
      : current.activeRunsBySessionId

    return {
      ...current,
      activeRunsBySessionId,
      approvalsBySessionId: {
        ...current.approvalsBySessionId,
        [event.sessionId]: approval,
      },
    }
  }

  if (isTerminalEvent(event)) {
    const nextActiveRuns = omitKey(current.activeRunsBySessionId, event.sessionId)
    const nextApprovals = omitKey(current.approvalsBySessionId, event.sessionId)
    const status = terminalStatus(event.type)
    const messages = event.messageId
      ? markMessageTerminalOrQueue(current.messagesBySessionId, event.sessionId, event.messageId, status)
      : current.messagesBySessionId

    return {
      ...current,
      activeRunsBySessionId: nextActiveRuns,
      approvalsBySessionId: nextApprovals,
      messagesBySessionId: messages,
      terminalEventBySessionId: {
        ...current.terminalEventBySessionId,
        [event.sessionId]: event,
      },
    }
  }

  return current
}

function parseStartedRun(event: HarnessEvent): ActiveRunRef | null {
  if (!event.harnessSessionId || !event.messageId) {
    return null
  }

  const payload = isObject(event.payload) ? event.payload : {}
  const capabilities = isCapabilities(payload.capabilities) ? payload.capabilities : {
    streaming: 'none' as const,
    toolEvents: false,
    cancelCurrentRun: false,
    approval: false,
    sessionResume: false,
  }

  return {
    runId: event.runId,
    runMode: payload.runMode === 'acp' ? 'acp' : 'sdk',
    harnessSessionId: event.harnessSessionId,
    assistantMessageId: event.messageId,
    status: 'running',
    capabilities,
  }
}

function ensureStreamingMessage(items: MessageRecord[], messageId: string, sessionId: string): MessageRecord[] {
  const existing = items.find((item) => item.id === messageId)
  if (!existing) {
    return [
      ...items,
      {
        id: messageId,
        sessionId,
        role: 'assistant',
        content: '',
        status: 'streaming',
        retrySourceMessageId: null,
        retryPromptMessageId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
  }

  return items.map((item) => (item.id === messageId ? { ...item, status: 'streaming', updatedAt: Date.now() } : item))
}

function appendVisibleMessageDelta(items: MessageRecord[], messageId: string, text: string, sessionId: string): MessageRecord[] {
  const existing = items.find((item) => item.id === messageId)
  if (!existing) {
    return [
      ...items,
      {
        id: messageId,
        sessionId,
        role: 'assistant',
        content: text,
        status: 'streaming',
        retrySourceMessageId: null,
        retryPromptMessageId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
  }

  return items.map((item) => (item.id === messageId ? { ...item, content: `${item.content}${text}`, updatedAt: Date.now() } : item))
}

function replaceMessageContent(items: MessageRecord[], messageId: string, sessionId: string, text: string): MessageRecord[] {
  const existing = items.find((item) => item.id === messageId)
  if (!existing) {
    return [
      ...items,
      {
        id: messageId,
        sessionId,
        role: 'assistant',
        content: text,
        status: 'streaming',
        retrySourceMessageId: null,
        retryPromptMessageId: null,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
    ]
  }

  return items.map((item) => (item.id === messageId ? { ...item, content: text, updatedAt: Date.now() } : item))
}

function markMessageTerminalOrQueue(
  messagesBySessionId: Record<string, MessageRecord[]>,
  sessionId: string,
  messageId: string,
  status: MessageStatus | null,
): Record<string, MessageRecord[]> {
  if (!status) {
    return messagesBySessionId
  }

  const revealQueue = revealQueues.get(messageId)
  if (revealQueue && revealQueue.pending.length > 0) {
    revealQueue.terminalStatus = status
    return messagesBySessionId
  }

  const items = messagesBySessionId[sessionId]
  if (!items) {
    return messagesBySessionId
  }

  return {
    ...messagesBySessionId,
    [sessionId]: items.map((item) => (item.id === messageId ? { ...item, status, updatedAt: Date.now() } : item)),
  }
}

function mergeStoredMessages(current: MessageRecord[], stored: MessageRecord[], sessionId: string): MessageRecord[] {
  const currentById = new Map(current.filter((item) => item.sessionId === sessionId).map((item) => [item.id, item]))
  const storedIds = new Set(stored.map((item) => item.id))
  const merged = stored.map((item) => {
    const existing = currentById.get(item.id)
    if (existing && isRevealing(item.id)) {
      return existing
    }

    if (!existing || existing.status !== 'streaming' || existing.content.length <= item.content.length) {
      return item
    }

    return { ...item, content: existing.content, status: existing.status }
  })
  const pending = [...currentById.values()].filter((item) => item.status === 'streaming' && !storedIds.has(item.id))
  return [...merged, ...pending].sort((left, right) => left.createdAt - right.createdAt)
}

function parseDelta(event: HarnessEvent): string {
  return isObject(event.payload) && typeof event.payload.text === 'string' ? event.payload.text : ''
}

function parseApproval(event: HarnessEvent): ApprovalState | null {
  if (!isObject(event.payload) || typeof event.payload.id !== 'string') {
    return null
  }

  return {
    id: event.payload.id,
    sessionId: event.sessionId,
    title: typeof event.payload.title === 'string' ? event.payload.title : 'Permission required',
    description: typeof event.payload.description === 'string' ? event.payload.description : undefined,
  }
}

function isTerminalEvent(event: HarnessEvent): boolean {
  return event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled' || event.type === 'run.interrupted'
}

function terminalStatus(type: HarnessEvent['type']): MessageStatus | null {
  if (type === 'run.completed') {
    return 'completed'
  }
  if (type === 'run.cancelled') {
    return 'cancelled'
  }
  if (type === 'run.failed') {
    return 'failed'
  }
  if (type === 'run.interrupted') {
    return 'interrupted'
  }
  return null
}

function enqueueReveal(sessionId: string, messageId: string, text: string): void {
  const current = revealQueues.get(messageId)
  revealQueues.set(messageId, {
    sessionId,
    messageId,
    pending: `${current?.pending ?? ''}${text}`,
    terminalStatus: current?.terminalStatus,
  })
  scheduleReveal()
}

function scheduleReveal(): void {
  if (revealTimer) {
    return
  }

  revealTimer = setTimeout(() => {
    revealTimer = null
    drainRevealQueues()
  }, revealIntervalMs)
}

function drainRevealQueues(): void {
  if (!revealQueues.size) {
    return
  }

  let nextMessagesBySessionId = snapshot.messagesBySessionId
  for (const [messageId, queue] of revealQueues.entries()) {
    if (!queue.pending) {
      if (queue.terminalStatus) {
        nextMessagesBySessionId = markMessageTerminalOrQueue(nextMessagesBySessionId, queue.sessionId, messageId, queue.terminalStatus)
      }
      revealQueues.delete(messageId)
      continue
    }

    const text = queue.pending.slice(0, revealChunkSize)
    queue.pending = queue.pending.slice(revealChunkSize)
    nextMessagesBySessionId = {
      ...nextMessagesBySessionId,
      [queue.sessionId]: appendVisibleMessageDelta(nextMessagesBySessionId[queue.sessionId] ?? [], messageId, text, queue.sessionId),
    }

    if (!queue.pending && queue.terminalStatus) {
      nextMessagesBySessionId = markMessageTerminalOrQueue(nextMessagesBySessionId, queue.sessionId, messageId, queue.terminalStatus)
      revealQueues.delete(messageId)
    }
  }

  setSnapshot({ ...snapshot, messagesBySessionId: nextMessagesBySessionId })

  if (revealQueues.size) {
    scheduleReveal()
  }
}

function isRevealing(messageId: string): boolean {
  return revealQueues.has(messageId)
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record }
  delete next[key]
  return next
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function isCapabilities(value: unknown): value is ActiveRunRef['capabilities'] {
  if (!isObject(value)) {
    return false
  }

  return (value.streaming === 'none' || value.streaming === 'committed-message' || value.streaming === 'runtime-events')
    && typeof value.toolEvents === 'boolean'
    && typeof value.cancelCurrentRun === 'boolean'
    && typeof value.approval === 'boolean'
    && typeof value.sessionResume === 'boolean'
}
