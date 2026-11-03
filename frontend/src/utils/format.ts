const pad = (n: number) => String(n).padStart(2, '0')

export const toIsoDate = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`

/** "2026-11-03T09:15:00" -> "09:15 AM" (empty string for empty input). */
export function fmtTime(ts?: string): string {
  if (!ts) return '—'
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

/** "2026-10-31" -> "31 Oct 2026". */
export function fmtDate(s?: string): string {
  if (!s) return '—'
  const d = new Date(s.length === 10 ? `${s}T00:00:00` : s)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export const fmtDateTime = (s?: string) => (s ? `${fmtDate(s)}, ${fmtTime(s)}` : '—')

export const fmtLongDate = (d: Date) =>
  d.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })

export function greeting(d = new Date()): string {
  const h = d.getHours()
  return h < 12 ? 'Good Morning' : h < 17 ? 'Good Afternoon' : 'Good Evening'
}

export const fmtRange = (a: string, b: string) => (a === b ? fmtDate(a) : `${fmtDate(a)} – ${fmtDate(b)}`)

export function monthStartIso(): string {
  const d = new Date()
  return toIsoDate(new Date(d.getFullYear(), d.getMonth(), 1))
}

export const initials = (name: string) => name.trim().charAt(0).toUpperCase() || '?'

/** Case-insensitive status -> CSS tone used by StatusPill. */
export function statusTone(status: string): 'green' | 'amber' | 'red' | 'blue' | 'grey' | 'purple' {
  const s = status.toLowerCase()
  if (['approved', 'present', 'verified', 'active', 'completed', 'yes'].includes(s)) return 'green'
  if (s.startsWith('pending') && s !== 'pending verification') return 'amber'
  if (['verification due', 'pending verification', 'due'].includes(s)) return 'amber'
  if (['rejected', 'missed verification', 'not checked in', 'inactive', 'missed'].includes(s)) return 'red'
  if (s === 'leave') return 'amber'
  if (s === 'wfh') return 'purple'
  return 'grey'
}
