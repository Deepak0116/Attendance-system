import { useState } from 'react'
import RequestsTable from '../components/RequestsTable'
import { Card, ErrorBox, Loading, PageHeader, Tabs } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { useAsync } from '../hooks/useAsync'
import { api } from '../services/api'
import type { RequestItem } from '../types'

type View = 'pending' | 'history'

/** Pending Requests (TL) / HR Approvals (HR) / approvals queue for Admin. Actions use the API's routing rules. */
export function PendingRequests({ only }: { only?: 'leave' | 'wfh' }) {
  const { user } = useAuth()
  const [view, setView] = useState<View>('pending')
  const pending = useAsync(() => api.get<RequestItem[]>('/requests/pending', { type: only ?? 'all' }), [only], 30_000)
  const history = useAsync(() => api.get<RequestItem[]>('/requests/history'), [])
  const title = only === 'leave' ? 'Leave Approvals' : user?.role === 'HR' ? 'HR Approvals' : user?.role === 'Admin' ? 'Approvals' : 'Pending Requests'
  const sub = user?.role === 'HR' ? 'Team Lead leave and WFH requests awaiting your decision'
    : user?.role === 'Admin' ? 'Requests you can decide (override must be enabled in Settings)'
    : 'Leave and WFH requests from your team'
  const hist = (history.data ?? []).filter((r) => !only || r.type.toLowerCase() === only)
  const reloadAll = () => { void pending.reload(); void history.reload() }
  return (
    <>
      <PageHeader title={title} subtitle={sub} />
      <Card>
        <Tabs<View> value={view} onChange={setView} tabs={[{ value: 'pending', label: `Pending${pending.data ? ` (${pending.data.length})` : ''}` }, { value: 'history', label: 'My Decisions' }]} />
        {view === 'pending' ? (
          <>
            {pending.loading && !pending.data && <Loading />}
            {pending.error && <ErrorBox message={pending.error} onRetry={pending.reload} />}
            {pending.data && <RequestsTable rows={pending.data} showEmployee actions onChanged={reloadAll} emptyTitle="No pending requests" emptyText="You're all caught up." />}
          </>
        ) : (
          <>
            {history.loading && !history.data && <Loading />}
            {history.error && <ErrorBox message={history.error} onRetry={history.reload} />}
            {history.data && <RequestsTable rows={hist} showEmployee emptyTitle="No decisions yet" emptyText="Requests you approve or reject will be listed here." />}
          </>
        )}
      </Card>
    </>
  )
}
