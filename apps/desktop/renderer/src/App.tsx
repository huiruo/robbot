import { useEffect, useState } from 'react'
import { LogOut, RefreshCw, Settings } from 'lucide-react'
import { LoginPage } from './components/auth/LoginPage'
import { SettingsModal } from './components/home/SettingsModal'
import type { AccountRecord, AuthUser, DshWebViewTarget } from './robbot-api'
import './App.css'

function App() {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    void window.robbot.auth.getCurrent().then(setUser).finally(() => setBooted(true))
  }, [])

  if (!booted) return <div className="grid h-full place-items-center text-sm text-slate-500">Loading...</div>
  if (!user) return <LoginPage onDone={setUser} />
  return <AuthenticatedApp user={user} onLoggedOut={() => setUser(null)} />
}

function AuthenticatedApp({ user, onLoggedOut }: { user: AuthUser; onLoggedOut: () => void }) {
  const [account, setAccount] = useState<AccountRecord | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [dshTarget, setDshTarget] = useState<DshWebViewTarget | null>(null)
  const [viewNonce, setViewNonce] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    void window.robbot.account.getCurrent().then(setAccount)
  }, [user.id])

  const loadDsh = async () => {
    setDshTarget(null)
    setViewNonce((value) => value + 1)
    setLoading(true)
    setError('')
    try {
      const target = await window.robbot.harness.getCurrentWebUrl()
      setDshTarget(target)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause)
      setDshTarget(null)
      setError(message)
      if (/API key is missing/i.test(message)) {
        setSettingsOpen(true)
      }
    } finally {
      setLoading(false)
    }
  }

  const logout = async () => {
    if (!window.confirm('Are you sure you want to sign out?')) return
    setDshTarget(null)
    setViewNonce((value) => value + 1)
    await window.robbot.auth.logout()
    onLoggedOut()
  }

  useEffect(() => {
    void loadDsh()
  }, [user.id])

  const saveSettings = async (field: 'deepseek' | 'openai', value: Record<string, unknown>) => {
    setDshTarget(null)
    setViewNonce((nonce) => nonce + 1)
    setAccount(await window.robbot.account.updateAiConfig(field, value))
    await window.robbot.account.resetHarness()
    setSettingsOpen(false)
    await loadDsh()
  }

  const selectAi = async (field: 'deepseek' | 'openai') => {
    setDshTarget(null)
    setViewNonce((nonce) => nonce + 1)
    setAccount(await window.robbot.account.selectAi(field))
    await window.robbot.account.resetHarness()
    setSettingsOpen(false)
    await loadDsh()
  }

  return (
    <>
      <main className="grid h-full min-h-0 grid-rows-[44px_minmax(0,1fr)] overflow-hidden bg-white">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-3">
          <div className="flex min-w-0 items-center gap-2">
            <div className="grid h-6 w-6 place-items-center rounded-md bg-slate-950 text-[11px] font-semibold text-white">R</div>
            <div className="truncate text-[13px] font-medium text-slate-700">Robbot / DSH Desktop</div>
            {loading ? <div className="status-pulse text-[12px] text-slate-400">Starting DSH...</div> : null}
          </div>
          <div className="flex items-center gap-1">
            <button className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100" title="Reload DSH" onClick={() => void loadDsh()}>
              <RefreshCw className="h-4 w-4" />
            </button>
            <button className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100" title="Settings" onClick={() => setSettingsOpen(true)}>
              <Settings className="h-4 w-4" />
            </button>
            <button className="grid h-8 w-8 place-items-center rounded-md text-slate-500 hover:bg-slate-100" title={account?.email ?? user.email ?? 'Sign out'} onClick={() => void logout()}>
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </header>
        <section className="relative min-h-0 bg-[#f7f8fa]">
          {settingsOpen ? (
            <SettingsModal
              key="settings-page"
              open
              variant="page"
              email={account?.email ?? user.email ?? ''}
              deepseek={account?.deepseek ?? null}
              openai={account?.openai ?? null}
              selectedAi={account?.selectedAi ?? null}
              onClose={() => setSettingsOpen(false)}
              onSave={saveSettings}
              onSelect={selectAi}
              onLogout={() => { setSettingsOpen(false); void logout() }}
            />
          ) : dshTarget ? (
            <webview
              key={`${dshTarget.partition}:${dshTarget.fingerprint}:${viewNonce}`}
              title="DSH Desktop"
              src={dshTarget.url}
              partition={dshTarget.partition}
              className="h-full w-full border-0 bg-white"
              allowpopups
              webpreferences="contextIsolation=yes,nodeIntegration=no"
            />
          ) : loading ? (
            <DshLoading />
          ) : (
            <div className="grid h-full place-items-center p-6">
              <div className="max-w-md rounded-lg border border-slate-200 bg-white p-5 text-sm text-slate-600 shadow-sm">
                <div className="font-medium text-slate-950">DSH Desktop is not ready</div>
                {error ? <pre className="mt-3 whitespace-pre-wrap rounded-md bg-rose-50 p-3 font-sans text-[13px] text-rose-700">{error}</pre> : null}
                <div className="mt-4 flex gap-2">
                  <button className="rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white" onClick={() => void loadDsh()}>Retry</button>
                  <button className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700" onClick={() => setSettingsOpen(true)}>Settings</button>
                </div>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  )
}

function DshLoading() {
  return (
    <div className="grid h-full place-items-center bg-[#f7f8fa] p-6">
      <div className="flex flex-col items-center gap-4 text-center">
        <div className="dsh-spinner" aria-hidden="true" />
        <div>
          <div className="text-[15px] font-medium text-slate-900">Starting DSH Desktop</div>
          <div className="mt-1 text-[13px] text-slate-500">Preparing your isolated runtime…</div>
        </div>
      </div>
    </div>
  )
}

export default App
