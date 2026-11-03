import { useEffect, useRef, useState } from 'react'
import { useWfh, SNOOZE_MINUTES } from '../context/WfhContext'
import { useToast } from '../context/ToastContext'
import { errorMessage } from '../services/api'
import { fmtTime } from '../utils/format'
import { ErrorBox, Modal } from './ui'
import Icon from './Icon'

/**
 * In-app "WFH Verification Required" reminder. It only shows while the app is open, and the location
 * is read only when the employee presses VERIFY LOCATION.
 */
export default function WfhReminder() {
  const { wfh, due, snoozedUntil, verify, snooze } = useWfh()
  const toast = useToast()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [now, setNow] = useState(Date.now())
  const notified = useRef('')

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10_000)
    return () => clearInterval(t)
  }, [])

  const open = due && now >= snoozedUntil

  // Optional browser notification (only if the user already granted permission).
  useEffect(() => {
    if (!open || !wfh) return
    const key = wfh.next_verification
    if (notified.current === key) return
    notified.current = key
    if ('Notification' in window && Notification.permission === 'granted') {
      try { new Notification('WFH Verification Required!', { body: 'Please verify your location again.' }) } catch { /* unsupported */ }
    }
  }, [open, wfh])

  if (!open || !wfh) return null

  const onVerify = async () => {
    setBusy(true); setError('')
    try {
      await verify()
      toast.success('Location verified. Next verification scheduled.')
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="" onClose={() => { setError(''); snooze() }} narrow>
      <div className="center reminder">
        <div className="reminder-icon"><Icon name="hourglass" size={34} /></div>
        <h2>WFH Verification Required!</h2>
        <p>Please verify your location again. It was due at <strong>{fmtTime(wfh.next_verification)}</strong>.</p>
        <p className="muted small">Your browser will ask for location permission. Your location is only read when you press Verify.</p>
        {error && <ErrorBox message={error} />}
        <div className="btn-row center">
          <button className="btn btn-primary" onClick={onVerify} disabled={busy}>
            <Icon name="pin" size={16} /> {busy ? 'Verifying…' : 'Verify Location'}
          </button>
          <button className="btn btn-soft" onClick={() => { setError(''); snooze() }} disabled={busy}>Remind Me Later</button>
        </div>
        <p className="muted small">“Remind me later” asks again in {SNOOZE_MINUTES} minutes.</p>
      </div>
    </Modal>
  )
}
