/**
 * Presentation helpers.
 *
 * Status colours are an explicit table rather than substring matching: the old
 * `includes('paid')` test rendered `partially_paid` as a fully settled success and
 * let `overdue` fall through to neutral, which inverted the urgency of a
 * financial state.
 */

export type StatusTone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

/** Invoice payment progress - the authoritative dimension. */
const INVOICE_TONES: Record<string, StatusTone> = {
  paid: 'success',
  partially_paid: 'warning',
  unpaid: 'neutral',
  // Legacy single-value status, kept for backward compatibility.
  pending: 'neutral',
  overdue: 'danger',
  cancelled: 'neutral',
  void: 'neutral',
  draft: 'neutral',
}

const ORDER_TONES: Record<string, StatusTone> = {
  completed: 'success',
  processing: 'info',
  confirmed: 'info',
  pending: 'warning',
  cancelled: 'neutral',
}

const PRODUCT_TONES: Record<string, StatusTone> = {
  active: 'success',
  inactive: 'neutral',
}

const MOVEMENT_TONES: Record<string, StatusTone> = {
  in: 'success',
  out: 'danger',
  adjustment: 'warning',
  transfer: 'info',
}

const METHOD_TONES: Record<string, StatusTone> = {
  paid: 'success',
  cash: 'success',
  card: 'success',
  bank_transfer: 'info',
  cheque: 'warning',
  other: 'neutral',
}

/**
 * Tone for a status value from any domain.
 *
 * Falls back to the invoice table, which covers the widest set, so an unknown
 * financial status still renders as neutral rather than accidentally matching.
 */
export function statusTone(value: string | null | undefined): StatusTone {
  const normalized = (value ?? '').toString().toLowerCase().trim()
  if (!normalized) return 'neutral'

  return (
    INVOICE_TONES[normalized] ??
    ORDER_TONES[normalized] ??
    PRODUCT_TONES[normalized] ??
    MOVEMENT_TONES[normalized] ??
    METHOD_TONES[normalized] ??
    'neutral'
  )
}

/** Backwards-compatible alias used throughout the pages. */
export function statusClass(value: string | null | undefined): StatusTone {
  return statusTone(value)
}

/** Human label for a status value, with underscores replaced by spaces. */
export function statusLabel(value: string | null | undefined): string {
  const normalized = (value ?? '').toString().toLowerCase().trim()
  if (!normalized) return 'Unknown'

  return normalized.replaceAll('_', ' ')
}

export function stockTone(stockQuantity: number, minimumStockLevel: number): StatusTone {
  if (stockQuantity <= 0) return 'danger'
  if (minimumStockLevel > 0 && stockQuantity <= minimumStockLevel) return 'warning'

  return 'success'
}

export function stockLabel(stockQuantity: number, minimumStockLevel: number): string {
  if (stockQuantity <= 0) return 'Out of Stock'
  if (minimumStockLevel > 0 && stockQuantity <= minimumStockLevel) return 'Low Stock'

  return 'In Stock'
}

export function stockClass(stockQuantity: number, minimumStockLevel: number): StatusTone {
  return stockTone(stockQuantity, minimumStockLevel)
}

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'EUR',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

const numberFormatter = new Intl.NumberFormat('en-US')

/**
 * Money is rendered to the cent because the schema stores DECIMAL(12,3); the old
 * `maximumFractionDigits: 0` silently rounded 1234.567 to 1,235.
 */
export function formatCurrency(value: number): string {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0)
}

export function formatNumber(value: number): string {
  return numberFormatter.format(Number.isFinite(value) ? value : 0)
}

/** Decimal columns arrive as strings; normalise without losing precision. */
export function toNumber(value: number | string | null | undefined): number {
  const parsed = typeof value === 'string' ? Number.parseFloat(value) : value
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : 0
}

/** Settings values arrive as JSON-encoded strings; decode without throwing. */
export function parseSettingValue(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '-'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'

  return parsed.toLocaleDateString()
}

export function formatDateTime(value: string | null | undefined): string {
  if (!value) return '-'

  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return '-'

  return parsed.toLocaleString()
}

export function initials(name: string | null | undefined): string {
  return (name ?? '')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('')
}