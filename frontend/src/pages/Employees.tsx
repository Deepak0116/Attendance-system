import { useState, type FormEvent } from 'react'
import Icon from '../components/Icon'
import { Card, ConfirmDialog, DataTable, ErrorBox, Loading, Modal, PageHeader, SelectFilter, StatusPill } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import { api, errorMessage } from '../services/api'
import type { Employee, Named, Role } from '../types'
import { fmtDate } from '../utils/format'

const ROLES: Role[] = ['Employee', 'Team Lead', 'HR', 'Admin']

interface FormState {
  name: string; email: string; phone: string; department: string; designation: string; role: Role
  team_lead_id: string; joining_date: string; username: string; password: string
}
const blank: FormState = { name: '', email: '', phone: '', department: '', designation: '', role: 'Employee', team_lead_id: '', joining_date: new Date().toISOString().slice(0, 10), username: '', password: '' }

function EmployeeForm({ editing, departments, teamLeads, onClose, onSaved }: {
  editing: Employee | null; departments: Named[]; teamLeads: Employee[]; onClose: () => void; onSaved: () => void
}) {
  const toast = useToast()
  const [f, setF] = useState<FormState>(editing ? {
    name: editing.name, email: editing.email, phone: editing.phone, department: editing.department, designation: editing.designation,
    role: editing.role, team_lead_id: editing.team_lead_id, joining_date: editing.joining_date, username: editing.username, password: '' } : blank)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((p) => ({ ...p, [k]: v }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (f.name.trim().length < 2) return setError('Enter the employee name.')
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(f.email)) return setError('Enter a valid email address.')
    if (!f.department) return setError('Select a department.')
    if (f.role === 'Employee' && !f.team_lead_id) return setError('Every employee must be assigned to a Team Lead.')
    if (!editing && f.password.length < 8) return setError('Initial password must be at least 8 characters.')
    if (editing && f.password && f.password.length < 8) return setError('New password must be at least 8 characters.')
    setBusy(true); setError('')
    try {
      const body = { ...f, team_lead_id: f.role === 'Employee' ? f.team_lead_id : '' }
      if (editing) await api.put(`/employees/${editing.employee_id}`, body)
      else await api.post('/employees', body)
      toast.success(editing ? 'Employee updated' : 'Employee created')
      onSaved()
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <Modal open title={editing ? `Edit ${editing.name}` : 'Add Employee'} onClose={onClose}>
      <form className="form-grid" onSubmit={submit} noValidate>
        <label className="field"><span>Name <em className="req">*</em></span><input value={f.name} onChange={(e) => set('name', e.target.value)} /></label>
        <label className="field"><span>Email <em className="req">*</em></span><input type="email" value={f.email} onChange={(e) => set('email', e.target.value)} /></label>
        <label className="field"><span>Phone</span><input value={f.phone} onChange={(e) => set('phone', e.target.value)} /></label>
        <label className="field"><span>Designation</span><input value={f.designation} onChange={(e) => set('designation', e.target.value)} /></label>
        <label className="field"><span>Department <em className="req">*</em></span>
          <select value={f.department} onChange={(e) => set('department', e.target.value)}><option value="">Select</option>{departments.map((d) => <option key={d.id}>{d.name}</option>)}</select>
        </label>
        <label className="field"><span>Role <em className="req">*</em></span>
          <select value={f.role} onChange={(e) => set('role', e.target.value as Role)}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
        </label>
        {f.role === 'Employee' && (
          <label className="field"><span>Team Lead <em className="req">*</em></span>
            <select value={f.team_lead_id} onChange={(e) => set('team_lead_id', e.target.value)}>
              <option value="">Select Team Lead</option>{teamLeads.map((t) => <option key={t.employee_id} value={t.employee_id}>{t.name} ({t.employee_id})</option>)}
            </select>
          </label>
        )}
        <label className="field"><span>Joining Date</span><input type="date" value={f.joining_date} onChange={(e) => set('joining_date', e.target.value)} /></label>
        {!editing && <label className="field"><span>Username</span><input value={f.username} onChange={(e) => set('username', e.target.value)} placeholder="defaults to email prefix" /></label>}
        <label className="field"><span>{editing ? 'Reset password' : 'Initial password'} {!editing && <em className="req">*</em>}</span>
          <input type="password" value={f.password} onChange={(e) => set('password', e.target.value)} placeholder={editing ? 'leave blank to keep current' : 'min 8 characters'} autoComplete="new-password" />
        </label>
        {error && <div className="full"><ErrorBox message={error} /></div>}
        <div className="full btn-row">
          <button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : editing ? 'Save Changes' : 'Create Employee'}</button>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </form>
    </Modal>
  )
}

export default function Employees({ teamView = false }: { teamView?: boolean }) {
  const { user } = useAuth()
  const toast = useToast()
  const isAdmin = user?.role === 'Admin'
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [status, setStatus] = useState('active')
  const [form, setForm] = useState<{ editing: Employee | null } | null>(null)
  const [toggle, setToggle] = useState<Employee | null>(null)
  const [busy, setBusy] = useState(false)
  const deps = useAsync(() => api.get<Named[]>('/departments'), [])
  const tls = useAsync(() => (user?.role === 'HR' || isAdmin) ? api.get<Employee[]>('/employees/team-leads') : Promise.resolve([] as Employee[]), [user?.role])
  const { data, loading, error, reload } = useAsync(() => api.get<Employee[]>('/employees', { search, department, status }), [search, department, status])

  const doToggle = async () => {
    if (!toggle) return
    setBusy(true)
    try {
      await api.post(`/employees/${toggle.employee_id}/status`, { active: toggle.status !== 'Active' })
      toast.success(`${toggle.name} ${toggle.status === 'Active' ? 'deactivated' : 'activated'}`)
      await reload(); await tls.reload()
    } catch (e) { toast.error(errorMessage(e)) } finally { setBusy(false); setToggle(null) }
  }

  return (
    <>
      <PageHeader title={teamView ? 'My Team' : 'Employees'} subtitle={teamView ? 'Members assigned to you' : isAdmin ? 'Create, edit and manage employees' : 'All employees'}
        actions={isAdmin && <button className="btn btn-primary" onClick={() => setForm({ editing: null })}><Icon name="plus" size={16} /> Add Employee</button>} />
      <Card>
        <div className="filter-bar">
          <label className="field inline grow"><span>Search</span><input placeholder="Name, ID or email" value={search} onChange={(e) => setSearch(e.target.value)} /></label>
          {!teamView && <SelectFilter label="Department" value={department} onChange={setDepartment} options={(deps.data ?? []).map((d) => ({ value: d.name, label: d.name }))} />}
          <label className="field inline"><span>Status</span>
            <select value={status} onChange={(e) => setStatus(e.target.value)}><option value="active">Active</option><option value="inactive">Inactive</option><option value="all">All</option></select>
          </label>
        </div>
        {loading && !data && <Loading />}
        {error && <ErrorBox message={error} onRetry={reload} />}
        {data && (
          <DataTable rows={data} rowKey={(e) => e.employee_id} emptyTitle="No employees found" emptyText="Adjust the search or filters." columns={[
            { header: 'Employee', render: (e) => <><strong>{e.name}</strong><div className="muted small">{e.employee_id} · {e.email}</div></> },
            { header: 'Department', render: (e) => e.department },
            { header: 'Designation', render: (e) => e.designation || '—' },
            { header: 'Role', render: (e) => e.role },
            { header: 'Team Lead', render: (e) => e.team_lead_name || '—' },
            { header: 'Joined', render: (e) => fmtDate(e.joining_date) },
            { header: 'Status', render: (e) => <StatusPill status={e.status} /> },
            ...(isAdmin ? [{
              header: 'Actions', render: (e: Employee) => (
                <div className="btn-row nowrap">
                  <button className="btn btn-sm btn-soft" onClick={() => setForm({ editing: e })}><Icon name="edit" size={14} /> Edit</button>
                  <button className={`btn btn-sm ${e.status === 'Active' ? 'btn-danger-soft' : 'btn-success'}`} disabled={e.employee_id === user?.employee_id} onClick={() => setToggle(e)}>
                    {e.status === 'Active' ? 'Deactivate' : 'Activate'}
                  </button>
                </div>),
            }] : []),
          ]} />
        )}
      </Card>
      {form && <EmployeeForm editing={form.editing} departments={deps.data ?? []} teamLeads={tls.data ?? []} onClose={() => setForm(null)} onSaved={() => { setForm(null); void reload(); void tls.reload() }} />}
      <ConfirmDialog open={!!toggle} busy={busy} danger={toggle?.status === 'Active'} title={toggle?.status === 'Active' ? 'Deactivate employee' : 'Activate employee'}
        message={toggle && (toggle.status === 'Active' ? `${toggle.name} will no longer be able to sign in.` : `${toggle.name} will be able to sign in again.`)}
        confirmLabel={toggle?.status === 'Active' ? 'Deactivate' : 'Activate'} onConfirm={doToggle} onCancel={() => setToggle(null)} />
    </>
  )
}
