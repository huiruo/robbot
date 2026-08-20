import { useEffect, useState } from 'react'
import { ChatPane } from './components/home/ChatPane'
import { RenameDialog } from './components/home/RenameDialog'
import { WorkspaceSidebar } from './components/home/WorkspaceSidebar'
import { useChatRuntime } from './hooks/useChatRuntime'
import { useWorkspaceChat } from './hooks/useWorkspaceChat'
import { useActiveRuns, useApprovals, useHarnessEvents, useHarnessLogs } from './lib/harness-event-store'
import { LoginPage } from './components/auth/LoginPage'
import { clearAuth, getAuthUser } from './auth'
import { SettingsModal } from './components/home/SettingsModal'
import type { AccountRecord } from './robbot-api'
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
  return <AuthenticatedApp accountId={userId} onLogout={async () => {
    if (window.confirm('Are you sure you want to sign out?')) {
      await window.robbot.account.resetHarness(userId)
      clearAuth()
    }
  }} />
}

function AuthenticatedApp({ accountId, onLogout }: { accountId: string; onLogout: () => void | Promise<void> }) {
  useHarnessEvents()
  const [account, setAccount] = useState<AccountRecord | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const authUser = getAuthUser()

  useEffect(() => {
    void window.robbot.account.get(accountId).then(setAccount)
  }, [accountId])

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
          email={account?.email ?? authUser?.email ?? ''}
          avatar={account?.avatar ?? authUser?.avatar ?? null}
          onSettings={() => setSettingsOpen(true)}
        />
        <ChatPane
          workspace={workspaceChat.workspace}
          session={workspaceChat.session}
          messages={chatRuntime.messages}
          activeRun={chatRuntime.activeRun}
          approval={chatRuntime.approval}
          pendingRetryMessageId={chatRuntime.pendingRetryMessageId}
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
      <SettingsModal
        key={settingsOpen ? 'open' : 'closed'}
        open={settingsOpen}
        email={account?.email ?? authUser?.email ?? ''}
        deepseek={account?.deepseek ?? null}
        openai={account?.openai ?? null}
        selectedAi={account?.selectedAi ?? null}
        onClose={() => setSettingsOpen(false)}
        onSave={async (field, value) => setAccount(await window.robbot.account.updateAiConfig(accountId, field, value))}
        onSelect={async (field) => setAccount(await window.robbot.account.selectAi(accountId, field))}
        onLogout={() => { setSettingsOpen(false); onLogout() }}
      />
    </>
  )
}

export default App
