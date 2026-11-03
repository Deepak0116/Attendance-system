import { useState } from 'react'
import { Card, DataTable, ErrorBox, Loading, PageHeader, RangeFilter, SelectFilter, StatusPill, Tabs } from '../components/ui'
import { useAsync } from '../hooks/useAsync'
import { useFilterOptions } from '../hooks/useFilterOptions'
import { useAuth } from '../context/AuthContext'
import { api } from '../services/api'
import type { AttendanceDay, AttendanceRow } from '../types'
import { fmtDate, fmtTime, toIsoDate } from '../utils/format'
import { initialRange } from '../utils/range'

const STATUSES = ['Present', 'Leave', 'WFH', 'Not Checked In'].map((s) => ({ value: s, label: s }))

type Mode = 'date' | 'month' | 'range'

/** Employee / TL personal attendance history with Date, Month and Date-range filters. */
export function MyAttendance() {
  const [mode, setMode] = useState<Mode>('month')
  const [date, setDate] = useState(toIsoDate(new Date()))
  const [month, setMonth] = useState(toIsoDate(new Date()).slice(0, 7))
  const [range, setRange] = useState({ from: toIsoDate(new Date(Date.now() - 6 * 864e5)), to: toIsoDate(new Date()) })
  const [status, setStatus] = useState('')
  const valid = mode !== 'range' || (range.from && range.to && range.from <= range.to)
  const params = mode === 'date' ? { date } : mode === 'month' ? { month } : { from: range.from, to: range.to }
  const { data, loading, error, reload } = useAsync(
    () => valid ? api.get<AttendanceDay[]>('/attendance/my', { ...params, status }) : Promise.resolve([] as AttendanceDay[]),
    [mode, date, month, range.from, range.to, status])

  return (
    <>
      <PageHeader title="Attendance" subtitle="Your attendance history" />
      <Card>
        <div className="filter-bar">
          <Tabs<Mode> value={mode} onChange={setMode} tabs={[{ value: 'date', label: 'Date' }, { value: 'month', label: 'Month' }, { value: 'range', label: 'Date Range' }]} />
          {mode === 'date' && <label className="field inline"><span>Date</span><input type="date" value={date} max={toIsoDate(new Date())} onChange={(e) => setDate(e.target.value)} /></label>}
          {mode === 'month' && <label className="field inline"><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
          {mode === 'range' && (
            <>
              <label className="field inline"><span>From</span><input type="date" value={range.from} max={range.to} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
              <label className="field inline"><span>To</span><input type="date" value={range.to} min={range.from} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
            </>
          )}
          <SelectFilter label="Status" value={status} onChange={setStatus} options={STATUSES} />
        </div>
        {!valid && <ErrorBox message="From date cannot be after To date." />}
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && (
          <DataTable rows={data} rowKey={(r) => r.date} emptyTitle="No attendance records" emptyText="Try a different date or filter." columns={[
            { header: 'Date', render: (r) => fmtDate(r.date) },
            { header: 'Check-in Time', render: (r) => fmtTime(r.check_in_time) },
            { header: 'Status', render: (r) => <StatusPill status={r.status} /> }]} />
        )}
      </Card>
    </>
  )
}

/** Team (TL) or company-wide (HR/Admin) attendance. The API restricts TLs to their own team. */
export function AttendanceOverview() {
  const { user } = useAuth()
  const { departments, employees, teamLeads } = useFilterOptions()
  const [range, setRange] = useState(initialRange('today'))
  const [department, setDepartment] = useState('')
  const [team, setTeam] = useState('')
  const [employee, setEmployee] = useState('')
  const [status, setStatus] = useState('')
  const valid = range.preset !== 'custom' || (range.from && range.to && range.from <= range.to)
  const { data, loading, error, reload } = useAsync(
    () => valid ? api.get<AttendanceRow[]>('/attendance/overview', { from: range.from, to: range.to, department, team_lead_id: team, employee_id: employee, status }) : Promise.resolve([] as AttendanceRow[]),
    [range.from, range.to, department, team, employee, status], 60_000)
  const isTl = user?.role === 'Team Lead'
  return (
    <>
      <PageHeader title={isTl ? 'Team Attendance' : 'Attendance'} subtitle={isTl ? 'Attendance of your team members' : 'Company-wide attendance'} />
      <Card>
        <div className="filter-bar">
          <RangeFilter value={range} onChange={setRange} />
          {!isTl && <SelectFilter label="Department" value={department} onChange={setDepartment} options={departments.map((d) => ({ value: d.name, label: d.name }))} />}
          {!isTl && <SelectFilter label="Team" value={team} onChange={setTeam} allLabel="All teams" options={teamLeads.map((t) => ({ value: t.employee_id, label: `${t.name}'s team` }))} />}
          <SelectFilter label="Employee" value={employee} onChange={setEmployee} options={employees.filter((e) => e.role !== 'Admin').map((e) => ({ value: e.employee_id, label: e.name }))} />
          <SelectFilter label="Status" value={status} onChange={setStatus} options={STATUSES} />
        </div>
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && (
          <DataTable rows={data} rowKey={(r) => r.employee_id + r.date} emptyTitle="No attendance records" emptyText="Try a different period or filter." columns={[
            { header: 'Date', render: (r) => fmtDate(r.date) },
            { header: 'Employee', render: (r) => <><strong>{r.employee_name}</strong><div className="muted small">{r.employee_id}</div></> },
            { header: 'Department', render: (r) => r.department },
            { header: 'Check-in Time', render: (r) => r.check_in_time || '—' },
            { header: 'Status', render: (r) => <StatusPill status={r.status} /> }]} />
        )}
      </Card>
    </>
  )
}
