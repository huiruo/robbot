import { useEffect, useState } from 'react'
import { ChatPane } from './components/home/ChatPane'
import { RenameDialog } from './components/home/RenameDialog'
import { WorkspaceSidebar } from './components/home/WorkspaceSidebar'
import { useChatRuntime } from './hooks/useChatRuntime'
import { useWorkspaceChat } from './hooks/useWorkspaceChat'
import { useActiveRuns, useApprovals, useHarnessEvents, useHarnessLogs } from './lib/harness-event-store'
import { LoginPage } from './components/auth/LoginPage'
import { clearAuth, getAuthUser } from './auth'
import './App.css'

function App() {
  const [userId, setUserId] = useState(() => getAuthUser()?.id ?? null)
  useEffect(() => {
    const sync = () => setUserId(getAuthUser()?.id ?? null)
    window.addEventListener('robbot-auth-changed', sync)
    window.addEventListener('robbot-auth-expired', clearAuth)
    return () => {
      window.removeEventListener('robbot-auth-changed', sync)
      window.removeEventListener('robbot-auth-expired', clearAuth)
    }
  }, [])

  if (!userId) return <LoginPage onDone={setUserId} />
  return <AuthenticatedApp accountId={userId} onLogout={() => {
    if (window.confirm('Are you sure you want to sign out?')) {
      clearAuth()
    }
  }} />
}

function AuthenticatedApp({ accountId, onLogout }: { accountId: string; onLogout: () => void }) {
  useHarnessEvents()

  const workspaceChat = useWorkspaceChat(accountId)
  const activeRuns = useActiveRuns()
  const approvals = useApprovals()
  const logs = useHarnessLogs()
  const chatRuntime = useChatRuntime({
    accountId,
    workspace: workspaceChat.workspace,
    session: workspaceChat.session,
    onStatusRefresh: workspaceChat.refreshStatus,
    onSessionsRefresh: workspaceChat.refreshSessions,
    onError: workspaceChat.setError,
  })

  return (
    <>
      <main className="grid h-full min-h-0 grid-cols-[304px_minmax(0,1fr)] overflow-hidden bg-white">
        <WorkspaceSidebar
          status={workspaceChat.status}
          logs={logs}
          workspaces={workspaceChat.workspaces}
          sessions={workspaceChat.sessions}
          workspaceId={workspaceChat.workspaceId}
          sessionId={workspaceChat.sessionId}
          activeRuns={activeRuns}
          approvals={approvals}
          onRefresh={() => void workspaceChat.bootstrap()}
          onSelectDirectory={() => void workspaceChat.selectDirectory()}
          onOpenWorkspace={(workspace) => void workspaceChat.openWorkspace(workspace)}
          onCreateSession={(workspace) => void workspaceChat.createSession(workspace)}
          onOpenSession={workspaceChat.setSessionId}
          onRename={workspaceChat.startRename}
          onDeleteWorkspace={(workspace) => void workspaceChat.deleteWorkspace(workspace)}
          onDeleteSession={(session) => void workspaceChat.deleteSession(session)}
          onLogout={onLogout}
        />
        <ChatPane
          workspace={workspaceChat.workspace}
          session={workspaceChat.session}
          messages={chatRuntime.messages}
          activeRun={chatRuntime.activeRun}
          approval={chatRuntime.approval}
          prompt={chatRuntime.prompt}
          error={workspaceChat.error}
          onPromptChange={chatRuntime.setPrompt}
          onSend={() => void chatRuntime.send()}
          onCancel={() => void chatRuntime.cancel()}
          onRetry={(message) => void chatRuntime.retry(message)}
          onCreateSession={() => void workspaceChat.createSession()}
          onCreateWorkspace={() => void workspaceChat.selectDirectory()}
          onApprovalDecision={(approval, approved) => void chatRuntime.decideApproval(approval, approved)}
        />
      </main>
      <RenameDialog
        target={workspaceChat.renameTarget}
        onCancel={() => workspaceChat.setRenameTarget(null)}
        onRename={(value) => void workspaceChat.renameItem(value)}
      />
    </>
  )
}

export default App
