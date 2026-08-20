import { Edit3, Folder, FolderOpen, LogOut, MessageSquarePlus, RefreshCw, Trash2 } from 'lucide-react'
import type { ActiveRunRef, HarnessLogEntry, HarnessRuntimeStatus, SessionRecord, WorkspaceRecord } from '../../robbot-api'
import type { ApprovalState } from '../../lib/harness-event-store'
import { RuntimeStatusBadge } from './RuntimeStatusBadge'

export function WorkspaceSidebar(props: {
  status: HarnessRuntimeStatus | null
  logs: HarnessLogEntry[]
  workspaces: WorkspaceRecord[]
  sessions: SessionRecord[]
  workspaceId: string | null
  sessionId: string | null
  activeRuns: Record<string, ActiveRunRef>
  approvals: Record<string, ApprovalState>
  onRefresh(): void
  onSelectDirectory(): void
  onOpenWorkspace(workspace: WorkspaceRecord): void
  onCreateSession(workspace: WorkspaceRecord): void
  onOpenSession(sessionId: string): void
  onRename(target: WorkspaceRecord | SessionRecord): void
  onDeleteWorkspace(workspace: WorkspaceRecord): void
  onDeleteSession(session: SessionRecord): void
  onLogout(): void
}) {
  return (
    <aside className="flex min-h-0 flex-col border-r border-slate-200 bg-[#fbfbfc]">
      <div className="border-b border-slate-200 px-5 pb-5 pt-6">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h1 className="m-0 text-[24px] font-semibold text-slate-950">Robbot</h1>
            <p className="m-0 mt-1 text-[12px] text-slate-500">Workspace chat</p>
          </div>
          <button
            title="Refresh"
            className="rounded-md p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            onClick={props.onRefresh}
          >
            <RefreshCw className="h-4 w-4" />
          </button>
        </div>
        <button
          className="mt-4 flex h-10 w-full items-center justify-center gap-2 rounded-md bg-slate-900 px-3 text-[13px] font-semibold text-white"
          onClick={props.onSelectDirectory}
        >
          <FolderOpen className="h-4 w-4" />
          Open Folder
        </button>
      </div>

      <section className="min-h-0 flex-1 overflow-auto px-3 py-4">
        <div className="mb-2 px-2 text-[11px] font-semibold uppercase text-slate-400">Workspaces</div>
        <div className="grid gap-3">
          {props.workspaces.map((workspace) => (
            <WorkspaceGroup key={workspace.id} workspace={workspace} {...props} />
          ))}
        </div>
        {!props.workspaces.length ? <p className="px-2 text-[13px] text-slate-500">Open a folder to start.</p> : null}
      </section>

      <RuntimeStatusBadge status={props.status} logs={props.logs} />
      <button className="m-3 flex items-center justify-center gap-2 rounded-md border border-slate-200 px-3 py-2 text-[12px] text-slate-600 hover:bg-slate-100" onClick={props.onLogout}>
        <LogOut className="h-3.5 w-3.5" />
        Sign out
      </button>
    </aside>
  )
}

function WorkspaceGroup(
  props: Parameters<typeof WorkspaceSidebar>[0] & {
    workspace: WorkspaceRecord
  },
) {
  return (
    <div className="grid gap-1">
      <div
        className={`group flex items-center gap-1 rounded-md px-2 py-2 ${
          props.workspaceId === props.workspace.id ? 'bg-slate-200' : 'hover:bg-slate-100'
        }`}
      >
        <button className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => props.onOpenWorkspace(props.workspace)}>
          <Folder className="h-4 w-4 shrink-0 text-slate-500" />
          <span className="truncate text-[13px] font-medium text-slate-800">{props.workspace.name}</span>
        </button>
        <button title="Rename workspace" className="rounded p-1 text-slate-400 hover:text-slate-800" onClick={() => props.onRename(props.workspace)}>
          <Edit3 className="h-3.5 w-3.5" />
        </button>
        <button
          title="Delete workspace"
          className="rounded p-1 text-slate-400 hover:text-rose-700"
          onClick={() => props.onDeleteWorkspace(props.workspace)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
        <button title="New chat" className="rounded p-1 text-slate-500 hover:text-slate-900" onClick={() => props.onCreateSession(props.workspace)}>
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="grid gap-1 pl-6">
        {props.sessions
          .filter((chat) => chat.workspaceId === props.workspace.id)
          .map((chat) => (
            <SessionRow key={chat.id} chat={chat} {...props} />
          ))}
      </div>
    </div>
  )
}

function SessionRow(
  props: Parameters<typeof WorkspaceSidebar>[0] & {
    chat: SessionRecord
  },
) {
  const run = props.activeRuns[props.chat.id]
  const approval = props.approvals[props.chat.id]

  return (
    <div
      className={`group flex items-center gap-1 rounded-md px-2 py-1.5 text-[13px] ${
        props.sessionId === props.chat.id ? 'bg-emerald-50 text-emerald-950' : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <button className="min-w-0 flex-1 truncate text-left" onClick={() => props.onOpenSession(props.chat.id)}>
        {props.chat.title ?? 'New Chat'}
      </button>
      {approval ? <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">approval</span> : null}
      {run && !approval ? <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] text-emerald-700">{run.status}</span> : null}
      <button title="Rename chat" className="rounded p-1 text-slate-400 opacity-0 hover:text-slate-800 group-hover:opacity-100" onClick={() => props.onRename(props.chat)}>
        <Edit3 className="h-3 w-3" />
      </button>
      <button
        title="Delete chat"
        className="rounded p-1 text-slate-400 opacity-0 hover:text-rose-700 group-hover:opacity-100"
        onClick={() => props.onDeleteSession(props.chat)}
      >
        <Trash2 className="h-3 w-3" />
      </button>
    </div>
  )
}
