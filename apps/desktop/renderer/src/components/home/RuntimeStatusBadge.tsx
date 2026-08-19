import { Activity, CheckCircle2, LoaderCircle, XCircle } from 'lucide-react'
import type { HarnessLogEntry, HarnessRuntimeStatus } from '../../robbot-api'

const statusMeta: Record<string, { label: string; tone: string; icon: typeof CheckCircle2 }> = {
  ready: { label: 'Ready', tone: 'text-emerald-700 bg-emerald-50', icon: CheckCircle2 },
  running: { label: 'Running', tone: 'text-amber-700 bg-amber-50', icon: Activity },
  missing: { label: 'Missing', tone: 'text-rose-700 bg-rose-50', icon: XCircle },
  not_installed: { label: 'Not installed', tone: 'text-rose-700 bg-rose-50', icon: XCircle },
  unknown: { label: 'Loading', tone: 'text-slate-600 bg-slate-100', icon: LoaderCircle },
}

export function RuntimeStatusBadge(props: { status: HarnessRuntimeStatus | null; logs: HarnessLogEntry[] }) {
  const meta = statusMeta[props.status?.status ?? 'unknown']
  const StatusIcon = meta.icon
  const lastLog = props.logs.at(-1)

  return (
    <div className="border-t border-slate-200 p-4">
      <div className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-medium ${meta.tone}`}>
        <StatusIcon className="h-3.5 w-3.5" />
        {meta.label}
      </div>
      {lastLog ? <div className="mt-2 truncate text-[11px] text-slate-400">{lastLog.message}</div> : null}
    </div>
  )
}
