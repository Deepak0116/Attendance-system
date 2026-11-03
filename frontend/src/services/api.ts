const TOKEN_KEY = 'attendance_token'

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

/**
 * Normal use: the sign-in lives ONLY in sessionStorage, which is separate for every browser tab, so different
 * users can be signed in at the same time in different tabs (nothing is shared between tabs).
 * The start-up popup (/welcome) additionally keeps its own remembered sign-in under a different key, so it never
 * leaks into the normal tabs.
 */
const POPUP_KEY = 'attendance_popup_token'
const isPopup = () => typeof location !== 'undefined' && location.pathname.startsWith('/welcome')
try { localStorage.removeItem(TOKEN_KEY) } catch { /* old versions stored the sign-in here, forget it */ }

export const tokenStore = {
  get: () => {
    try {
      const own = sessionStorage.getItem(TOKEN_KEY)
      if (own) return own
      if (isPopup()) {
        const remembered = localStorage.getItem(POPUP_KEY)
        if (remembered) { sessionStorage.setItem(TOKEN_KEY, remembered); return remembered }
      }
      return null
    } catch { return null }
  },
  set: (t: string, remember = false) => {
    try { sessionStorage.setItem(TOKEN_KEY, t) } catch { /* storage unavailable */ }
    try { if (remember && isPopup()) localStorage.setItem(POPUP_KEY, t) } catch { /* storage unavailable */ }
  },
  clear: () => {
    try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* storage unavailable */ }
    try { if (isPopup()) localStorage.removeItem(POPUP_KEY) } catch { /* storage unavailable */ }
  },
}

let onUnauthorized: (message: string) => void = () => {}
export const setUnauthorizedHandler = (fn: (message: string) => void) => { onUnauthorized = fn }

export type Query = Record<string, string | number | boolean | undefined | null>

function qs(params?: Query): string {
  if (!params) return ''
  const sp = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => {
    if (v !== undefined && v !== null && v !== '') sp.set(k, String(v))
  })
  const s = sp.toString()
  return s ? `?${s}` : ''
}

async function raw(method: string, path: string, body?: unknown, params?: Query): Promise<Response> {
  const headers: Record<string, string> = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(`/api${path}${qs(params)}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined })
  } catch {
    throw new ApiError('Unable to reach the server. Please check your connection and try again.', 0)
  }
  if (!res.ok) {
    let detail = `Request failed (${res.status})`
    try {
      const j = await res.json()
      if (typeof j.detail === 'string') detail = j.detail
    } catch { /* non-JSON error body */ }
    if (res.status === 401 && path !== '/auth/login') onUnauthorized(detail)
    throw new ApiError(detail, res.status)
  }
  return res
}

async function json<T>(method: string, path: string, body?: unknown, params?: Query): Promise<T> {
  const res = await raw(method, path, body, params)
  return (await res.json()) as T
}

export const api = {
  get: <T>(path: string, params?: Query) => json<T>('GET', path, undefined, params),
  post: <T>(path: string, body?: unknown) => json<T>('POST', path, body ?? {}),
  put: <T>(path: string, body?: unknown) => json<T>('PUT', path, body ?? {}),
  async download(path: string, params: Query, fallbackName: string) {
    const res = await raw('GET', path, undefined, params)
    const blob = await res.blob()
    const cd = res.headers.get('Content-Disposition') || ''
    const name = /filename="?([^"]+)"?/.exec(cd)?.[1] || fallbackName
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = name
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  },
}

export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : 'Something went wrong')
