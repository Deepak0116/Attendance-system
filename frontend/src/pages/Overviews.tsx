import { useState } from 'react'
import Icon from '../components/Icon'
import LocationDetails from '../components/LocationDetails'
import RequestsTable from '../components/RequestsTable'
import { Card, DataTable, ErrorBox, Loading, PageHeader, RangeFilter, SelectFilter, StatCard, StatusPill, Tabs } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useAsync } from '../hooks/useAsync'
import { useFilterOptions } from '../hooks/useFilterOptions'
import { api } from '../services/api'
import type { CompOffRow, Named, RequestItem, WfhSession, WfhStats } from '../types'
import { fmtDate, fmtTime } from '../utils/format'
import { initialRange } from '../utils/range'

const REQUEST_STATUSES = ['Pending TL Approval', 'Pending HR Approval', 'Approved', 'Rejected', 'Cancelled'].map((s) => ({ value: s, label: s }))
const WFH_STATUSES = ['Verified', 'Verification Due', 'Pending Verification', 'Missed Verification', 'Completed'].map((s) => ({ value: s, label: s }))

function DateBounds({ from, to, onChange }: { from: string; to: string; onChange: (f: string, t: string) => void }) {
  return (
    <>
      <label className="field inline"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(e) => onChange(e.target.value, to)} /></label>
      <label className="field inline"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(e) => onChange(from, e.target.value)} /></label>
      {(from || to) && <button className="btn btn-sm btn-ghost" onClick={() => onChange('', '')}>Clear dates</button>}
    </>
  )
}

function useScopedFilters() {
  const { departments, employees, teamLeads } = useFilterOptions()
  const [department, setDepartment] = useState('')
  const [team, setTeam] = useState('')
  const [employee, setEmployee] = useState('')
  const nodes = () => (
    <>
      <SelectFilter label="Department" value={department} onChange={setDepartment} options={departments.map((d) => ({ value: d.name, label: d.name }))} />
      <SelectFilter label="Team" value={team} onChange={setTeam} allLabel="All teams" options={teamLeads.map((t) => ({ value: t.employee_id, label: `${t.name}'s team` }))} />
      <SelectFilter label="Employee" value={employee} onChange={setEmployee} options={employees.filter((e) => e.role !== 'Admin').map((e) => ({ value: e.employee_id, label: e.name }))} />
    </>
  )
  return { department, team, employee, nodes }
}

/** HR / Admin: every leave request with filters. Admin sees approve/reject when override is enabled. */
export function LeaveOverview() {
  const { user } = useAuth()
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState('')
  const [leaveType, setLeaveType] = useState('')
  const f = useScopedFilters()
  const types = useAsync(() => api.get<Named[]>('/leave-types', { all: true }), [])
  const valid = (!from && !to) || (from && to && from <= to)
  const { data, loading, error, reload } = useAsync(
    () => valid ? api.get<RequestItem[]>('/leave', { from, to, status, leave_type: leaveType, department: f.department, team_lead_id: f.team, employee_id: f.employee }) : Promise.resolve([] as RequestItem[]),
    [from, to, status, leaveType, f.department, f.team, f.employee], 60_000)
  const comp = useAsync(() => api.get<CompOffRow[]>('/comp-off', { department: f.department, employee_id: f.employee }), [f.department, f.employee])
  const count = (s: string) => data?.filter((r) => r.status === s).length ?? 0
  return (
    <>
      <PageHeader title={user?.role === 'HR' ? 'Leave Overview' : 'Leave'} subtitle="All leave requests across the company" />
      <div className="stat-grid">
        <StatCard label="Total Requests" value={data?.length ?? 0} icon="leave" tone="blue" />
        <StatCard label="Pending" value={count('Pending TL Approval') + count('Pending HR Approval')} icon="inbox" tone="amber" />
        <StatCard label="Approved" value={count('Approved')} icon="checkCircle" tone="green" />
        <StatCard label="Rejected" value={count('Rejected')} icon="x" tone="red" />
      </div>
      <Card className="mt">
        <div className="filter-bar">
          <DateBounds from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b) }} />
          {f.nodes()}
          <SelectFilter label="Leave Type" value={leaveType} onChange={setLeaveType} options={(types.data ?? []).map((t) => ({ value: t.name, label: t.name }))} />
          <SelectFilter label="Status" value={status} onChange={setStatus} options={REQUEST_STATUSES} />
        </div>
        {!valid && <ErrorBox message="Choose both dates, and make sure From is not after To." />}
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && <RequestsTable rows={data} showEmployee actions onChanged={reload} emptyTitle="No leave requests found" emptyText="Adjust the filters." />}
      </Card>
      <Card title="Comp Off Credits" className="mt">
        {comp.error && <ErrorBox message={comp.error} onRetry={comp.reload} />}
        {comp.data && <DataTable rows={comp.data} rowKey={(r) => r.id} emptyTitle="No comp-off credits yet" emptyText="Credits are earned when a team works on its weekly off day (e.g. Support on weekends)." columns={[
          { header: 'Employee', render: (r) => <><strong>{r.employee_name}</strong><div className="muted small">{r.employee_id} · {r.department}</div></> },
          { header: 'Worked On', render: (r) => fmtDate(r.work_date) },
          { header: 'Status', render: (r) => <StatusPill status={r.status === 'Available' ? 'Active' : r.status} /> },
          { header: 'Used In', render: (r) => r.used_request_id || '—' }]} />}
      </Card>
    </>
  )
}

interface Tracking { stats: WfhStats; items: WfhSession[] }

function SessionTable({ items, onDetails, withTeam }: { items: WfhSession[]; onDetails: (s: WfhSession) => void; withTeam: boolean }) {
  return (
    <DataTable rows={items} rowKey={(r) => r.employee_id + r.date} emptyTitle="No WFH sessions" emptyText="No employees are working from home in this period." columns={[
      { header: 'Date', render: (r) => fmtDate(r.date) },
      { header: 'Employee', render: (r) => <><strong>{r.employee_name}</strong><div className="muted small">{r.department}{withTeam && r.team_lead_name ? ` · ${r.team_lead_name}'s team` : ''}</div></> },
      { header: 'Start Time', render: (r) => fmtTime(r.start_time) },
      { header: 'Last Verification', render: (r) => fmtTime(r.last_verification) },
      { header: 'Next Due', render: (r) => fmtTime(r.next_verification) },
      { header: 'Status', render: (r) => <StatusPill status={r.status} /> },
      { header: 'Details', render: (r) => <button className="btn btn-sm btn-soft" onClick={() => onDetails(r)}><Icon name="pin" size={14} /> View</button> },
    ]} />
  )
}

/** HR / Admin WFH overview: verification stats, filters (date, employee, department, team) and WFH requests. */
export function WfhOverview() {
  const { user } = useAuth()
  const [tab, setTab] = useState<'sessions' | 'requests'>('sessions')
  const [range, setRange] = useState(initialRange('today'))
  const [status, setStatus] = useState('')
  const [detail, setDetail] = useState<WfhSession | null>(null)
  const f = useScopedFilters()
  const valid = range.preset !== 'custom' || (range.from && range.to && range.from <= range.to)
  const common = { from: range.from, to: range.to, department: f.department, team_lead_id: f.team, employee_id: f.employee }
  const sessions = useAsync(() => valid ? api.get<Tracking>('/wfh/tracking', { ...common, status }) : Promise.resolve(null), [range.from, range.to, f.department, f.team, f.employee, status], 30_000)
  const reqs = useAsync(() => valid ? api.get<RequestItem[]>('/wfh/requests', { ...common, status: tab === 'requests' ? status : '' }) : Promise.resolve([] as RequestItem[]), [range.from, range.to, f.department, f.team, f.employee, status, tab])
  const s = sessions.data?.stats
  return (
    <>
      <PageHeader title="WFH Overview" subtitle={user?.role === 'HR' ? 'Verification status for all employees working from home' : 'WFH activity across the company'} />
      <div className="stat-grid five">
        <StatCard label="Total WFH" value={s?.total ?? 0} icon="home" tone="blue" />
        <StatCard label="Verified" value={s?.verified ?? 0} icon="checkCircle" tone="green" />
        <StatCard label="Pending" value={s?.pending ?? 0} icon="clock" tone="orange" />
        <StatCard label="Verification Due" value={s?.due ?? 0} icon="hourglass" tone="amber" />
        <StatCard label="Missed Verification" value={s?.missed ?? 0} icon="alert" tone="red" />
      </div>
      <Card className="mt">
        <div className="filter-bar">
          <RangeFilter value={range} onChange={setRange} />
          {f.nodes()}
          <SelectFilter label="Status" value={status} onChange={setStatus} options={tab === 'sessions' ? WFH_STATUSES : REQUEST_STATUSES} />
        </div>
        <Tabs value={tab} onChange={(t) => { setTab(t); setStatus('') }} tabs={[{ value: 'sessions', label: 'WFH Verification' }, { value: 'requests', label: 'WFH Requests' }]} />
        {tab === 'sessions' ? (
          <>
            {sessions.loading && !sessions.data && <Loading />}
            {sessions.error && <ErrorBox message={sessions.error} onRetry={sessions.reload} />}
            {sessions.data && <SessionTable items={sessions.data.items} onDetails={setDetail} withTeam />}
          </>
        ) : (
          <>
            {reqs.loading && !reqs.data && <Loading />}
            {reqs.error && <ErrorBox message={reqs.error} onRetry={reqs.reload} />}
            {reqs.data && <RequestsTable rows={reqs.data} showEmployee actions onChanged={() => { void reqs.reload(); void sessions.reload() }} emptyTitle="No WFH requests found" />}
          </>
        )}
      </Card>
      <LocationDetails session={detail} onClose={() => setDetail(null)} />
    </>
  )
}

/** Team Lead: WFH tracking for the TL's own team only (the API enforces this). */
export function WfhTracking() {
  const [range, setRange] = useState(initialRange('today'))
  const [detail, setDetail] = useState<WfhSession | null>(null)
  const valid = range.preset !== 'custom' || (range.from && range.to && range.from <= range.to)
  const team = useAsync(() => api.get<unknown[]>('/employees'), [])
  const { data, loading, error, reload } = useAsync(
    () => valid ? api.get<Tracking>('/wfh/tracking', { from: range.from, to: range.to }) : Promise.resolve(null), [range.from, range.to], 30_000)
  const s = data?.stats
  return (
    <>
      <PageHeader title="Team WFH Tracking" subtitle="Verification status of your team members" actions={<RangeFilter value={range} onChange={setRange} />} />
      <div className="stat-grid">
        <StatCard label="Total Team" value={team.data?.length ?? 0} icon="users" tone="blue" />
        <StatCard label="WFH" value={s?.total ?? 0} icon="home" tone="green" />
        <StatCard label="Verification Due" value={s?.due ?? 0} icon="hourglass" tone="amber" />
        <StatCard label="Missed" value={s?.missed ?? 0} icon="alert" tone="red" />
      </div>
      <Card className="mt">
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && <SessionTable items={data.items} onDetails={setDetail} withTeam={false} />}
      </Card>
      <LocationDetails session={detail} onClose={() => setDetail(null)} />
    </>
  )
}
