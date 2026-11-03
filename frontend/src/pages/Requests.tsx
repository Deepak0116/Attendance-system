import { useState, type FormEvent } from 'react'
import RequestsTable from '../components/RequestsTable'
import WfhPanel from '../components/WfhPanel'
import { Card, ErrorBox, Loading, PageHeader, Tabs } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useWfh } from '../context/WfhContext'
import { useAsync } from '../hooks/useAsync'
import { api, errorMessage } from '../services/api'
import type { CompOffMine, Named, RequestItem } from '../types'
import { fmtDate, toIsoDate } from '../utils/format'
import { DataTable, StatusPill } from '../components/ui'

function approverNote(role?: string) {
  return role === 'Team Lead' ? 'Your request goes to HR for approval.' : 'Your request goes to your Team Lead for approval.'
}

function RequestForm({ kind, leaveTypes, onDone }: { kind: 'leave' | 'wfh'; leaveTypes: Named[]; onDone: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const today = toIsoDate(new Date())
  const [leaveType, setLeaveType] = useState('')
  const [from, setFrom] = useState(today)
  const [to, setTo] = useState(today)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (from > to) { setError('From Date cannot be after To Date.'); return }
    if (kind === 'leave' && !leaveType) { setError('Select a leave type.'); return }
    if (reason.trim().length < 3) { setError('Please provide a reason.'); return }
    setBusy(true); setError('')
    try {
      await api.post(`/${kind}`, { from_date: from, to_date: to, reason: reason.trim(), ...(kind === 'leave' ? { leave_type: leaveType } : {}) })
      toast.success(`${kind === 'leave' ? 'Leave' : 'WFH'} request submitted – Pending ${user?.role === 'Team Lead' ? 'HR' : 'TL'} Approval`)
      setReason(''); setLeaveType('')
      onDone()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Card title={kind === 'leave' ? 'Apply for Leave' : 'Request Work From Home'}>
      <form className="form-grid" onSubmit={submit} noValidate>
        {kind === 'leave' && (
          <label className="field"><span>Leave Type <em className="req">*</em></span>
            <select value={leaveType} onChange={(e) => setLeaveType(e.target.value)}>
              <option value="">Select leave type</option>
              {leaveTypes.map((t) => <option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>From Date <em className="req">*</em></span><input type="date" min={today} value={from} onChange={(e) => { setFrom(e.target.value); if (e.target.value > to) setTo(e.target.value) }} /></label>
        <label className="field"><span>To Date <em className="req">*</em></span><input type="date" min={from || today} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="field full"><span>Reason <em className="req">*</em></span><textarea rows={3} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Briefly explain your request" /></label>
        {error && <div className="full"><ErrorBox message={error} /></div>}
        <div className="full btn-row">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</button>
          <span className="muted small">{approverNote(user?.role)}</span>
        </div>
      </form>
    </Card>
  )
}

function CompOffCard({ data }: { data: CompOffMine }) {
  return (
    <Card title="Comp Off Balance">
      <div className="comp-balance">
        <div className="big">{data.available_to_request}</div>
        <div>
          <strong>day(s) available to request</strong>
          <div className="muted small">
            Earned by working on your weekly off day{data.expiry_days ? `; each credit is valid for ${data.expiry_days} days` : ''}.
            Apply with Leave Type “Comp Off”.
            {data.balance !== data.available_to_request && ` ${data.balance - data.available_to_request} day(s) are held by pending requests.`}
          </div>
        </div>
      </div>
      {data.ledger.length > 0 && (
        <DataTable rows={data.ledger} rowKey={(e) => e.id} columns={[
          { header: 'Worked On', render: (e) => fmtDate(e.work_date) },
          { header: 'Credit', render: (e) => `${e.credit} day` },
          { header: 'Status', render: (e) => <StatusPill status={e.status === 'Available' ? 'Active' : e.status} /> },
          { header: 'Used In', render: (e) => e.used_request_id || '—' }]} />
      )}
    </Card>
  )
}

export function LeavePage() {
  const { user } = useAuth()
  const types = useAsync(() => api.get<Named[]>('/leave-types'), [])
  const list = useAsync(() => api.get<RequestItem[]>('/leave/my'), [], 60_000)
  const comp = useAsync(() => api.get<CompOffMine>('/comp-off/my'), [])
  return (
    <>
      <PageHeader title={user?.role === 'Team Lead' ? 'My Leave' : 'Leave'} subtitle="Apply for leave and track your requests" />
      <div className="stack-lg">
        {comp.data && (comp.data.ledger.length > 0 || (types.data ?? []).some((t) => t.name === 'Comp Off')) && <CompOffCard data={comp.data} />}
        <RequestForm kind="leave" leaveTypes={types.data ?? []} onDone={() => { void list.reload(); void comp.reload() }} />
        <Card title="My Leave Requests">
          {list.loading && !list.data && <Loading />}
          {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
          {list.data && <RequestsTable rows={list.data} emptyTitle="No leave requests yet" emptyText="Use the form above to apply for leave." />}
        </Card>
      </div>
    </>
  )
}

export function WfhPage() {
  const { user } = useAuth()
  const { refresh } = useWfh()
  const list = useAsync(() => api.get<RequestItem[]>('/wfh/my'), [], 60_000)
  return (
    <>
      <PageHeader title={user?.role === 'Team Lead' ? 'My WFH' : 'Work From Home'} subtitle="Request WFH, start your day and verify your location" />
      <div className="stack-lg">
        <WfhPanel />
        <RequestForm kind="wfh" leaveTypes={[]} onDone={() => { void list.reload(); void refresh() }} />
        <Card title="WFH Request History">
          {list.loading && !list.data && <Loading />}
          {list.error && <ErrorBox message={list.error} onRetry={list.reload} />}
          {list.data && <RequestsTable rows={list.data} emptyTitle="No WFH requests yet" emptyText="Use the form above to request work from home." />}
        </Card>
      </div>
    </>
  )
}

type Tab = 'all' | 'leave' | 'wfh'
export function MyRequests() {
  const [tab, setTab] = useState<Tab>('all')
  const { data, loading, error, reload } = useAsync(() => api.get<RequestItem[]>('/requests/my', { type: tab }), [tab], 60_000)
  return (
    <>
      <PageHeader title="My Requests" subtitle="All your leave and WFH requests" />
      <Card>
        <Tabs<Tab> value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All' }, { value: 'leave', label: 'Leave' }, { value: 'wfh', label: 'WFH' }]} />
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && <RequestsTable rows={data} emptyTitle="No requests yet" emptyText="Leave and WFH requests you submit will show up here." />}
      </Card>
    </>
  )
}
