import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { api, errorMessage } from '../services/api'
import { getCurrentPosition, type Coords } from '../utils/geo'
import type { WfhToday } from '../types'
import { useAuth } from './AuthContext'

const POLL_MS = 30_000
export const SNOOZE_MINUTES = 15

interface WfhState {
  wfh: WfhToday | null
  loading: boolean
  error: string
  /** True when a verification is due (server status or the local clock has passed the due time). */
  due: boolean
  snoozedUntil: number
  refresh: () => Promise<void>
  start: () => Promise<Coords>
  verify: () => Promise<Coords>
  end: () => Promise<void>
  snooze: () => void
  serverNow: () => number
}

const Ctx = createContext<WfhState | null>(null)

export function WfhProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const enabled = user?.role === 'Employee' || user?.role === 'Team Lead'
  const [wfh, setWfh] = useState<WfhToday | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const [snoozedUntil, setSnoozedUntil] = useState(0)
  const [tick, setTick] = useState(0)
  const offset = useRef(0)

  const apply = useCallback((w: WfhToday) => {
    offset.current = new Date(w.server_now).getTime() - Date.now()
    setWfh(w)
    setError('')
  }, [])

  const refresh = useCallback(async () => {
    if (!enabled) return
    try {
      apply(await api.get<WfhToday>('/wfh/today'))
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [enabled, apply])

  useEffect(() => {
    if (!enabled) { setWfh(null); setLoading(false); return }
    void refresh()
    const t = setInterval(() => { if (!document.hidden) void refresh() }, POLL_MS)
    const vis = () => { if (!document.hidden) void refresh() }
    document.addEventListener('visibilitychange', vis)
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', vis) }
  }, [enabled, refresh])

  // Re-evaluate "due" locally every 15s so the reminder appears on time even between polls.
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 15_000)
    return () => clearInterval(t)
  }, [])

  const serverNow = useCallback(() => Date.now() + offset.current, [])

  const due = useMemo(() => {
    void tick
    if (!wfh || !wfh.started || wfh.ended) return false
    if (wfh.status === 'Verification Due' || wfh.status === 'Missed Verification') return true
    return !!wfh.next_verification && serverNow() >= new Date(wfh.next_verification).getTime()
  }, [wfh, tick, serverNow])

  const start = useCallback(async () => {
    const pos = await getCurrentPosition()
    apply(await api.post<WfhToday>('/wfh/start', pos))
    return pos
  }, [apply])

  const verify = useCallback(async () => {
    const pos = await getCurrentPosition()
    apply(await api.post<WfhToday>('/wfh/verify', pos))
    setSnoozedUntil(0)
    return pos
  }, [apply])

  const end = useCallback(async () => apply(await api.post<WfhToday>('/wfh/end')), [apply])
  const snooze = useCallback(() => setSnoozedUntil(Date.now() + SNOOZE_MINUTES * 60_000), [])

  const value = useMemo(
    () => ({ wfh, loading, error, due, snoozedUntil, refresh, start, verify, end, snooze, serverNow }),
    [wfh, loading, error, due, snoozedUntil, refresh, start, verify, end, snooze, serverNow],
  )
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>
}

export function useWfh(): WfhState {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useWfh must be used inside WfhProvider')
  return ctx
}
