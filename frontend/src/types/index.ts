export type Role = 'Employee' | 'Team Lead' | 'HR' | 'Admin'

export interface User {
  user_id: string
  username: string
  role: Role
  employee_id: string
  name: string
  email: string
  department: string
  designation: string
  team_lead_id: string
  phone: string
  joining_date: string
  team_lead_name: string
}

export interface Employee {
  employee_id: string
  user_id: string
  name: string
  email: string
  phone: string
  department: string
  designation: string
  team_lead_id: string
  team_lead_name: string
  status: string
  joining_date: string
  role: Role
  username: string
}

export interface RequestItem {
  id: string
  type: 'Leave' | 'WFH'
  employee_id: string
  employee_name: string
  department: string
  role: string
  leave_type: string
  from_date: string
  to_date: string
  reason: string
  status: string
  approver_name: string
  approval_date: string
  rejection_reason: string
  created: string
  assigned_to: string
  can_decide?: boolean
}

export interface AttendanceDay {
  date: string
  check_in_time: string
  status: string
}

export interface AttendanceRow extends AttendanceDay {
  employee_id: string
  employee_name: string
  department: string
}

export interface TodayState {
  date: string
  status: string
  check_in_time: string
  checked_in: boolean
  comp_off_earned?: boolean
  punctuality?: '' | 'early' | 'on_time' | 'late'
  arrival?: '' | 'early' | 'on_time' | 'late'
  minutes_early?: number
  minutes_late?: number
  on_leave: boolean
  wfh_approved: boolean
  working_day: boolean
}

export interface WfhToday {
  approved: boolean
  request_id: string
  date: string
  server_now: string
  interval_hours: number
  started: boolean
  ended: boolean
  status: string
  start_time: string
  last_verification: string
  next_verification: string
  count: number
}

export interface WfhSession {
  employee_id: string
  employee_name: string
  department: string
  team_lead_name: string
  date: string
  request_id: string
  start_time: string
  last_verification: string
  next_verification: string
  status: string
  verifications: number
  latitude?: string
  longitude?: string
}

export interface WfhStats {
  total: number
  verified: number
  pending: number
  due: number
  missed: number
}

export interface Notice {
  id: string
  title: string
  message: string
  type: string
  read: boolean
  created: string
  link: string
}

export interface TrendPoint {
  date: string
  present: number
  leave: number
  wfh: number
  not_checked_in: number
}

export interface DeptSummary {
  department: string
  employees: number
  present: number
  leave: number
  wfh: number
  not_checked_in: number
}

export interface OverviewStats {
  role: Role
  range: { from: string; to: string; days: number }
  total_employees: number
  present: number
  on_leave: number
  wfh: number
  not_checked_in: number
  pending_approvals: number
  trend: TrendPoint[]
  recent_requests: RequestItem[]
  pending_requests: RequestItem[]
  wfh_stats: WfhStats
  wfh_sessions: WfhSession[]
  departments?: DeptSummary[]
  recent_activities?: { time: string; text: string }[]
}

export interface MyDashboard {
  summary: { present_days: number; leave_days: number; wfh_days: number; absent_days: number; total_working_days: number; comp_off_balance: number }
  today: TodayState
  wfh: WfhToday
  pending_requests: number
}

export interface Named {
  id: string
  name: string
  active?: boolean
  working_days?: string
}

export interface CompOffEntry {
  id: string
  work_date: string
  credit: number
  status: string
  used_request_id: string
}

export interface CompOffMine {
  balance: number
  available_to_request: number
  expiry_days: number
  ledger: CompOffEntry[]
}

export interface CompOffRow {
  id: string
  employee_id: string
  employee_name: string
  department: string
  work_date: string
  status: string
  used_request_id: string
}

export interface Setting {
  key: string
  value: string
  description: string
}
