import type { MessageRecord } from '../../robbot-api'

export function ChatMessageCard({ message }: { message: MessageRecord }) {
  const isUser = message.role === 'user'

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
      </div>
    </article>
  )
}
