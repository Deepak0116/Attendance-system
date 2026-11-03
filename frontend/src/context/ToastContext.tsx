import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'

type Kind = 'success' | 'error' | 'info'
interface Toast { id: number; kind: Kind; text: string }
interface ToastApi { success: (t: string) => void; error: (t: string) => void; info: (t: string) => void }

const ToastContext = createContext<ToastApi | null>(null)
let counter = 0

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((kind: Kind, text: string) => {
    const id = ++counter
    setToasts((t) => [...t, { id, kind, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
  }, [])
  const api = useMemo<ToastApi>(() => ({
    success: (t) => push('success', t), error: (t) => push('error', t), info: (t) => push('info', t),
  }), [push])
  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>{t.text}</div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used inside ToastProvider')
  return ctx
}
