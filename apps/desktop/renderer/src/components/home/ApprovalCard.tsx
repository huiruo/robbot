import type { ApprovalState } from '../../lib/harness-event-store'

export function ApprovalCard(props: { approval: ApprovalState; onDecision: (approved: boolean) => void }) {
  return (
    <article className="max-w-[760px] rounded-md border border-amber-200 bg-amber-50 p-4 text-amber-950">
      <strong className="block text-[14px]">{props.approval.title}</strong>
      {props.approval.description ? <p className="my-2 text-[13px] leading-5">{props.approval.description}</p> : null}
      <div className="mt-3 flex gap-2">
        <button className="rounded-md border border-amber-300 bg-white px-3 py-2 text-[13px]" onClick={() => props.onDecision(false)}>
          Deny
        </button>
        <button className="rounded-md bg-slate-900 px-3 py-2 text-[13px] font-medium text-white" onClick={() => props.onDecision(true)}>
          Allow once
        </button>
      </div>
    </article>
  )
}
