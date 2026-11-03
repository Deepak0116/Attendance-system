import type { ReactNode } from 'react'
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { Loading } from './components/ui'
import { AuthProvider, useAuth } from './context/AuthContext'
import { ToastProvider } from './context/ToastContext'
import type { Role } from './types'
import { AttendanceOverview, MyAttendance } from './pages/Attendance'
import { PendingRequests } from './pages/Approvals'
import Dashboard from './pages/Dashboard'
import Employees from './pages/Employees'
import Login from './pages/Login'
import { LeaveOverview, WfhOverview, WfhTracking } from './pages/Overviews'
import Profile from './pages/Profile'
import Reports from './pages/Reports'
import { LeavePage, MyRequests, WfhPage } from './pages/Requests'
import Settings from './pages/Settings'
import Welcome from './pages/Welcome'
import { EmptyState } from './components/ui'

function Protected({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <div className="boot"><Loading text="Starting…" /></div>
  return user ? <>{children}</> : <Navigate to="/login" replace />
}

/** Frontend route guard. The API enforces the same rules - this only avoids dead-end screens. */
function RoleGuard({ roles, children }: { roles: Role[]; children: ReactNode }) {
  const { user } = useAuth()
  if (user && !roles.includes(user.role)) return <EmptyState title="Access denied" text="Your role does not have access to this page." icon="shield" />
  return <>{children}</>
}

const G = (roles: Role[], el: ReactNode) => <RoleGuard roles={roles}>{el}</RoleGuard>

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/welcome" element={<Welcome />} />
            <Route element={<Protected><Layout /></Protected>}>
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/attendance" element={G(['Employee'], <MyAttendance />)} />
              <Route path="/leave" element={G(['Employee', 'Team Lead'], <LeavePage />)} />
              <Route path="/wfh" element={G(['Employee', 'Team Lead'], <WfhPage />)} />
              <Route path="/my-requests" element={G(['Employee', 'Team Lead'], <MyRequests />)} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/team" element={G(['Team Lead'], <Employees teamView />)} />
              <Route path="/team-attendance" element={G(['Team Lead'], <AttendanceOverview />)} />
              <Route path="/pending" element={G(['Team Lead', 'HR', 'Admin'], <PendingRequests />)} />
              <Route path="/leave-approvals" element={G(['Team Lead'], <PendingRequests only="leave" />)} />
              <Route path="/wfh-tracking" element={G(['Team Lead'], <WfhTracking />)} />
              <Route path="/employees" element={G(['HR', 'Admin'], <Employees />)} />
              <Route path="/all-attendance" element={G(['HR', 'Admin'], <AttendanceOverview />)} />
              <Route path="/leave-overview" element={G(['HR', 'Admin'], <LeaveOverview />)} />
              <Route path="/wfh-overview" element={G(['HR', 'Admin'], <WfhOverview />)} />
              <Route path="/reports" element={G(['HR', 'Admin'], <Reports />)} />
              <Route path="/settings" element={G(['HR', 'Admin'], <Settings />)} />
            </Route>
            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  )
}
