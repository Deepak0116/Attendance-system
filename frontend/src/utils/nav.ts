import type { Role } from '../types'

export interface NavItem {
  to: string
  label: string
  icon: string
}

const profile: NavItem = { to: '/profile', label: 'Profile', icon: 'user' }
const dash: NavItem = { to: '/dashboard', label: 'Dashboard', icon: 'dashboard' }

export const NAV: Record<Role, NavItem[]> = {
  Employee: [
    dash,
    { to: '/attendance', label: 'Attendance', icon: 'clock' },
    { to: '/leave', label: 'Leave', icon: 'leave' },
    { to: '/wfh', label: 'WFH', icon: 'home' },
    { to: '/my-requests', label: 'My Requests', icon: 'file' },
    profile,
  ],
  'Team Lead': [
    dash,
    { to: '/team', label: 'My Team', icon: 'users' },
    { to: '/team-attendance', label: 'Team Attendance', icon: 'clock' },
    { to: '/pending', label: 'Pending Requests', icon: 'inbox' },
    { to: '/leave-approvals', label: 'Leave Approvals', icon: 'check' },
    { to: '/wfh-tracking', label: 'WFH Tracking', icon: 'pin' },
    { to: '/leave', label: 'My Leave', icon: 'leave' },
    { to: '/wfh', label: 'My WFH', icon: 'home' },
    { to: '/my-requests', label: 'My Requests', icon: 'file' },
    profile,
  ],
  HR: [
    dash,
    { to: '/employees', label: 'Employees', icon: 'users' },
    { to: '/all-attendance', label: 'Attendance', icon: 'clock' },
    { to: '/leave-overview', label: 'Leave Overview', icon: 'leave' },
    { to: '/wfh-overview', label: 'WFH Overview', icon: 'home' },
    { to: '/pending', label: 'HR Approvals', icon: 'check' },
    { to: '/reports', label: 'Reports', icon: 'chart' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
    profile,
  ],
  Admin: [
    dash,
    { to: '/employees', label: 'Employees', icon: 'users' },
    { to: '/all-attendance', label: 'Attendance', icon: 'clock' },
    { to: '/leave-overview', label: 'Leave', icon: 'leave' },
    { to: '/wfh-overview', label: 'WFH', icon: 'home' },
    { to: '/reports', label: 'Reports', icon: 'chart' },
    { to: '/settings', label: 'Settings', icon: 'settings' },
    profile,
  ],
}

export const ROLE_LABEL: Record<Role, string> = {
  Employee: 'Employee',
  'Team Lead': 'Team Lead (TL)',
  HR: 'HR',
  Admin: 'Admin',
}
