import { Fragment, useState, type FormEvent } from 'react'
import { Card, ErrorBox, PageHeader } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { api, errorMessage } from '../services/api'
import { fmtDate, initials } from '../utils/format'

export default function Profile() {
  const { user } = useAuth()
  const toast = useToast()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (!user) return null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (next.length < 8) { setError('New password must be at least 8 characters.'); return }
    if (next !== confirm) { setError('New password and confirmation do not match.'); return }
    setBusy(true); setError('')
    try {
      await api.post('/auth/change-password', { current_password: current, new_password: next })
      toast.success('Password updated')
      setCurrent(''); setNext(''); setConfirm('')
    } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  const rows: [string, string][] = [
    ['Employee ID', user.employee_id], ['Email', user.email], ['Phone', user.phone || '—'], ['Department', user.department],
    ['Designation', user.designation || '—'], ['Role', user.role], ['Team Lead', user.team_lead_name || '—'], ['Joining Date', fmtDate(user.joining_date)],
  ]
  return (
    <>
      <PageHeader title="Profile" subtitle="Your account details" />
      <div className="two-col">
        <Card>
          <div className="profile-head"><div className="avatar xl">{initials(user.name)}</div><div><h2>{user.name}</h2><span className="muted">@{user.username}</span></div></div>
          <dl className="info-grid profile">{rows.map(([k, v]) => <Fragment key={k}><dt>{k}</dt><dd>{v}</dd></Fragment>)}</dl>
          <p className="muted small">Profile details are managed by the Admin.</p>
        </Card>
        <Card title="Change Password">
          <form className="form-grid single" onSubmit={submit} noValidate>
            <label className="field"><span>Current password</span><input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" /></label>
            <label className="field"><span>New password</span><input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" /></label>
            <label className="field"><span>Confirm new password</span><input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" /></label>
            {error && <ErrorBox message={error} />}
            <div><button className="btn btn-primary" disabled={busy || !current}>{busy ? 'Saving…' : 'Update Password'}</button></div>
          </form>
        </Card>
      </div>
    </>
  )
}
