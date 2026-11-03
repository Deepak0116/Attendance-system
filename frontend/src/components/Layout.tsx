import { useCallback, useEffect, useRef, useState } from 'react'
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { WfhProvider } from '../context/WfhContext'
import { api } from '../services/api'
import { useToast } from '../context/ToastContext'
import { useAsync } from '../hooks/useAsync'
import type { Notice } from '../types'
import { NAV, ROLE_LABEL } from '../utils/nav'
import { fmtDateTime, initials } from '../utils/format'
import Icon from './Icon'
import { Logo } from './Illustrations'
import { ConfirmDialog } from './ui'
import WfhReminder from './WfhReminder'

interface NotificationResponse { unread: number; items: Notice[] }

function NotificationBell() {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const seen = useRef<Set<string> | null>(null)
  const toast = useToast()
  // Poll every 10s (paused while the tab is hidden) and refresh the moment the user comes back to the tab.
  const { data, reload } = useAsync(() => api.get<NotificationResponse>('/notifications'), [], 10_000)
  useEffect(() => {
    const refresh = () => { if (!document.hidden) void reload() }
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [reload])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  // Browser notifications for newly arrived items - only when the user has already granted permission.
  useEffect(() => {
    if (!data) return
    if (seen.current === null) { seen.current = new Set(data.items.map((n) => n.id)); return }
    data.items.filter((n) => !n.read && !seen.current!.has(n.id)).forEach((n) => {
      seen.current!.add(n.id)
      toast.info(`${n.title}: ${n.message}`)  // visible pop-up when something new arrives while the app is open
      if ('Notification' in window && Notification.permission === 'granted') {
        try { new Notification(n.title, { body: n.message }) } catch { /* unsupported */ }
      }
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data])

  const openNotice = async (n: Notice) => {
    setOpen(false)
    if (n.link) navigate(n.link)  // go straight to the request / screen the notification is about
    if (!n.read) { try { await api.post(`/notifications/${n.id}/read`); await reload() } catch { /* ignore */ } }
  }
  const markAll = async () => { try { await api.post('/notifications/read-all'); await reload() } catch { /* ignore */ } }

  return (
    <div className="bell" ref={box}>
      <button className="icon-btn" onClick={() => setOpen((o) => !o)} aria-label={`Notifications${data?.unread ? `, ${data.unread} unread` : ''}`}>
        <Icon name="bell" size={20} />
        {!!data?.unread && <span className="badge">{data.unread > 99 ? '99+' : data.unread}</span>}
      </button>
      {open && (
        <div className="dropdown" role="menu">
          <div className="dropdown-head">
            <strong>Notifications</strong>
            {!!data?.unread && <button className="link" onClick={markAll}>Mark all read</button>}
          </div>
          <div className="dropdown-list">
            {!data?.items.length && <div className="state empty small"><span>You're all caught up.</span></div>}
            {data?.items.map((n) => (
              <button key={n.id} className={`notice ${n.read ? '' : 'unread'}`} onClick={() => openNotice(n)}>
                <strong>{n.title}</strong>
                <span>{n.message}</span>
                <small>{fmtDateTime(n.created)}</small>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default function Layout() {
  const { user, logout } = useAuth()
  const [menu, setMenu] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const loc = useLocation()
  const close = useCallback(() => setMenu(false), [])
  useEffect(close, [loc.pathname, close])
  if (!user) return null
  const items = NAV[user.role]
  const abbr = user.role === 'Team Lead' ? 'TL' : user.role === 'Employee' ? initials(user.name) : user.role

  return (
    <WfhProvider>
      <div className="app">
        <aside className={`sidebar ${menu ? 'open' : ''}`}>
          {user.role === 'Employee' ? (
            <div className="brand"><Logo width={150} /></div>
          ) : (
            <div className="brand role-brand">
              <div className="role-badge">{abbr}</div>
              <div><strong>{ROLE_LABEL[user.role]}</strong><span>Asten Labs</span></div>
            </div>
          )}
          <nav>
            {items.map((i) => (
              <NavLink key={i.to + i.label} to={i.to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Icon name={i.icon} size={18} /> <span>{i.label}</span>
              </NavLink>
            ))}
            <button className="nav-item" onClick={() => setConfirm(true)}><Icon name="logout" size={18} /> <span>Logout</span></button>
          </nav>
        </aside>
        {menu && <div className="scrim" onClick={close} />}
        <div className="main">
          <header className="topbar">
            <button className="icon-btn menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="menu" size={22} /></button>
            <div className="topbar-title muted">{user.department}</div>
            <div className="topbar-right">
              <NotificationBell />
              <div className="avatar" title={`${user.name} (${user.role})`}>{initials(user.name)}</div>
            </div>
          </header>
          <main className="content"><Outlet /></main>
        </div>
        <WfhReminder />
        <ConfirmDialog open={confirm} title="Log out" message="Are you sure you want to log out?" confirmLabel="Logout"
                       onConfirm={logout} onCancel={() => setConfirm(false)} />
      </div>
    </WfhProvider>
  )
}
