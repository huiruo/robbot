import { useState } from 'react'
import { Box, FormControl, MenuItem, OutlinedInput, Select, Tab, Tabs } from '@mui/material'
import { Check, LogOut, X } from 'lucide-react'
import { toast } from 'sonner'

type AiField = 'deepseekKey' | 'chatgptKey'
const emptyDeepseekConfig = '{}'
const emptyChatgptConfig = '{\n  "apiUrl": ""\n}'
const models = {
  deepseekKey: ['deepseek-v4-flash', 'deepseek-v4-pro'],
  chatgptKey: ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'gpt-5.5'],
} as const

function tabProps(index: number) { return { id: `settings-tab-${index}`, 'aria-controls': `settings-tabpanel-${index}` } }
function TabPanel(props: { value: number; index: number; children: React.ReactNode }) {
  return <div role="tabpanel" hidden={props.value !== props.index} id={`settings-tabpanel-${props.index}`} aria-labelledby={`settings-tab-${props.index}`} className="min-h-0 min-w-0 flex-1 overflow-y-auto">{props.value === props.index ? props.children : null}</div>
}

export function SettingsModal(props: { open: boolean; email: string; deepseekKey: string | null; chatgptKey: string | null; selectedAi: string | null; onClose(): void; onSave(field: AiField, value: Record<string, unknown>): Promise<void>; onSelect(field: AiField): Promise<void>; onLogout(): void }) {
  const [tab, setTab] = useState(0)
  const [configs, setConfigs] = useState<Record<AiField, string>>(() => ({ deepseekKey: formatJson(props.deepseekKey, emptyDeepseekConfig), chatgptKey: formatJson(props.chatgptKey, emptyChatgptConfig) }))
  const [keys, setKeys] = useState<Record<AiField, string>>(() => ({ deepseekKey: readKey(props.deepseekKey), chatgptKey: readKey(props.chatgptKey) }))
  const [selectedModels, setSelectedModels] = useState<Record<AiField, string>>(() => ({ deepseekKey: readStringValue(props.deepseekKey, 'model') || 'deepseek-v4-pro', chatgptKey: readStringValue(props.chatgptKey, 'model') || 'gpt-5.6-luna' }))
  const [saving, setSaving] = useState<AiField | null>(null)
  const [selecting, setSelecting] = useState<AiField | null>(null)
  const fields: Array<{ field: AiField; label: string }> = [{ field: 'deepseekKey', label: 'DeepSeek' }, { field: 'chatgptKey', label: 'ChatGPT' }]

  if (!props.open) return null
  const save = async (field: AiField) => {
    let value: Record<string, unknown>
    try { value = JSON.parse(configs[field]) as Record<string, unknown> } catch { toast.error('保存失败：请输入有效的 JSON 对象'); return }
    if (!value || Array.isArray(value) || typeof value !== 'object') { toast.error('保存失败：配置必须是 JSON 对象'); return }
    const key = keys[field].trim()
    const nextValue = key ? { ...value, key } : Object.fromEntries(Object.entries(value).filter(([name]) => name !== 'key'))
    nextValue.model = selectedModels[field]
    setSaving(field)
    try {
      await props.onSave(field, nextValue)
      toast.success(`${field === 'deepseekKey' ? 'DeepSeek' : 'ChatGPT'} 配置保存成功`)
    } catch (cause) {
      toast.error(`保存失败：${cause instanceof Error ? cause.message : String(cause)}`)
    } finally { setSaving(null) }
  }
  const select = async (field: AiField) => { setSelecting(field); try { await props.onSelect(field) } finally { setSelecting(null) } }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/35 p-4" onMouseDown={props.onClose}>
    <div className="w-full max-w-3xl overflow-hidden rounded-xl bg-white shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
      <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4"><div><h2 className="m-0 text-lg font-semibold text-slate-950">Settings</h2><p className="m-0 mt-1 text-xs text-slate-500">Account and AI models</p></div><button className="rounded p-1 text-slate-400 hover:bg-slate-100" onClick={props.onClose} aria-label="Close"><X className="h-4 w-4" /></button></div>
      <Box sx={{ display: 'flex', minHeight: 470, maxHeight: '70vh', overflow: 'hidden' }}>
        <Tabs orientation="vertical" value={tab} onChange={(_, value: number) => setTab(value)} aria-label="Settings sections" sx={{ width: 150, flexShrink: 0, borderRight: 1, borderColor: 'divider', '& .MuiTab-root': { alignItems: 'flex-start', minHeight: 48, textTransform: 'none', fontSize: 13 } }}>
          <Tab label="Model" {...tabProps(0)} />
          <Tab label="Account" {...tabProps(1)} />
        </Tabs>
        <TabPanel value={tab} index={0}><div className="p-6"><h3 className="m-0 text-base font-semibold text-slate-950">Model</h3><p className="mt-1 text-sm text-slate-500">API key is protected in a password field. Choose a model and edit provider-specific options as JSON.</p><div className="mt-6 grid gap-5">{fields.map(({ field, label }) => { const active = props.selectedAi === field; return <div key={field} className="rounded-lg border border-slate-200 p-4"><div className="flex items-center justify-between"><div className="font-medium text-slate-800">{label}</div>{active ? <span className="flex items-center gap-1 text-xs font-medium text-emerald-600"><Check className="h-3.5 w-3.5" />当前正在使用</span> : <button disabled={selecting !== null} className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50" onClick={() => void select(field)}>{selecting === field ? '切换中…' : '选中'}</button>}</div><label className="mt-3 block text-xs font-medium text-slate-600">API key</label><input type="password" value={keys[field]} onChange={(event) => setKeys((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-emerald-500" placeholder="Enter API key" autoComplete="new-password" /><label className="mt-3 block text-xs font-medium text-slate-600">Model</label><FormControl fullWidth size="small" className="mt-1"><Select value={selectedModels[field]} onChange={(event) => setSelectedModels((current) => ({ ...current, [field]: event.target.value }))} input={<OutlinedInput />} MenuProps={{ slotProps: { paper: { style: { maxHeight: 48 * 4.5 + 8, width: 250 } } } }}>{models[field].map((model) => <MenuItem key={model} value={model}>{model}</MenuItem>)}</Select></FormControl>{field === 'chatgptKey' ? <><label className="mt-3 block text-xs font-medium text-slate-600">Other configuration (JSON)</label><textarea value={configs[field]} onChange={(event) => setConfigs((current) => ({ ...current, [field]: event.target.value }))} className="mt-1 min-h-32 w-full resize-y rounded-md border border-slate-300 bg-slate-50 px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-emerald-500" spellCheck={false} /></> : null}<div className="mt-3 flex justify-end"><button disabled={saving !== null} className="rounded-md bg-slate-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-50" onClick={() => void save(field)}>{saving === field ? '保存中…' : '保存'}</button></div></div> })}</div></div></TabPanel>
        <TabPanel value={tab} index={1}><div className="flex h-full flex-col p-6"><h3 className="m-0 text-base font-semibold text-slate-950">Account</h3><p className="mt-1 text-sm text-slate-500">Your Robbot account</p><div className="mt-6"><label className="text-xs font-medium text-slate-600">Email</label><div className="mt-1 rounded-md bg-slate-50 px-3 py-2 text-sm text-slate-700">{props.email || '—'}</div></div><button className="mt-auto flex w-fit items-center gap-2 rounded-md border border-rose-200 px-3 py-2 text-sm text-rose-600 hover:bg-rose-50" onClick={props.onLogout}><LogOut className="h-4 w-4" />Sign out</button></div></TabPanel>
      </Box>
    </div>
  </div>
}

function formatJson(raw: string | null, emptyValue: string): string { if (!raw) return emptyValue; try { const value = JSON.parse(raw) as Record<string, unknown>; delete value.key; delete value.model; return JSON.stringify(value, null, 2) } catch { return raw } }
function readKey(raw: string | null): string { if (!raw) return ''; try { const value = JSON.parse(raw) as Record<string, unknown>; return typeof value.key === 'string' ? value.key : '' } catch { return '' } }
function readStringValue(raw: string | null, field: string): string { if (!raw) return ''; try { const value = JSON.parse(raw) as Record<string, unknown>; return typeof value[field] === 'string' ? value[field] : '' } catch { return '' } }
