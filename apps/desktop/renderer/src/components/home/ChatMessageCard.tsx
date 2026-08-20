import type { MessageRecord } from '../../robbot-api'
import { Bot, Check, Copy, RotateCcw, UserRound } from 'lucide-react'
import { useState } from 'react'
import type { ReactNode } from 'react'

export function ChatMessageCard({ message, retryDisabled, retryPending, onRetry }: {
  message: MessageRecord
  retryDisabled?: boolean
  retryPending?: boolean
  onRetry?: (message: MessageRecord) => void
}) {
  const isUser = message.role === 'user'
  const canRetry = !isUser && ['failed', 'cancelled', 'interrupted'].includes(message.status)
  const [copied, setCopied] = useState(false)
  const copy = async () => { await navigator.clipboard?.writeText(message.content); setCopied(true); window.setTimeout(() => setCopied(false), 1200) }

  return (
    <article className={`group flex gap-3 ${isUser ? 'justify-end' : 'justify-start'}`}>
      {!isUser ? <div className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-900 text-white"><Bot className="h-4 w-4" /></div> : null}
      <div className={`min-w-0 ${isUser ? 'max-w-[78%]' : 'max-w-[860px] flex-1'}`}>
        <div className={`flex items-center gap-2 px-1 text-[11px] font-medium ${isUser ? 'justify-end text-slate-400' : 'text-slate-400'}`}>
          <span>{isUser ? 'You' : 'DSH Agent'}</span>
          {message.status !== 'completed' ? <span className="rounded-full bg-slate-100 px-1.5 py-0.5 uppercase tracking-wide">{message.status}</span> : null}
        </div>
        <div className={`mt-1 rounded-2xl px-4 py-3 text-[14px] leading-7 ${isUser ? 'rounded-br-md bg-slate-900 text-white shadow-sm' : 'rounded-tl-md border border-slate-200/80 bg-white text-slate-800 shadow-[0_2px_12px_rgba(15,23,42,0.04)]'}`}>
          {message.content ? <MarkdownContent text={message.content} dark={isUser} /> : <span className="text-slate-400">Thinking…</span>}
        </div>
        <div className={`mt-1 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 ${isUser ? 'justify-end' : 'justify-start'}`}>
          {!isUser ? <button className="rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700" onClick={() => void copy()} title="Copy">{copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}</button> : null}
          {canRetry ? <button className="flex items-center gap-1 rounded-md px-2 py-1 text-[12px] text-slate-500 hover:bg-slate-100 hover:text-slate-800 disabled:opacity-50" disabled={retryDisabled} onClick={() => onRetry?.(message)}><RotateCcw className="h-3.5 w-3.5" />{retryPending ? 'Retrying…' : 'Retry'}</button> : null}
        </div>
      </div>
      {isUser ? <div className="mt-6 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-slate-600"><UserRound className="h-4 w-4" /></div> : null}
    </article>
  )
}

function MarkdownContent({ text, dark }: { text: string; dark: boolean }) {
  const blocks = text.split(/```/g)
  return <div className="grid gap-3">{blocks.map((block, index) => index % 2 === 1 ? <pre key={index} className="overflow-x-auto rounded-lg bg-slate-950 p-3 font-mono text-[12px] leading-5 text-slate-200">{block.replace(/^\w+\n/, '')}</pre> : <MarkdownText key={index} text={block} dark={dark} />)}</div>
}

function MarkdownText({ text, dark }: { text: string; dark: boolean }) {
  return <div className="grid gap-2">{text.split(/\n\s*\n/).filter(Boolean).map((paragraph, index) => {
    const lines = paragraph.split('\n')
    if (lines.every((line) => /^\s*[-*]\s+/.test(line))) return <ul key={index} className="m-0 list-disc space-y-1 pl-5">{lines.map((line) => <li key={line}>{inlineMarkdown(line.replace(/^\s*[-*]\s+/, ''), dark)}</li>)}</ul>
    if (/^#{1,3}\s/.test(paragraph)) return <h3 key={index} className="m-0 text-[15px] font-semibold">{inlineMarkdown(paragraph.replace(/^#{1,3}\s+/, ''), dark)}</h3>
    return <p key={index} className="m-0 whitespace-pre-wrap">{inlineMarkdown(paragraph, dark)}</p>
  })}</div>
}

function inlineMarkdown(value: string, dark: boolean): ReactNode {
  const parts = value.split(/(`[^`]+`)/g)
  return parts.map((part, index) => part.startsWith('`') && part.endsWith('`') ? <code key={index} className={`rounded px-1.5 py-0.5 font-mono text-[12px] ${dark ? 'bg-white/15 text-white' : 'bg-slate-100 text-slate-800'}`}>{part.slice(1, -1)}</code> : part)
}
