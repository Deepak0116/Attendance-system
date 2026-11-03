import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useToast } from '../context/ToastContext'
import { api, errorMessage } from '../services/api'
import type { RequestItem } from '../types'
import { fmtDateTime, fmtRange } from '../utils/format'
import { ConfirmDialog, DataTable, RejectDialog, StatusPill, type Column } from './ui'
import Icon from './Icon'

interface Props {
  rows: RequestItem[]
  /** Show requester name/department columns (approver / overview screens). */
  showEmployee?: boolean
  /** Show approve / reject buttons on rows the current user may decide. */
  actions?: boolean
  onChanged?: () => void
  emptyTitle?: string
  emptyText?: string
}

export default function RequestsTable({ rows, showEmployee = false, actions = false, onChanged, emptyTitle = 'No requests found', emptyText }: Props) {
  const toast = useToast()
  const [params] = useSearchParams()
  const focusId = params.get('request') ?? ''
  const focusType = (params.get('type') ?? '').toLowerCase()
  const isFocus = (r: RequestItem) => !!focusId && r.id === focusId && (!focusType || r.type.toLowerCase() === focusType)
  const [approve, setApprove] = useState<RequestItem | null>(null)
  const [reject, setReject] = useState<RequestItem | null>(null)
  const [busy, setBusy] = useState(false)
  const hasFocus = rows.some(isFocus)
  useEffect(() => {
    if (!hasFocus) return
    const row = rows.find(isFocus)
    if (row) document.getElementById(`row-${row.type}-${row.id}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasFocus, focusId])
  const path = (r: RequestItem) => `/${r.type === 'Leave' ? 'leave' : 'wfh'}/${r.id}`

  const submit = async (r: RequestItem, kind: 'approve' | 'reject', reason = '') => {
    setBusy(true)
    try {
      await api.post(`${path(r)}/${kind}`, kind === 'reject' ? { reason } : {})
      toast.success(`${r.type} request ${kind === 'approve' ? 'approved' : 'rejected'}`)
      setApprove(null); setReject(null)
      onChanged?.()
    } catch (e) {
      toast.error(errorMessage(e))
      onChanged?.()
      setApprove(null); setReject(null)
    } finally {
      setBusy(false)
    }
  }

  const decided = (r: RequestItem) => r.status === 'Approved' || r.status === 'Rejected'
  const cols: Column<RequestItem>[] = []
  if (showEmployee) {
    cols.push({ header: 'Employee', render: (r) => <><strong>{r.employee_name}</strong> <span className="muted small">{r.employee_id} · {r.department}</span></> })
  }
  cols.push(
    { header: 'Type', render: (r) => <span className={`type-chip ${r.type === 'WFH' ? 'wfh' : 'leave'}`}>{r.type}</span> },
    { header: 'Leave Type', render: (r) => r.leave_type || '—' },
    { header: 'Dates', render: (r) => fmtRange(r.from_date, r.to_date) },
    { header: 'Reason', render: (r) => <span className="clip" title={r.reason}>{r.reason}</span>, className: 'reason' },
    { header: 'Status', render: (r) => <StatusPill status={r.status} /> },
    { header: 'Decided By', render: (r) => (decided(r) ? r.approver_name || '—' : '—') },
    { header: 'Decision Date', render: (r) => (decided(r) ? fmtDateTime(r.approval_date) : '—') },
    { header: 'Rejection Reason', render: (r) => r.rejection_reason || '—', className: 'reason' },
  )
  if (actions) {
    cols.push({
      header: 'Actions',
      render: (r) => r.can_decide === false || decided(r) ? <span className="muted small">—</span> : (
        <div className="btn-row nowrap">
          <button className="btn btn-sm btn-success" onClick={() => setApprove(r)}><Icon name="check" size={14} /> Approve</button>
          <button className="btn btn-sm btn-danger-soft" onClick={() => setReject(r)}><Icon name="x" size={14} /> Reject</button>
        </div>
      ),
    })
  }

  return (
    <>
      <DataTable columns={cols} rows={rows} rowKey={(r) => `${r.type}-${r.id}`} emptyTitle={emptyTitle} emptyText={emptyText} rowClass={(r) => (isFocus(r) ? 'row-hl' : '')} />
      <ConfirmDialog open={!!approve} title="Approve request" busy={busy} confirmLabel="Approve"
        message={approve && `Approve ${approve.type.toLowerCase()} request from ${approve.employee_name} (${fmtRange(approve.from_date, approve.to_date)})?`}
        onConfirm={() => approve && submit(approve, 'approve')} onCancel={() => setApprove(null)} />
      <RejectDialog open={!!reject} busy={busy} subject={reject ? `Reject ${reject.type.toLowerCase()} request from ${reject.employee_name} (${fmtRange(reject.from_date, reject.to_date)})` : ''}
        onSubmit={(reason) => reject && submit(reject, 'reject', reason)} onCancel={() => setReject(null)} />
    </>
  )
}
