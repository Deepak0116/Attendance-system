import type { DeptSummary, TrendPoint } from '../types'
import { EmptyState } from './ui'

interface Series { key: keyof TrendPoint; label: string; color: string }

/** Grouped bar chart (SVG). Used for attendance / leave / WFH trends. */
export function TrendChart({ data, series, height = 180 }: { data: TrendPoint[]; series: Series[]; height?: number }) {
  if (!data.length) return <EmptyState title="No data for this period" icon="chart" />
  const points = data.length > 31 ? data.slice(-31) : data
  const max = Math.max(1, ...points.flatMap((p) => series.map((s) => Number(p[s.key]))))
  const W = 560, padL = 28, padB = 24, padT = 8
  const innerW = W - padL - 6, innerH = height - padB - padT
  const group = innerW / points.length
  const bar = Math.max(3, Math.min(18, (group - 6) / series.length))
  const ticks = [0, Math.ceil(max / 2), max]
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${height}`} className="chart" role="img" aria-label="Trend chart">
        {ticks.map((t) => {
          const y = padT + innerH - (t / max) * innerH
          return <g key={t}><line x1={padL} x2={W - 4} y1={y} y2={y} stroke="var(--line)" /><text x={padL - 6} y={y + 4} textAnchor="end" className="axis">{t}</text></g>
        })}
        {points.map((p, i) => {
          const x0 = padL + i * group + (group - bar * series.length) / 2
          return (
            <g key={p.date}>
              {series.map((s, j) => {
                const h = (Number(p[s.key]) / max) * innerH
                return <rect key={s.key} x={x0 + j * bar} y={padT + innerH - h} width={bar - 1} height={h} rx={2} fill={s.color}><title>{`${p.date} · ${s.label}: ${p[s.key]}`}</title></rect>
              })}
              {(points.length <= 10 || i % Math.ceil(points.length / 8) === 0) && (
                <text x={padL + i * group + group / 2} y={height - 6} textAnchor="middle" className="axis">{p.date.slice(5)}</text>
              )}
            </g>
          )
        })}
      </svg>
      <div className="legend">{series.map((s) => <span key={s.key}><i style={{ background: s.color }} />{s.label}</span>)}</div>
    </div>
  )
}

/** Horizontal stacked bars: one row per department. */
export function DepartmentBars({ data }: { data: DeptSummary[] }) {
  if (!data.length) return <EmptyState title="No departments yet" icon="users" />
  return (
    <div className="dept-bars">
      {data.map((d) => {
        const total = Math.max(1, d.present + d.leave + d.wfh + d.not_checked_in)
        return (
          <div key={d.department} className="dept-row">
            <div className="dept-name"><strong>{d.department}</strong><span className="muted small">{d.employees} employees</span></div>
            <div className="stack" title={`Present ${d.present} · Leave ${d.leave} · WFH ${d.wfh} · Not checked in ${d.not_checked_in}`}>
              <i style={{ width: `${(d.present / total) * 100}%`, background: 'var(--green)' }} />
              <i style={{ width: `${(d.wfh / total) * 100}%`, background: 'var(--purple)' }} />
              <i style={{ width: `${(d.leave / total) * 100}%`, background: 'var(--orange)' }} />
              <i style={{ width: `${(d.not_checked_in / total) * 100}%`, background: 'var(--red)' }} />
            </div>
            <div className="dept-nums small muted">P {d.present} · W {d.wfh} · L {d.leave} · N {d.not_checked_in}</div>
          </div>
        )
      })}
      <div className="legend">
        <span><i style={{ background: 'var(--green)' }} />Present</span><span><i style={{ background: 'var(--purple)' }} />WFH</span>
        <span><i style={{ background: 'var(--orange)' }} />Leave</span><span><i style={{ background: 'var(--red)' }} />Not checked in</span>
      </div>
    </div>
  )
}
