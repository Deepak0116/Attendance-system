import { useEffect, useState, type ReactNode } from 'react'
import Icon from './Icon'
import { statusTone } from '../utils/format'
import { PRESETS, presetDates, type Preset, type RangeValue } from '../utils/range'

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
      </div>
      {actions && <div className="page-actions">{actions}</div>}
    </div>
  )
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`pill pill-${statusTone(status)}`}>{status || '—'}</span>
}

type Tone = 'blue' | 'orange' | 'purple' | 'green' | 'amber' | 'red' | 'teal'
export function StatCard({ label, value, hint, icon, tone = 'blue' }: { label: string; value: ReactNode; hint?: string; icon: string; tone?: Tone }) {
  return (
    <div className={`stat-card tone-${tone}`}>
      <div className="stat-icon"><Icon name={icon} size={20} /></div>
      <div>
        <div className="stat-label">{label}</div>
        <div className="stat-value">{value}</div>
        {hint && <div className="stat-hint">{hint}</div>}
      </div>
    </div>
  )
}

export function Loading({ text = 'Loading…' }: { text?: string }) {
  return <div className="state"><div className="spinner" /><span>{text}</span></div>
}

export function EmptyState({ title, text, icon = 'inbox' }: { title: string; text?: string; icon?: string }) {
  return (
    <div className="state empty">
      <Icon name={icon} size={30} />
      <strong>{title}</strong>
      {text && <span>{text}</span>}
    </div>
  )
}

export function ErrorBox({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-error" role="alert">
      <Icon name="alert" /> <span>{message}</span>
      {onRetry && <button className="btn btn-sm btn-ghost" onClick={onRetry}>Retry</button>}
    </div>
  )
}

export function Card({ title, actions, children, className = '' }: { title?: string; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card ${className}`}>
      {(title || actions) && (
        <div className="card-head">
          {title && <h2>{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  )
}

export interface Column<T> {
  header: string
  render: (row: T) => ReactNode
  className?: string
}

export function DataTable<T>({ columns, rows, rowKey, emptyTitle = 'Nothing to show', emptyText, rowClass }: {
  columns: Column<T>[]; rows: T[]; rowKey: (row: T) => string; emptyTitle?: string; emptyText?: string; rowClass?: (row: T) => string
}) {
  if (!rows.length) return <EmptyState title={emptyTitle} text={emptyText} />
  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>{columns.map((c) => <th key={c.header} className={c.className}>{c.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={rowKey(r)} id={`row-${rowKey(r)}`} className={rowClass?.(r) ?? ''}>
              {columns.map((c) => <td key={c.header} data-label={c.header} className={c.className}>{c.render(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function Modal({ open, title, onClose, children, footer, narrow = false }: {
  open: boolean; title?: string; onClose: () => void; children: ReactNode; footer?: ReactNode; narrow?: boolean
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])
  if (!open) return null
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className={`modal ${narrow ? 'modal-narrow' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <button className="modal-close" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        {title && <h2 className="modal-title">{title}</h2>}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  )
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Confirm', danger, busy, onConfirm, onCancel }: {
  open: boolean; title: string; message: ReactNode; confirmLabel?: string; danger?: boolean; busy?: boolean
  onConfirm: () => void; onCancel: () => void
}) {
  return (
    <Modal open={open} title={title} onClose={onCancel} narrow footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
          {busy ? 'Please wait…' : confirmLabel}
        </button>
      </>
    }>
      <p>{message}</p>
    </Modal>
  )
}

/** Rejection requires a reason - the submit button stays disabled until one is typed. */
export function RejectDialog({ open, subject, busy, onSubmit, onCancel }: {
  open: boolean; subject: string; busy?: boolean; onSubmit: (reason: string) => void; onCancel: () => void
}) {
  const [reason, setReason] = useState('')
  useEffect(() => { if (open) setReason('') }, [open])
  return (
    <Modal open={open} title="Reject request" onClose={onCancel} narrow footer={
      <>
        <button className="btn btn-ghost" onClick={onCancel} disabled={busy}>Cancel</button>
        <button className="btn btn-danger" disabled={busy || !reason.trim()} onClick={() => onSubmit(reason.trim())}>
          {busy ? 'Rejecting…' : 'Reject'}
        </button>
      </>
    }>
      <p>{subject}</p>
      <label className="field">
        <span>Reason for rejection <em className="req">*</em></span>
        <textarea rows={3} value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} placeholder="Explain why this request is rejected" autoFocus />
      </label>
    </Modal>
  )
}

export function RangeFilter({ value, onChange }: { value: RangeValue; onChange: (v: RangeValue) => void }) {
  const setPreset = (preset: Preset) => {
    if (preset === 'custom') onChange({ ...value, preset })
    else onChange({ preset, ...presetDates(preset) })
  }
  return (
    <div className="filter-group">
      <label className="field inline">
        <span>Period</span>
        <select value={value.preset} onChange={(e) => setPreset(e.target.value as Preset)}>
          {PRESETS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
        </select>
      </label>
      {value.preset === 'custom' && (
        <>
          <label className="field inline"><span>From</span>
            <input type="date" value={value.from} max={value.to || undefined} onChange={(e) => onChange({ ...value, from: e.target.value })} />
          </label>
          <label className="field inline"><span>To</span>
            <input type="date" value={value.to} min={value.from || undefined} onChange={(e) => onChange({ ...value, to: e.target.value })} />
          </label>
        </>
      )}
    </div>
  )
}

export function SelectFilter({ label, value, onChange, options, allLabel = 'All' }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; allLabel?: string
}) {
  return (
    <label className="field inline">
      <span>{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  )
}

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: { value: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map((t) => (
        <button key={t.value} role="tab" aria-selected={value === t.value} className={`tab ${value === t.value ? 'active' : ''}`} onClick={() => onChange(t.value)}>
          {t.label}
        </button>
      ))}
    </div>
  )
}
