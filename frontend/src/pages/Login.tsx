import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { Logo, WelcomeIllustration } from '../components/Illustrations'
import { ErrorBox } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { errorMessage } from '../services/api'

export default function Login() {
  const { user, login, notice } = useAuth()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (user) return <Navigate to="/dashboard" replace />

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) { setError('Enter your username and password.'); return }
    setBusy(true); setError('')
    try { await login(username.trim(), password) } catch (err) { setError(errorMessage(err)) } finally { setBusy(false) }
  }

  return (
    <div className="login-page">
      <div className="login-side">
        <div className="brand"><Logo width={210} /></div>
        <span className="login-tag">Attendance · Leave · WFH</span>
        <h1>Smart Attendance.<br />Flexible Work.<br /><em>Complete Visibility.</em></h1>
        <ul className="feature-list">
          <li>Track WFH location</li><li>4-hour auto reminder</li><li>Real-time dashboard</li><li>Secure &amp; reliable</li>
        </ul>
        <WelcomeIllustration />
      </div>
      <form className="login-card card" onSubmit={submit} noValidate>
        <h2>Sign in</h2>
        <p className="muted">Employee Attendance, Leave &amp; WFH Management</p>
        {notice && <div className="alert alert-info">{notice}</div>}
        {error && <ErrorBox message={error} />}
        <label className="field"><span>Username</span>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" />
        </label>
        <button className="btn btn-primary btn-lg block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  )
}
