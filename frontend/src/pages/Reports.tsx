import { useState } from 'react'
import Icon from '../components/Icon'
import { Card, DataTable, ErrorBox, Loading, PageHeader, RangeFilter, SelectFilter, StatusPill, Tabs } from '../components/ui'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { useFilterOptions } from '../hooks/useFilterOptions'
import { api, errorMessage } from '../services/api'
import type { Named } from '../types'
import { initialRange } from '../utils/range'

type Kind = 'weekly' | 'monthly' | 'attendance' | 'leave' | 'wfh'
interface Report { columns: string[]; rows: Record<string, string | number>[]; totals?: Record<string, string | number> | null }

const STATUS_OPTIONS: Record<Kind, string[]> = {
  weekly: [],
  monthly: [],
  attendance: ['Present', 'Leave', 'WFH', 'Not Checked In'],
  leave: ['Pending TL Approval', 'Pending HR Approval', 'Approved', 'Rejected', 'Cancelled'],
  wfh: ['Verified', 'Verification Due', 'Pending Verification', 'Missed Verification', 'Completed'],
}
const STATUS_COLUMN: Record<Kind, string> = { weekly: '', monthly: '', attendance: 'Status', leave: 'Status', wfh: 'Verification Status' }

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
/** Monday-Sunday week that contains the given date. */
function weekOf(dateStr: string): { from: string; to: string } {
  const d = new Date(`${dateStr}T00:00:00`)
  const mon = new Date(d); mon.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  const sun = new Date(mon); sun.setDate(mon.getDate() + 6)
  return { from: iso(mon), to: iso(sun) }
}
function last5Days(): { from: string; to: string } {
  const to = new Date(); const from = new Date(to); from.setDate(to.getDate() - 4)
  return { from: iso(from), to: iso(to) }
}
function monthOf(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number)
  return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) }
}

export default function Reports() {
  const toast = useToast()
  const [kind, setKind] = useState<Kind>('attendance')
  const [weekDate, setWeekDate] = useState(iso(new Date()))
  const [last5, setLast5] = useState(false)
  const [month, setMonth] = useState(iso(new Date()).slice(0, 7))
  const [range, setRange] = useState(initialRange('month'))
  const [employee, setEmployee] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('')
  const [leaveType, setLeaveType] = useState('')
  const [exporting, setExporting] = useState('')
  const { departments, employees, teamLeads } = useFilterOptions()
  const [team, setTeam] = useState('')
  const types = useAsync(() => api.get<Named[]>('/leave-types', { all: true }), [])
  const summary = kind === 'weekly' || kind === 'monthly'
  const period = kind === 'weekly' ? (last5 ? last5Days() : weekDate ? weekOf(weekDate) : { from: '', to: '' }) : kind === 'monthly' ? (month ? monthOf(month) : { from: '', to: '' }) : range
  const valid = period.from && period.to && period.from <= period.to
  const apiKind = summary ? 'summary' : kind
  const params = { from: period.from, to: period.to, employee_id: employee, department, status, leave_type: kind === 'leave' ? leaveType : '', team_lead_id: summary ? team : '' }
  const { data, loading, error, reload } = useAsync(
    () => valid ? api.get<Report>(`/reports/${apiKind}`, { ...params, format: 'json' }) : Promise.resolve(null),
    [kind, period.from, period.to, employee, department, status, leaveType, team])

  const exportAs = async (format: 'csv' | 'xlsx') => {
    setExporting(format)
    try { await api.download(`/reports/${apiKind}`, { ...params, format }, `${kind}_report.${format}`); toast.success(`${format.toUpperCase()} export downloaded`) }
    catch (e) { toast.error(errorMessage(e)) } finally { setExporting('') }
  }

  const changeKind = (k: Kind) => { setKind(k); setStatus(''); setLeaveType('') }
  return (
    <>
      <PageHeader title="Reports" subtitle="Attendance, leave and WFH reports with export" actions={
        <div className="btn-row">
          <button className="btn btn-primary" disabled={!valid || !!exporting} onClick={() => exportAs('xlsx')}><Icon name="download" size={16} /> {exporting === 'xlsx' ? 'Exporting…' : 'Export Excel'}</button>
          <button className="btn btn-soft" disabled={!valid || !!exporting} onClick={() => exportAs('csv')}><Icon name="download" size={16} /> {exporting === 'csv' ? 'Exporting…' : 'Export CSV'}</button>
        </div>} />
      <Card>
        <Tabs<Kind> value={kind} onChange={changeKind} tabs={[{ value: 'attendance', label: 'Attendance Report' }, { value: 'leave', label: 'Leave Report' }, { value: 'wfh', label: 'WFH Report' }, { value: 'weekly', label: 'Weekly Report' }, { value: 'monthly', label: 'Monthly Report' }]} />
        <div className="filter-bar">
          {kind === 'weekly' && <label className="field inline"><span>Report for</span><select value={last5 ? 'last5' : 'week'} onChange={(e) => setLast5(e.target.value === 'last5')}><option value="week">A calendar week</option><option value="last5">Last 5 days</option></select></label>}
          {kind === 'weekly' && !last5 && <label className="field inline"><span>Week containing</span><input type="date" value={weekDate} onChange={(e) => setWeekDate(e.target.value)} /></label>}
          {kind === 'monthly' && <label className="field inline"><span>Month</span><input type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>}
          {!summary && <RangeFilter value={range} onChange={setRange} />}
          <SelectFilter label="Employee" value={employee} onChange={setEmployee} options={employees.filter((e) => e.role !== 'Admin').map((e) => ({ value: e.employee_id, label: e.name }))} />
          <SelectFilter label="Department" value={department} onChange={setDepartment} options={departments.map((d) => ({ value: d.name, label: d.name }))} />
          {summary && <SelectFilter label="Team" value={team} onChange={setTeam} allLabel="All teams" options={teamLeads.map((t) => ({ value: t.employee_id, label: `${t.name}'s team` }))} />}
          {kind === 'leave' && <SelectFilter label="Leave Type" value={leaveType} onChange={setLeaveType} options={(types.data ?? []).map((t) => ({ value: t.name, label: t.name }))} />}
          {!summary && <SelectFilter label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS[kind].map((s) => ({ value: s, label: s }))} />}
        </div>
        {!valid && <ErrorBox message="Choose a valid date range (From must not be after To)." />}
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && (
          <>
            <p className="muted small">{data.rows.length} {summary ? 'employee' : 'record'}{data.rows.length === 1 ? '' : 's'}{summary ? ` · ${period.from} to ${period.to} · extra leave = leave beyond the monthly allowance (Settings)` : ''}</p>
            <DataTable rows={data.rows} rowKey={(r) => JSON.stringify(r)} emptyTitle="No records match these filters"
              columns={data.columns.map((c) => ({ header: c, render: (r: Record<string, string | number>) => c === STATUS_COLUMN[kind] && STATUS_COLUMN[kind] ? <StatusPill status={String(r[c])} /> : (r[c] === '' ? '—' : r[c]), className: typeof data.rows[0]?.[c] === 'number' ? 'num' : '' }))} />
            {data.totals && (
              <div className="totals">
                <strong>Total</strong>
                {data.columns.filter((c) => typeof data.totals?.[c] === 'number').map((c) => <span key={c}>{c.replace(' (Period)', '').replace(' (Till Today)', ' (to date)')}: <b>{data.totals?.[c]}</b></span>)}
              </div>
            )}
          </>
        )}
      </Card>
    </>
  )
}
