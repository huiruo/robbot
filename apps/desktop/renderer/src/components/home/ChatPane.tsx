import { useEffect, useRef } from 'react'
import { CircleAlert, FolderPlus, Square } from 'lucide-react'
import type { ActiveRunRef, MessageRecord, SessionRecord, WorkspaceRecord } from '../../robbot-api'
import type { ApprovalState } from '../../lib/harness-event-store'
import { ApprovalCard } from './ApprovalCard'
import { ChatMessageCard } from './ChatMessageCard'
import { Composer } from './Composer'

export function ChatPane(props: {
  workspace: WorkspaceRecord | null
  session: SessionRecord | null
  messages: MessageRecord[]
  activeRun: ActiveRunRef | undefined
  approval: ApprovalState | undefined
  prompt: string
  error: string
  onPromptChange(value: string): void
  onSend(): void
  onCancel(): void
  onRetry(message: MessageRecord): void
  onCreateSession(): void
  onCreateWorkspace(): void
  onApprovalDecision(approval: ApprovalState, approved: boolean): void
}) {
  const endRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [props.messages, props.session?.id])

  return (
    <section className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-[#f7f8fa]">
      <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
        <div className="min-w-0">
          <div className="truncate text-[15px] font-semibold text-slate-950">{props.session?.title ?? 'No chat selected'}</div>
          <div className="mt-0.5 truncate text-[12px] text-slate-500">{props.workspace?.rootPath ?? 'Open a workspace folder'}</div>
        </div>
        <div className="flex items-center gap-2">
          {props.workspace ? (
            <button
              className="flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
              onClick={props.onCreateSession}
            >
              <FolderPlus className="h-4 w-4" />
              New Chat
            </button>
          ) : null}
          {props.activeRun ? (
            <button
              className="flex items-center gap-2 rounded-md border border-rose-200 bg-white px-3 py-2 text-[13px] text-rose-700 hover:bg-rose-50"
              disabled={!props.activeRun.capabilities.cancelCurrentRun}
              onClick={props.onCancel}
              title={props.activeRun.capabilities.cancelCurrentRun ? 'Stop' : 'SDK runs do not support per-session Stop yet'}
            >
              <Square className="h-3.5 w-3.5" />
              Stop
            </button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 overflow-y-auto px-6 py-5">
        <div className="mx-auto flex max-w-[900px] flex-col gap-3">
          {!props.session ? (
            <div className="m-auto mt-24 max-w-sm text-center text-[13px] leading-6 text-slate-500">
              {props.workspace ? 'Create or select a chat in this workspace.' : 'Open a folder to create a workspace.'}
            </div>
          ) : null}
          {props.messages.map((message) => (
            <ChatMessageCard
              key={message.id}
              message={message}
              retryDisabled={Boolean(props.activeRun)}
              onRetry={props.onRetry}
            />
          ))}
          {props.approval ? (
            <ApprovalCard approval={props.approval} onDecision={(approved) => props.onApprovalDecision(props.approval!, approved)} />
          ) : null}
          {props.error ? (
            <div className="flex gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-[13px] text-rose-700">
              <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <pre className="m-0 whitespace-pre-wrap font-sans">{props.error}</pre>
            </div>
          ) : null}
          <div ref={endRef} />
        </div>
      </div>

      <Composer
        value={props.prompt}
        disabled={Boolean(props.activeRun) || Boolean(props.workspace && !props.session)}
        running={Boolean(props.activeRun)}
        placeholder={props.session ? 'Type a message...' : 'Open a folder to start'}
        canCreateWorkspace={!props.workspace && !props.activeRun}
        onChange={props.onPromptChange}
        onSend={props.onSend}
        onCreateWorkspace={props.onCreateWorkspace}
      />
    </section>
  )
}
