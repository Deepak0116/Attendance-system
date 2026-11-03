import { toIsoDate } from './format'

export type Preset = 'today' | 'yesterday' | 'last5' | 'week' | 'month' | 'custom'

export const PRESETS: { value: Preset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last5', label: 'Last 5 Days' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'custom', label: 'Custom Range' },
]

export interface RangeValue {
  preset: Preset
  from: string
  to: string
}

export function presetDates(preset: Preset, from = '', to = ''): { from: string; to: string } {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  if (preset === 'today') return { from: toIsoDate(today), to: toIsoDate(today) }
  if (preset === 'yesterday') {
    const y = new Date(today); y.setDate(y.getDate() - 1)
    return { from: toIsoDate(y), to: toIsoDate(y) }
  }
  if (preset === 'last5') {
    const s = new Date(today); s.setDate(s.getDate() - 4)
    return { from: toIsoDate(s), to: toIsoDate(today) }
  }
  if (preset === 'week') {
    const s = new Date(today); s.setDate(s.getDate() - ((s.getDay() + 6) % 7))
    return { from: toIsoDate(s), to: toIsoDate(today) }
  }
  if (preset === 'month') return { from: toIsoDate(new Date(today.getFullYear(), today.getMonth(), 1)), to: toIsoDate(today) }
  return { from, to }
}

export const initialRange = (preset: Preset = 'month'): RangeValue => ({ preset, ...presetDates(preset) })
