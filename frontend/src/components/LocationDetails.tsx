import { api } from '../services/api'
import { useAsync } from '../hooks/useAsync'
import { fmtDate, fmtTime } from '../utils/format'
import type { WfhSession } from '../types'
import { ErrorBox, Loading, Modal, StatusPill } from './ui'

interface Verification {
  id: string
  type: string
  time: string
  location_status: string
  next_verification: string
  latitude?: string
  longitude?: string
}

function osmEmbed(lat: number, lon: number): string {
  const d = 0.01
  return `https://www.openstreetmap.org/export/embed.html?bbox=${lon - d},${lat - d},${lon + d},${lat + d}&layer=mapnik&marker=${lat},${lon}`
}

/** Per-employee verification history. Coordinates + map are only returned by the API for HR/Admin. */
export default function LocationDetails({ session, onClose }: { session: WfhSession | null; onClose: () => void }) {
  const { data, loading, error } = useAsync(
    () => session ? api.get<Verification[]>('/wfh/verifications', { employee_id: session.employee_id, date: session.date }) : Promise.resolve([]),
    [session?.employee_id, session?.date],
  )
  const withCoords = (data ?? []).filter((v) => v.latitude && v.longitude)
  const last = withCoords[withCoords.length - 1]
  return (
    <Modal open={!!session} onClose={onClose} title={session ? `Location Details – ${session.employee_name}` : ''}>
      {loading && <Loading />}
      {error && <ErrorBox message={error} />}
      {session && !loading && !error && (
        <div className="loc-grid">
          {last ? (
            <div className="map-box">
              <iframe title="Last verified location" src={osmEmbed(Number(last.latitude), Number(last.longitude))} loading="lazy" referrerPolicy="no-referrer" />
              <div className="map-caption">Lat: {last.latitude}, Long: {last.longitude}</div>
            </div>
          ) : (
            <div className="map-box empty muted">No precise location is stored for this session (not shared with your role, not captured, or purged by the retention policy).</div>
          )}
          <div>
            <dl className="info-grid tight">
              <dt>Date</dt><dd>: {fmtDate(session.date)}</dd>
              <dt>Start Time</dt><dd>: {fmtTime(session.start_time)}</dd>
              <dt>Last Verified</dt><dd>: {fmtTime(session.last_verification)}</dd>
              <dt>Next Due</dt><dd>: {fmtTime(session.next_verification)}</dd>
              <dt>Status</dt><dd>: <StatusPill status={session.status} /></dd>
            </dl>
            <h4>Verification history</h4>
            <ul className="timeline">
              {(data ?? []).map((v) => (
                <li key={v.id}>
                  <strong>{v.type === 'Start' ? 'WFH started' : v.type === 'End' ? 'WFH completed' : 'Location verified'}</strong>
                  <span>{fmtTime(v.time)}{v.latitude ? ` · ${v.latitude}, ${v.longitude}` : ''}</span>
                </li>
              ))}
              {!data?.length && <li className="muted">No verifications yet.</li>}
            </ul>
          </div>
        </div>
      )}
    </Modal>
  )
}
