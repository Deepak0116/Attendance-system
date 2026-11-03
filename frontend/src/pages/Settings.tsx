import { useEffect, useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import { Card, DataTable, ErrorBox, Loading, PageHeader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { api, errorMessage } from '../services/api'
import type { Named, Setting } from '../types'

const LABELS: Record<string, string> = {
  company_name: 'Company name',
  working_days: 'Working days of the standard week (comma separated)',
  holiday_saturdays: 'Holiday Saturdays of the month (2,4 = second and fourth)',
  wfh_verification_interval_hours: 'WFH verification interval (hours)',
  wfh_missed_grace_minutes: 'Minutes before a missed verification',
  office_start_time: 'Office start time (HH:MM, 24-hour)',
  late_grace_minutes: 'Grace minutes before check-in counts as late',
  early_checkin_minutes: 'Minutes before start that count as an early check-in',
  leave_allowance_per_month: 'Leave days per month before it counts as extra leave',
  location_retention_days: 'Location data retention (days, 0 = keep forever)',
  comp_off_expiry_days: 'Comp-off credit validity (days, 0 = never expires)',
  hr_override_enabled: 'Allow HR to approve normal employee requests',
  admin_override_enabled: 'Allow Admin to approve any request',
}
const BOOLS = ['hr_override_enabled', 'admin_override_enabled']

function NameList({ title, path, items, reload, canEdit, hasActive }: { title: string; path: string; items: Named[]; reload: () => void; canEdit: boolean; hasActive?: boolean }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [editing, setEditing] = useState<Named | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    try {
      if (editing) await api.put(`${path}/${editing.id}`, { name, active: editing.active ?? true })
      else await api.post(path, { name, active: true })
      toast.success(editing ? 'Updated' : 'Added'); setName(''); setEditing(null); reload()
    } catch (err) { toast.error(errorMessage(err)) } finally { setBusy(false) }
  }
  const toggle = async (i: Named) => {
    try { await api.put(`${path}/${i.id}`, { name: i.name, active: !i.active }); reload() } catch (err) { toast.error(errorMessage(err)) }
  }
  return (
    <Card title={title}>
      <DataTable rows={items} rowKey={(i) => i.id} emptyTitle="Nothing configured yet" columns={[
        { header: 'Name', render: (i) => i.name },
        ...(hasActive ? [{ header: 'Active', render: (i: Named) => (canEdit ? <label className="switch"><input type="checkbox" checked={!!i.active} onChange={() => toggle(i)} /><span /></label> : i.active ? 'Yes' : 'No') }] : []),
        ...(canEdit ? [{ header: '', render: (i: Named) => <button className="btn btn-sm btn-soft" onClick={() => { setEditing(i); setName(i.name) }}><Icon name="edit" size={14} /> Rename</button> }] : []),
      ]} />
      {canEdit && (
        <form className="inline-form" onSubmit={save}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder={editing ? 'New name' : `Add ${title.toLowerCase().replace(/s$/, '')}`} maxLength={80} />
          <button className="btn btn-primary" disabled={busy || !name.trim()}>{editing ? 'Save' : 'Add'}</button>
          {editing && <button type="button" className="btn btn-ghost" onClick={() => { setEditing(null); setName('') }}>Cancel</button>}
        </form>
      )}
    </Card>
  )
}

const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Departments + their own working week. A department that works Sat/Sun (e.g. Support) earns comp-off on those days. */
function DepartmentList({ items, reload }: { items: Named[]; reload: () => void }) {
  const toast = useToast()
  const [name, setName] = useState('')
  const [days, setDays] = useState<string[]>([])
  const [editing, setEditing] = useState<Named | null>(null)
  const [busy, setBusy] = useState(false)
  const reset = () => { setName(''); setDays([]); setEditing(null) }
  const edit = (d: Named) => { setEditing(d); setName(d.name); setDays((d.working_days || '').split(',').filter(Boolean)) }
  const toggle = (d: string) => setDays((p) => (p.includes(d) ? p.filter((x) => x !== d) : [...p, d]))
  const save = async (e: FormEvent) => {
    e.preventDefault()
    if (!name.trim()) return
    setBusy(true)
    const body = { name, working_days: days.join(',') }
    try {
      if (editing) await api.put(`/departments/${editing.id}`, body)
      else await api.post('/departments', body)
      toast.success(editing ? 'Department updated' : 'Department added'); reset(); reload()
    } catch (err) { toast.error(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <Card title="Departments & Working Days">
      <DataTable rows={items} rowKey={(i) => i.id} emptyTitle="No departments yet" columns={[
        { header: 'Department', render: (i) => i.name },
        { header: 'Working days', render: (i) => (i.working_days ? (i.working_days.split(',').length === 7 ? '7 days (comp-off applies)' : i.working_days) : 'Company default') },
        { header: '', render: (i) => <button className="btn btn-sm btn-soft" onClick={() => edit(i)}><Icon name="edit" size={14} /> Edit</button> }]} />
      <form className="dept-form" onSubmit={save}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={editing ? 'Department name' : 'Add department'} maxLength={80} />
        <div className="day-picker" role="group" aria-label="Working days">
          {WEEK.map((d) => <button type="button" key={d} className={`day ${days.includes(d) ? 'on' : ''}`} onClick={() => toggle(d)}>{d}</button>)}
        </div>
        <p className="muted small">Leave all days unselected to use the company working days. Choose all 7 for teams such as Support - working a day outside the standard week earns 1 comp-off.</p>
        <div className="btn-row">
          <button className="btn btn-primary" disabled={busy || !name.trim()}>{editing ? 'Save' : 'Add'}</button>
          {editing && <button type="button" className="btn btn-ghost" onClick={reset}>Cancel</button>}
        </div>
      </form>
    </Card>
  )
}

const API_BASE = `${window.location.protocol}//${window.location.hostname}:8000`

/** Admin only: the read-only key Power BI uses to refresh the weekly / monthly report. */
function ReportKeyCard() {
  const toast = useToast()
  const { data, reload, error } = useAsync(() => api.get<{ key: string; from_environment: boolean }>('/report-key'), [])
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const key = data?.key ?? ''
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); toast.success(`${what} copied`) } catch { toast.error('Copy failed - select the text and copy it') }
  }
  const rotate = async () => {
    if (!window.confirm('Create a new key? The old key stops working immediately, so update Power BI with the new one.')) return
    setBusy(true)
    try { await api.post('/report-key/rotate'); await reload(); setShow(true); toast.success('New key created') }
    catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false) }
  }
  const monthly = `${API_BASE}/api/reports/summary?period=last_month&format=csv`
  const m = `let
    Source = Csv.Document(Web.Contents("${API_BASE}/api/reports/summary?period=last_month&format=csv",
        [Headers = [#"X-Report-Key" = "${show && key ? key : '<paste key>'}"]]), [Delimiter=",", Encoding=65001]),
    Promoted = Table.PromoteHeaders(Source, [PromoteAllScalars=true]),
    NoTotal = Table.SelectRows(Promoted, each [Employee] <> "TOTAL"),
    Typed = Table.TransformColumnTypes(NoTotal, {{"Working Days (Period)", Int64.Type}, {"Working Days (Till Today)", Int64.Type},
        {"Present", Int64.Type}, {"WFH", Int64.Type}, {"Leave", Int64.Type}, {"Comp Off", Int64.Type},
        {"Extra Leave", Int64.Type}, {"Not Checked In", Int64.Type}})
in
    Typed`
  return (
    <Card title="Power BI reporting key">
      {error && <ErrorBox message={error} />}
      <p className="muted small">A read-only key that lets Power BI fetch the Attendance, Leave, WFH, Weekly and Monthly reports without a login. It cannot change anything and never returns precise WFH locations. Keep it private; create a new one if it is shared by mistake.</p>
      <div className="key-row">
        <code className="key-box">{show ? key : '•'.repeat(24)}</code>
        <button className="btn btn-sm btn-ghost" onClick={() => setShow((s) => !s)}>{show ? 'Hide' : 'Show'}</button>
        <button className="btn btn-sm btn-soft" onClick={() => copy(key, 'Key')} disabled={!key}>Copy</button>
        <button className="btn btn-sm btn-danger-soft" onClick={rotate} disabled={busy || data?.from_environment}>Create new key</button>
      </div>
      <h4 className="mt">Power BI setup (Get Data → Web → Advanced)</h4>
      <ol className="steps small">
        <li>URL: <code>{monthly}</code> (use <code>last_week</code>, <code>this_week</code> or <code>this_month</code> for other periods; <code>kind</code> can be <code>summary</code>, <code>attendance</code>, <code>leave</code> or <code>wfh</code>).</li>
        <li>Add an HTTP request header named <code>X-Report-Key</code> and paste the key as its value.</li>
        <li>Or open Advanced Editor in Power Query and use the code below.</li>
      </ol>
      <div className="key-row"><pre className="code-box">{m}</pre><button className="btn btn-sm btn-soft" onClick={() => copy(m, 'Power Query code')}>Copy code</button></div>
      <p className="muted small">Scheduled refresh in Power BI Service needs the on-premises data gateway on the computer that runs this app, because the app address is local.</p>
    </Card>
  )
}

export default function Settings() {
  const { user } = useAuth()
  const toast = useToast()
  const isAdmin = user?.role === 'Admin'
  const settings = useAsync(() => api.get<Setting[]>('/settings'), [])
  const leaveTypes = useAsync(() => api.get<Named[]>('/leave-types', { all: true }), [])
  const departments = useAsync(() => api.get<Named[]>('/departments'), [])
  const [form, setForm] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { if (settings.data) setForm(Object.fromEntries(settings.data.map((s) => [s.key, s.value]))) }, [settings.data])

  const save = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('')
    try { await api.put('/settings', { settings: form }); toast.success('Settings saved'); await settings.reload() }
    catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <>
      <PageHeader title="Settings" subtitle={isAdmin ? 'Configure the system' : 'View system configuration and manage leave types'} />
      <div className="stack-lg">
        <Card title="System Settings">
          {settings.loading && !settings.data && <Loading />}
          {settings.error && <ErrorBox message={settings.error} onRetry={settings.reload} />}
          {settings.data && (
            <form className="form-grid" onSubmit={save} noValidate>
              {settings.data.map((s) => (
                <label key={s.key} className={`field ${BOOLS.includes(s.key) ? '' : ''}`}>
                  <span>{LABELS[s.key] ?? s.key}</span>
                  {BOOLS.includes(s.key) ? (
                    <select disabled={!isAdmin} value={form[s.key] ?? ''} onChange={(e) => setForm({ ...form, [s.key]: e.target.value })}><option value="true">Enabled</option><option value="false">Disabled</option></select>
                  ) : (
                    <input disabled={!isAdmin} value={form[s.key] ?? ''} onChange={(e) => setForm({ ...form, [s.key]: e.target.value })} />
                  )}
                  <small className="muted">{s.description}</small>
                </label>
              ))}
              {error && <div className="full"><ErrorBox message={error} /></div>}
              {isAdmin && <div className="full"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save Settings'}</button></div>}
            </form>
          )}
          <div className="info-note mt"><Icon name="shield" size={20} /><div><strong>Location privacy</strong><span>Location is captured only when an employee starts WFH or presses Verify. Coordinates older than the retention period are erased automatically; only HR and Admin can see precise coordinates.</span></div></div>
        </Card>
        {isAdmin && <ReportKeyCard />}
        <div className="two-col">
          <NameList title="Leave Types" path="/leave-types" items={leaveTypes.data ?? []} reload={leaveTypes.reload} canEdit hasActive />
          <DepartmentList items={departments.data ?? []} reload={departments.reload} />
        </div>
      </div>
    </>
  )
}
