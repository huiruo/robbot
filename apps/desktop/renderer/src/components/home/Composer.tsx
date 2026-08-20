import { LoaderCircle, Send } from 'lucide-react'

export function Composer(props: {
  value: string
  disabled: boolean
  running: boolean
  placeholder: string
  canCreateWorkspace: boolean
  onChange(value: string): void
  onSend(): void
  onCreateWorkspace(): void
}) {
  return (
    <footer className="border-t border-slate-200 bg-white p-4">
      <div className="mx-auto flex max-w-[900px] gap-3">
        <textarea
          className="min-h-20 flex-1 resize-none rounded-md border border-slate-300 bg-white px-3 py-2.5 text-[14px] leading-5 outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10 disabled:bg-slate-50"
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          readOnly={props.canCreateWorkspace}
          onClick={props.canCreateWorkspace ? props.onCreateWorkspace : undefined}
          onChange={(event) => props.onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              props.onSend()
            }
          }}
        />
        <button
          className="flex h-11 items-center gap-2 self-end rounded-md bg-emerald-600 px-4 text-[13px] font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={props.disabled || !props.value.trim()}
          onClick={props.onSend}
        >
          {props.running ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          Send
        </button>
      </div>
    </footer>
  )
}
