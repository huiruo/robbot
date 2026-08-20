import { Check, ChevronDown, LoaderCircle, Terminal } from 'lucide-react'
import { useState } from 'react'
import type { ToolActivity } from '../../lib/harness-event-store'

export function ToolActivityCard({ activity }: { activity: ToolActivity }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-slate-200 bg-white/85 text-[13px] shadow-sm">
      <button className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-slate-700" onClick={() => setOpen((value) => !value)}>
        {activity.status === 'running' ? <LoaderCircle className="h-4 w-4 animate-spin text-violet-500" /> : <Check className="h-4 w-4 text-emerald-500" />}
        <Terminal className="h-3.5 w-3.5 text-slate-400" />
        <span className="font-medium">{activity.name}</span>
        <span className="ml-auto text-[11px] text-slate-400">{activity.status === 'running' ? 'Running' : 'Completed'}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open ? (
        <div className="grid gap-2 border-t border-slate-100 px-3 py-3">
          {activity.input ? <pre className="m-0 max-h-40 overflow-auto rounded-lg bg-slate-950 p-3 font-mono text-[11px] leading-5 text-slate-200">{activity.input}</pre> : null}
          {activity.output ? <pre className="m-0 max-h-56 overflow-auto rounded-lg bg-slate-50 p-3 font-mono text-[11px] leading-5 text-slate-600">{activity.output}</pre> : null}
        </div>
      ) : null}
    </div>
  )
}
