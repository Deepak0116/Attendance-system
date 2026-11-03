import { useEffect, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Logo } from '../components/Illustrations'
import Icon from '../components/Icon'
import { ErrorBox, Loading } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useAsync, useNow } from '../hooks/useAsync'
import { api, errorMessage } from '../services/api'
import type { TodayState } from '../types'
import { fmtTime, greeting } from '../utils/format'
import { checkInMessage, dailyMessage, type Punctuality } from '../utils/messages'
import '../welcome.css'

interface CheckInResult { check_in_time: string; punctuality: Punctuality | '' }

function CompactLogin() {
  const { login } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Enter your username and password.'); return }
    setBusy(true); setError('')
    try { await login(username.trim(), password, true) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }
  return (
    <form className="wl-body wl-center" onSubmit={submit} noValidate>
      <p className="wl-sub">Sign in once. This window will remember you.</p>
      {error && <ErrorBox message={error} />}
      <label className="field"><span>Username</span><input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus /></label>
      <label className="field"><span>Password</span><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" /></label>
      <button className="btn btn-primary block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  )
}

function closeWindow() {
  try { window.close() } catch { /* not allowed for this window */ }
}

/** Start-up window: a greeting, your name and a Check In button. Nothing else. */
function WelcomePopup() {
  const { user } = useAuth()
  const now = useNow(30_000)
  const { data: today, loading, error, reload } = useAsync(() => api.get<TodayState>('/attendance/today'), [])
  const [result, setResult] = useState<CheckInResult | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  const nothingToDo = !!today && !today.checked_in && !result && (today.on_leave || !today.working_day) && !today.wfh_approved
  const done = !!result // just checked in: close by itself after a few seconds
  useEffect(() => {
    if (!nothingToDo && !done) return
    const t = setTimeout(closeWindow, done ? 6000 : 8000)
    return () => clearTimeout(t)
  }, [nothingToDo, done])

  if (!user) return null
  const checkIn = async () => {
    setBusy(true); setActionError('')
    try { setResult(await api.post<CheckInResult>('/attendance/check-in')); await reload() }
    catch (e) { setActionError(errorMessage(e)); await reload() }
    finally { setBusy(false) }
  }

  const firstName = user.name.split(' ')[0]
  const checkedAt = result?.check_in_time || today?.check_in_time || ''
  const kind = result?.punctuality || (today?.checked_in ? today.punctuality : '') || ''
  const seed = user.employee_id + (today?.date ?? '')

  let body
  if (loading && !today) body = <Loading />
  else if (error && !today) body = <ErrorBox message={error} onRetry={reload} />
  else if (result || today?.checked_in) {
    body = (
      <>
        <p className="wl-ok"><Icon name="checkCircle" size={18} /> Checked in at {fmtTime(checkedAt)}</p>
        {kind && today?.status !== 'WFH' && <p className="wl-say">{checkInMessage(kind, seed)}</p>}
      </>
    )
  } else if (today?.on_leave) body = <p className="wl-say">You are on leave today. Enjoy your time off.</p>
  else if (today?.wfh_approved) {
    body = (
      <>
        <p className="wl-say">Your work from home is approved today.</p>
        <Link className="btn btn-primary wl-btn" to="/dashboard">Start WFH</Link>
      </>
    )
  } else if (today && !today.working_day) body = <p className="wl-say">Today is a holiday. Enjoy your day.</p>
  else {
    body = (
      <>
        {actionError && <ErrorBox message={actionError} />}
        <button className="btn btn-success btn-lg wl-btn" onClick={checkIn} disabled={busy}>
          <Icon name="checkCircle" size={20} /> {busy ? 'Checking in…' : 'Check In'}
        </button>
      </>
    )
  }

  return (
    <div className="wl-body wl-center">
      <p className="wl-title">{greeting(now)}, {firstName}!</p>
      {!(result || today?.checked_in) && (
        <>
          <span className="daily-label">Thought for today</span>
          <p className="wl-words">{dailyMessage(now)}</p>
        </>
      )}
      {body}
    </div>
  )
}

export default function Welcome() {
  const { user, loading } = useAuth()
  return (
    <div className="wl-page">
      <div className="wl-card">
        <div className="wl-top"><Logo width={84} /></div>
        {loading ? <Loading /> : user ? <WelcomePopup /> : <CompactLogin />}
      </div>
    </div>
  )
}
