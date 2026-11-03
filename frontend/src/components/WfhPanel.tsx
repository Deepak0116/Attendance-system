import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useToast } from '../context/ToastContext'
import { useWfh } from '../context/WfhContext'
import { useNow } from '../hooks/useAsync'
import { errorMessage } from '../services/api'
import { fmtDate, fmtLongDate, fmtTime } from '../utils/format'
import type { Coords } from '../utils/geo'
import { BigCheck, MapIllustration } from './Illustrations'
import Icon from './Icon'
import { ConfirmDialog, ErrorBox, Loading, Modal, StatusPill } from './ui'

function countdown(target: string, nowMs: number): string {
  const ms = new Date(target).getTime() - nowMs
  if (ms <= 0) return 'now'
  const m = Math.floor(ms / 60000)
  return `${Math.floor(m / 60)}h ${m % 60}m`
}

type Mode = 'start' | 'verify'

/** Consent screen shown BEFORE the browser prompt, so the employee knows exactly why location is requested. */
function ConsentModal({ mode, busy, error, onConfirm, onClose }: { mode: Mode; busy: boolean; error: string; onConfirm: () => void; onClose: () => void }) {
  return (
    <Modal open title="Verify Your Location" onClose={onClose} narrow footer={
      <>
        <button className="btn btn-ghost" onClick={onClose} disabled={busy}>Cancel</button>
        <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
          <Icon name="pin" size={16} /> {busy ? 'Waiting for location…' : mode === 'start' ? 'Share Location & Start WFH' : 'Share Location & Verify'}
        </button>
      </>
    }>
      <p>Your location will be checked to verify your WFH attendance.</p>
      <ul className="privacy-list">
        <li>Your browser will ask for permission - choose <strong>Allow</strong>.</li>
        <li>Location is captured <strong>only now</strong>, when you confirm. It is never tracked in the background.</li>
        <li>Precise coordinates are visible only to HR and Admin.</li>
      </ul>
      {error && <ErrorBox message={error} />}
    </Modal>
  )
}

export default function WfhPanel({ showBack = false }: { showBack?: boolean }) {
  const { wfh, loading, error, start, verify, end, refresh } = useWfh()
  const toast = useToast()
  const navigate = useNavigate()
  const now = useNow(15_000)
  const [mode, setMode] = useState<Mode | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')
  const [started, setStarted] = useState<Coords | null>(null)
  const [confirmEnd, setConfirmEnd] = useState(false)
  const [notifPerm, setNotifPerm] = useState<string>('Notification' in window ? Notification.permission : 'unsupported')

  if (loading && !wfh) return <Loading />
  if (error && !wfh) return <ErrorBox message={error} onRetry={refresh} />
  if (!wfh) return null

  const run = async () => {
    setBusy(true); setActionError('')
    try {
      if (mode === 'start') setStarted(await start())
      else { await verify(); toast.success('Location verified') }
      setMode(null)
    } catch (e) {
      setActionError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  const endWfh = async () => {
    setBusy(true)
    try { await end(); toast.success('WFH completed for today'); setConfirmEnd(false) }
    catch (e) { toast.error(errorMessage(e)); setConfirmEnd(false) }
    finally { setBusy(false) }
  }

  const askNotifications = async () => {
    if ('Notification' in window) setNotifPerm(await Notification.requestPermission())
  }

  const consent = mode && <ConsentModal mode={mode} busy={busy} error={actionError} onConfirm={run} onClose={() => { setMode(null); setActionError('') }} />

  if (started && wfh.started) {
    return (
      <section className="card success-card">
        <BigCheck />
        <h2>WFH Started Successfully!</h2>
        <p>Your location has been verified.</p>
        <dl className="info-grid tight">
          <dt>Location Verified</dt><dd>: <Icon name="check" size={14} /></dd>
          <dt>Start Time</dt><dd>: {fmtTime(wfh.start_time)}</dd>
          <dt>Next Verification</dt><dd>: {fmtTime(wfh.next_verification)}</dd>
        </dl>
        <button className="btn btn-primary" onClick={() => { setStarted(null); if (showBack) navigate('/dashboard') }}>
          {showBack ? 'Back to Dashboard' : 'Continue'}
        </button>
      </section>
    )
  }

  if (!wfh.approved) {
    return (
      <section className="card">
        <div className="info-note"><Icon name="home" size={22} /><div><strong>No approved WFH for today.</strong><span>Submit a WFH request below. Once your approver approves it, START WFH appears here on that day.</span></div></div>
      </section>
    )
  }

  if (!wfh.started) {
    return (
      <section className="card hero wfh-hero">
        <div className="hero-text">
          <h1>Work From Home</h1>
          <p className="hero-sub">Your WFH request is approved for today.</p>
          <dl className="info-box">
            <div><Icon name="calendar" size={16} /> <span>Date</span><b>: {fmtLongDate(now).split(', ').slice(1).join(', ') || fmtDate(wfh.date)}</b></div>
            <div><Icon name="clock" size={16} /> <span>Time</span><b>: {now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</b></div>
          </dl>
          <h3 className="pin-title"><Icon name="pin" size={18} /> Verify Your Location</h3>
          <p>Click below to share your current location for WFH tracking.</p>
          <button className="btn btn-primary btn-lg" onClick={() => { setActionError(''); setMode('start') }}><Icon name="pin" size={18} /> Start WFH</button>
        </div>
        <MapIllustration />
        {consent}
      </section>
    )
  }

  const next = wfh.next_verification
  return (
    <>
      <section className="card hero wfh-hero">
        <div className="hero-text">
          <div className="inline-head"><h1>Work From Home</h1><StatusPill status={wfh.ended ? 'Completed' : wfh.status} /></div>
          <dl className="info-grid tight">
            <dt>Started at</dt><dd>: {fmtTime(wfh.start_time)}</dd>
            <dt>Last verification</dt><dd>: {fmtTime(wfh.last_verification)}</dd>
            {!wfh.ended && <><dt>Next verification</dt><dd>: {fmtTime(next)} <span className="muted small">(in {countdown(next, now.getTime() + (wfh ? new Date(wfh.server_now).getTime() - Date.now() : 0))})</span></dd></>}
            <dt>Verifications</dt><dd>: {wfh.count}</dd>
          </dl>
          {wfh.ended ? (
            <div className="info-note"><Icon name="checkCircle" size={22} /><div><strong>Your WFH day is complete.</strong><span>Thank you!</span></div></div>
          ) : (
            <>
              <h3 className="pin-title"><Icon name="pin" size={18} /> Verify Your Location</h3>
              <p>Click below to confirm you are still working from home.</p>
              <div className="btn-row">
                <button className="btn btn-primary btn-lg" onClick={() => { setActionError(''); setMode('verify') }}><Icon name="pin" size={18} /> Check Location</button>
                <button className="btn btn-ghost btn-lg" onClick={() => setConfirmEnd(true)}>End WFH</button>
              </div>
              {notifPerm === 'default' && (
                <p className="muted small">Want a browser pop-up when verification is due? <button className="link" onClick={askNotifications}>Enable browser notifications</button></p>
              )}
            </>
          )}
        </div>
        <MapIllustration />
        {consent}
      </section>
      <ConfirmDialog open={confirmEnd} title="End WFH for today?" message="This marks your WFH day as completed. You will no longer receive verification reminders today." confirmLabel="End WFH" busy={busy} onConfirm={endWfh} onCancel={() => setConfirmEnd(false)} />
    </>
  )
}
