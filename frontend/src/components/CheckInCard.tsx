import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { useAsync, useNow } from '../hooks/useAsync'
import { api, errorMessage } from '../services/api'
import type { TodayState } from '../types'
import { fmtLongDate, fmtTime, greeting } from '../utils/format'
import { checkInMessage, dailyMessage, type Punctuality } from '../utils/messages'
import { BigCheck, WelcomeIllustration } from './Illustrations'
import Icon from './Icon'
import { ErrorBox, Loading } from './ui'

interface CheckInResult { message: string; status: string; check_in_time: string; punctuality: Punctuality | '' }

export default function CheckInCard({ onChanged }: { onChanged?: () => void }) {
  const { user } = useAuth()
  const toast = useToast()
  const now = useNow()
  const { data: today, loading, error, reload } = useAsync(() => api.get<TodayState>('/attendance/today'), [], 60_000)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<CheckInResult | null>(null)
  const [actionError, setActionError] = useState('')
  if (!user) return null

  const checkIn = async () => {
    setBusy(true); setActionError('')
    try {
      setResult(await api.post<CheckInResult>('/attendance/check-in'))
      toast.success('Check-in recorded')
      await reload()
      onChanged?.()
    } catch (e) {
      setActionError(errorMessage(e))
      await reload()
    } finally {
      setBusy(false)
    }
  }

  const firstName = user.name.split(' ')[0]
  let body
  if (loading && !today) body = <Loading />
  else if (error && !today) body = <ErrorBox message={error} onRetry={reload} />
  else if (result) {
    body = (
      <div className="success-box">
        <BigCheck />
        <div>
          <h2>Check-In Successful!</h2>
          <p>Status: <strong>{result.status}</strong></p>
          <p>Check-In Time: <strong>{fmtTime(result.check_in_time)}</strong></p>
          {result.punctuality && <p className={`punct punct-${result.punctuality}`}>{checkInMessage(result.punctuality, user.employee_id + result.check_in_time.slice(0, 10))}</p>}
          {today?.comp_off_earned && <p className="comp-note">+1 Comp Off earned for working on your weekly off day</p>}
        </div>
      </div>
    )
  } else if (today?.checked_in) {
    body = (
      <div className="info-note">
        <Icon name="checkCircle" size={22} />
        <div>
          <strong>You have already checked in today.</strong>
          <span>{today.status === 'WFH' ? 'Work From Home' : 'Check-in'} Time: {fmtTime(today.check_in_time)}</span>
          {today.punctuality && today.status !== 'WFH' && <span className={`punct punct-${today.punctuality}`}>{checkInMessage(today.punctuality, user.employee_id + today.date)}</span>}
          {today.comp_off_earned && <span className="comp-note">+1 Comp Off earned for working on your weekly off day</span>}
        </div>
      </div>
    )
  } else if (today?.on_leave) {
    body = <div className="info-note"><Icon name="leave" size={22} /><div><strong>You are on approved leave today.</strong><span>Enjoy your time off!</span></div></div>
  } else if (today?.wfh_approved) {
    body = (
      <div className="info-note">
        <Icon name="home" size={22} />
        <div><strong>Your WFH is approved for today.</strong><span><Link to="/wfh">Go to WFH to start your day</Link></span></div>
      </div>
    )
  } else if (today && !today.working_day) {
    body = <div className="info-note"><Icon name="calendar" size={22} /><div><strong>Today is not a working day.</strong><span>No check-in is required.</span></div></div>
  } else {
    body = (
      <>
        <button className="btn btn-success btn-lg" onClick={checkIn} disabled={busy}>
          <Icon name="checkCircle" size={20} /> {busy ? 'Checking in…' : 'Check In Now'}
        </button>
        {actionError && <ErrorBox message={actionError} />}
      </>
    )
  }

  return (
    <section className="card hero">
      <div className="hero-text">
        <h1>{greeting(now)}, {firstName}!</h1>
        <p className="hero-sub"><span className="daily-label">Thought for today</span>{dailyMessage(now)}</p>
        <dl className="info-grid">
          <dt>Employee ID</dt><dd>: {user.employee_id}</dd>
          <dt>Department</dt><dd>: {user.department || '—'}</dd>
        </dl>
        {body}
        <div className="hero-date"><Icon name="calendar" size={16} /> {fmtLongDate(now)} • {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
      </div>
      <WelcomeIllustration />
    </section>
  )
}
