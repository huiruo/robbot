import type { MessageRecord } from '../../robbot-api'
import { RotateCcw } from 'lucide-react'

export function ChatMessageCard({ message, retryDisabled, retryPending, onRetry }: {
  message: MessageRecord
  retryDisabled?: boolean
  retryPending?: boolean
  onRetry?: (message: MessageRecord) => void
}) {
  const isUser = message.role === 'user'
  const canRetry = !isUser && (message.status === 'failed' || message.status === 'cancelled' || message.status === 'interrupted')

  return (
    <article className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[760px] rounded-md border px-4 py-3 text-[14px] leading-6 shadow-sm ${
          isUser ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-900'
        }`}
      >
        <div className={`mb-1 text-[11px] font-semibold uppercase ${isUser ? 'text-slate-300' : 'text-slate-400'}`}>
          {message.role}
          {message.status !== 'completed' ? ` · ${message.status}` : ''}
        </div>
        <pre className="m-0 whitespace-pre-wrap break-words font-sans">{message.content}</pre>
        {canRetry ? (
          <div className="mt-3 flex justify-end">
            <button
              className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1.5 text-[12px] font-medium text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={retryDisabled}
              onClick={() => onRetry?.(message)}
              title="Retry this prompt"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              {retryPending ? 'Retrying...' : 'Retry'}
            </button>
          </div>
        ) : null}
      </div>
    </article>
  )
}
