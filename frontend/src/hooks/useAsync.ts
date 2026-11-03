import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../services/api'

interface AsyncState<T> {
  data: T | null
  loading: boolean
  error: string
  reload: () => Promise<void>
  setData: (d: T | null) => void
}

/**
 * Loads data on mount / when deps change, and optionally refreshes it quietly every `pollMs`.
 * Polling is paused while the tab is hidden so the server is not hit needlessly.
 */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[], pollMs = 0): AsyncState<T> {
  const [data, setData] = useState<T | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const fnRef = useRef(fn)
  fnRef.current = fn
  const seq = useRef(0)

  const run = useCallback(async (silent: boolean) => {
    const id = ++seq.current
    if (!silent) setLoading(true)
    try {
      const res = await fnRef.current()
      if (id === seq.current) { setData(res); setError('') }
    } catch (e) {
      if (id === seq.current) setError(errorMessage(e))
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void run(false)
    if (!pollMs) return
    const t = setInterval(() => { if (!document.hidden) void run(true) }, pollMs)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, pollMs, run])

  const reload = useCallback(() => run(true), [run])
  return { data, loading, error, reload, setData }
}

/** Ticks every second so clocks/countdowns re-render. */
export function useNow(intervalMs = 1000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), intervalMs)
    return () => clearInterval(t)
  }, [intervalMs])
  return now
}
