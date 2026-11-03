import { useEffect, useState } from 'react'
import { api } from '../services/api'
import { useAuth } from '../context/AuthContext'
import type { Employee, Named } from '../types'

/** Loads the dropdown options (departments, employees, team leads) for filters, scoped by the API to the user's role. */
export function useFilterOptions() {
  const { user } = useAuth()
  const [departments, setDepartments] = useState<Named[]>([])
  const [employees, setEmployees] = useState<Employee[]>([])
  const [teamLeads, setTeamLeads] = useState<Employee[]>([])

  useEffect(() => {
    if (!user) return
    api.get<Named[]>('/departments').then(setDepartments).catch(() => setDepartments([]))
    if (user.role === 'Employee') return
    api.get<Employee[]>('/employees').then(setEmployees).catch(() => setEmployees([]))
    if (user.role === 'HR' || user.role === 'Admin') api.get<Employee[]>('/employees/team-leads').then(setTeamLeads).catch(() => setTeamLeads([]))
  }, [user])

  return { departments, employees, teamLeads }
}
