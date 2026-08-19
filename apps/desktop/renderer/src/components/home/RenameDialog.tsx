import { useState } from 'react'
import type { RenameTarget } from '../../hooks/useWorkspaceChat'

export function RenameDialog(props: {
  target: RenameTarget | null
  onCancel(): void
  onRename(value: string): void
}) {
  if (!props.target) {
    return null
  }

  return <RenameDialogContent key={`${props.target.kind}:${props.target.target.id}`} {...props} target={props.target} />
}

function RenameDialogContent(props: {
  target: RenameTarget
  onCancel(): void
  onRename(value: string): void
}) {
  const [value, setValue] = useState(() => targetName(props.target))

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 p-4" onMouseDown={props.onCancel}>
      <form
        className="w-full max-w-sm rounded-md border border-slate-200 bg-white p-5 shadow-xl"
        onSubmit={(event) => {
          event.preventDefault()
          props.onRename(value)
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className="text-[15px] font-semibold text-slate-950">
          Rename {props.target.kind === 'workspace' ? 'workspace' : 'chat'}
        </h2>
        <input
          autoFocus
          className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-[13px] outline-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-500/10"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          aria-label="New name"
        />
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="rounded-md border border-slate-200 px-3 py-2 text-[13px] text-slate-700 hover:bg-slate-50"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!value.trim()}
            className="rounded-md bg-emerald-600 px-3 py-2 text-[13px] font-semibold text-white hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Rename
          </button>
        </div>
      </form>
    </div>
  )
}

function targetName(target: RenameTarget): string {
  return (target.kind === 'workspace' ? target.target.name : target.target.title ?? 'New Chat').trim()
}
