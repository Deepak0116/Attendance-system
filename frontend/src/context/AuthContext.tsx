import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api, setUnauthorizedHandler, tokenStore } from '../services/api'
import type { User } from '../types'

interface AuthState {
  user: User | null
  loading: boolean
  notice: string
  login: (username: string, password: string, remember?: boolean) => Promise<void>
  logout: () => void
  refreshUser: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const [notice, setNotice] = useState('')

  const logout = useCallback(() => {
    tokenStore.clear()
    setUser(null)
  }, [])

  useEffect(() => {
    setUnauthorizedHandler((message) => {
      tokenStore.clear()
      setUser(null)
      setNotice(message)
    })
    if (!tokenStore.get()) {
      setLoading(false)
      return
    }
    api.get<User>('/auth/me')
      .then(setUser)
      .catch(() => tokenStore.clear())
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (username: string, password: string, remember = false) => {
    const res = await api.post<{ access_token: string; user: User }>('/auth/login', { username, password, remember })
    tokenStore.set(res.access_token, remember)
    setNotice('')
    setUser(res.user)
  }, [])

  const refreshUser = useCallback(async () => setUser(await api.get<User>('/auth/me')), [])

  const value = useMemo(() => ({ user, loading, notice, login, logout, refreshUser }), [user, loading, notice, login, logout, refreshUser])
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}
