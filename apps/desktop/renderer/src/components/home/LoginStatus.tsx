import { Settings } from 'lucide-react'

export function LoginStatus(props: { email: string; avatar: string | null; onSettings(): void }) {
  const name = props.email.split('@')[0] || props.email || 'User'
  const initials = name.slice(0, 2).toUpperCase()
  return <div className="border-t border-slate-200 px-3 py-3"><div className="flex items-center gap-2"><div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-200 text-[10px] font-semibold text-slate-600">{props.avatar ? <img src={props.avatar} alt="" className="h-full w-full object-cover" /> : initials}</div><div className="min-w-0 flex-1"><div className="truncate text-[12px] font-medium text-slate-700">{name}</div><div className="truncate text-[11px] text-slate-400">{props.email}</div></div><button aria-label="Settings" className="rounded p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={props.onSettings}><Settings className="h-4 w-4" /></button></div></div>
}
