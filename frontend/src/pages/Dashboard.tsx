import { useState } from 'react'
import { Link } from 'react-router-dom'
import { DepartmentBars, TrendChart } from '../components/Charts'
import CheckInCard from '../components/CheckInCard'
import Icon from '../components/Icon'
import RequestsTable from '../components/RequestsTable'
import WfhPanel from '../components/WfhPanel'
import { Card, DataTable, EmptyState, ErrorBox, Loading, RangeFilter, SelectFilter, StatCard, StatusPill } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useWfh } from '../context/WfhContext'
import { useAsync } from '../hooks/useAsync'
import { useFilterOptions } from '../hooks/useFilterOptions'
import { api } from '../services/api'
import type { MyDashboard, OverviewStats } from '../types'
import { fmtRange, fmtTime } from '../utils/format'
import { initialRange } from '../utils/range'

function TodayStatus({ data }: { data: MyDashboard }) {
  const { wfh } = useWfh()
  const t = data.today
  let title = 'Not Checked In', detail = '', chip = '', tone = 'grey'
  if (wfh?.started && !wfh.ended) {
    title = 'Work From Home – Active'; detail = `Started at: ${fmtTime(wfh.start_time)}`; chip = `Next Verification: ${fmtTime(wfh.next_verification)}`; tone = 'green'
  } else if (wfh?.ended) { title = 'Work From Home – Completed'; detail = `Started at: ${fmtTime(wfh.start_time)}`; tone = 'green' }
  else if (t.checked_in) { title = 'Present'; detail = `Checked In – ${fmtTime(t.check_in_time)}`; tone = 'green' }
  else if (t.on_leave) { title = 'On Leave'; tone = 'amber' }
  else if (t.wfh_approved) { title = 'Work From Home – Approved'; detail = 'Start your WFH to begin the day'; tone = 'purple' }
  else if (!t.working_day) { title = 'Non-working day'; tone = 'grey' }
  return (
    <Card title="Today's Status" className="today-card">
      <div className="today-body">
        <div className={`today-icon tone-${tone}`}><Icon name={wfh?.started || t.wfh_approved ? 'home' : t.on_leave ? 'leave' : 'checkCircle'} size={26} /></div>
        <div>
          <div className="today-title">{title}</div>
          {detail && <div className="muted">{detail}</div>}
          {chip && <span className="pill pill-green chip">{chip}</span>}
          {(wfh?.approved) && <div><Link className="link" to="/wfh">View Details <Icon name="arrow" size={14} /></Link></div>}
        </div>
      </div>
    </Card>
  )
}

function EmployeeDashboard() {
  const { user } = useAuth()
  const { wfh } = useWfh()
  const { data, loading, error, reload } = useAsync(() => api.get<MyDashboard>('/dashboard/me'), [], 60_000)
  if (!user) return null
  const s = data?.summary
  return (
    <div className="stack-lg">
      {wfh?.approved ? <WfhPanel showBack /> : <CheckInCard onChanged={reload} />}
      {loading && !data && <Loading />}
      {error && !data && <ErrorBox message={error} onRetry={reload} />}
      {data && s && (
        <>
          <div className="stat-grid five">
            <StatCard label="Present Days" value={s.present_days} hint="This Month" icon="calendar" tone="blue" />
            <StatCard label="Leave Days" value={s.leave_days} hint="This Month" icon="leave" tone="orange" />
            <StatCard label="WFH Days" value={s.wfh_days} hint="This Month" icon="home" tone="purple" />
            <StatCard label="Total Working Days" value={s.total_working_days} hint="This Month" icon="clock" tone="teal" />
            <StatCard label="Comp Off Balance" value={s.comp_off_balance} hint="Days available" icon="checkCircle" tone="green" />
          </div>
          <div className="two-col">
            <TodayStatus data={data} />
            <Card title="Quick Actions">
              <div className="quick-actions">
                <Link className="btn btn-primary" to="/leave"><Icon name="leave" size={16} /> Apply Leave</Link>
                <Link className="btn btn-soft" to="/wfh"><Icon name="home" size={16} /> Request WFH</Link>
                <Link className="btn btn-ghost" to="/my-requests"><Icon name="file" size={16} /> View My Requests{data.pending_requests ? ` (${data.pending_requests} pending)` : ''}</Link>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  )
}

function ManagerDashboard() {
  const { user } = useAuth()
  const { wfh } = useWfh()
  const [range, setRange] = useState(initialRange('today'))
  const [department, setDepartment] = useState('')
  const [teamLead, setTeamLead] = useState('')
  const [employee, setEmployee] = useState('')
  const { departments, employees, teamLeads } = useFilterOptions()
  const customReady = range.preset !== 'custom' || (range.from && range.to && range.from <= range.to)
  const { data, loading, error, reload } = useAsync(
    () => customReady
      ? api.get<OverviewStats>('/dashboard/stats', { range: range.preset, from: range.from, to: range.to, department, team_lead_id: teamLead, employee_id: employee })
      : Promise.resolve(null),
    [range.preset, range.from, range.to, department, teamLead, employee], 60_000)
  if (!user) return null
  const role = user.role
  const multi = (data?.range.days ?? 1) > 1
  const unit = multi ? ' (person-days)' : ''
  const tlView = role === 'Team Lead'

  return (
    <div className="stack-lg">
      {tlView && wfh?.approved ? <WfhPanel showBack /> : <CheckInCard onChanged={reload} />}
      <div className="filter-bar card">
        <RangeFilter value={range} onChange={setRange} />
        {role !== 'Team Lead' && <SelectFilter label="Department" value={department} onChange={setDepartment} options={departments.map((d) => ({ value: d.name, label: d.name }))} />}
        {role !== 'Team Lead' && <SelectFilter label="Team" value={teamLead} onChange={setTeamLead} allLabel="All teams" options={teamLeads.map((t) => ({ value: t.employee_id, label: `${t.name}'s team` }))} />}
        <SelectFilter label="Employee" value={employee} onChange={setEmployee} options={employees.filter((e) => e.role !== 'Admin').map((e) => ({ value: e.employee_id, label: e.name }))} />
      </div>
      {loading && !data && <Loading />}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {!customReady && <EmptyState title="Pick a valid custom date range" icon="calendar" />}
      {data && (
        <>
          <div className={`stat-grid ${role === 'Admin' ? 'five' : 'six'}`}>
            <StatCard label={tlView ? 'Total Team Members' : 'Total Employees'} value={data.total_employees} icon="users" tone="blue" />
            <StatCard label={`Present${unit}`} value={data.present} icon="checkCircle" tone="green" />
            <StatCard label={`On Leave${unit}`} value={data.on_leave} icon="leave" tone="orange" />
            <StatCard label={`WFH${unit}`} value={data.wfh} icon="home" tone="purple" />
            <StatCard label={`Not Checked In${unit}`} value={data.not_checked_in} icon="alert" tone="red" />
            {role !== 'Admin' && <StatCard label="Pending Approvals" value={data.pending_approvals} icon="inbox" tone="amber" />}
          </div>

          {role === 'Admin' && (
            <div className="quick-actions card">
              <Link className="btn btn-primary" to="/employees"><Icon name="users" size={16} /> Manage Employees</Link>
              <Link className="btn btn-soft" to="/reports"><Icon name="chart" size={16} /> Generate Reports</Link>
              <Link className="btn btn-soft" to="/pending"><Icon name="check" size={16} /> View Approvals{data.pending_approvals ? ` (${data.pending_approvals})` : ''}</Link>
              <Link className="btn btn-ghost" to="/settings"><Icon name="settings" size={16} /> System Settings</Link>
            </div>
          )}

          {tlView && (
            <Card title="Pending Requests" actions={<Link className="link" to="/pending">View all</Link>}>
              <RequestsTable rows={data.pending_requests} showEmployee actions onChanged={reload} emptyTitle="No pending requests" emptyText="New requests from your team will appear here." />
            </Card>
          )}

          {role === 'HR' && (
            <Card title="Recent Requests" actions={<Link className="link" to="/leave-overview">View all</Link>}>
              <RequestsTable rows={data.recent_requests} showEmployee emptyTitle="No requests yet" />
            </Card>
          )}

          {role === 'Admin' ? (
            <>
              <div className="two-col">
                <Card title="Attendance Overview"><TrendChart data={data.trend} series={[
                  { key: 'present', label: 'Present', color: 'var(--green)' }, { key: 'wfh', label: 'WFH', color: 'var(--purple)' },
                  { key: 'leave', label: 'Leave', color: 'var(--orange)' }, { key: 'not_checked_in', label: 'Not checked in', color: 'var(--red)' }]} /></Card>
                <Card title="Department Summary"><DepartmentBars data={data.departments ?? []} /></Card>
              </div>
              <div className="two-col">
                <Card title="Leave Chart"><TrendChart data={data.trend} series={[{ key: 'leave', label: 'On leave', color: 'var(--orange)' }]} /></Card>
                <Card title="WFH Chart"><TrendChart data={data.trend} series={[{ key: 'wfh', label: 'WFH', color: 'var(--purple)' }]} /></Card>
              </div>
              <Card title="Recent Activities">
                {data.recent_activities?.length ? (
                  <ul className="activity">{data.recent_activities.map((a, i) => <li key={i}><i /> <span>{a.text}</span><small>{fmtTime(a.time)}</small></li>)}</ul>
                ) : <EmptyState title="No activity yet" />}
              </Card>
            </>
          ) : role === 'HR' ? (
            <div className="two-col">
              <Card title="Leave Trends"><TrendChart data={data.trend} series={[{ key: 'leave', label: 'On leave', color: 'var(--orange)' }]} /></Card>
              <Card title="WFH Trends"><TrendChart data={data.trend} series={[{ key: 'wfh', label: 'WFH', color: 'var(--purple)' }]} /></Card>
            </div>
          ) : (
            <Card title="Team WFH Tracking" actions={<Link className="link" to="/wfh-tracking">Open tracking</Link>}>
              <DataTable rows={data.wfh_sessions} rowKey={(r) => r.employee_id + r.date} emptyTitle="No WFH sessions in this period" columns={[
                { header: 'Employee', render: (r) => r.employee_name },
                { header: 'Start Time', render: (r) => fmtTime(r.start_time) },
                { header: 'Last Verification', render: (r) => fmtTime(r.last_verification) },
                { header: 'Next Due', render: (r) => fmtTime(r.next_verification) },
                { header: 'Status', render: (r) => <StatusPill status={r.status} /> }]} />
            </Card>
          )}
          <p className="muted small">Showing {fmtRange(data.range.from, data.range.to)}{multi ? ' · counts are person-days across the period' : ''}</p>
        </>
      )}
    </div>
  )
}

export default function Dashboard() {
  const { user } = useAuth()
  return user?.role === 'Employee' ? <EmployeeDashboard /> : <ManagerDashboard />
}
