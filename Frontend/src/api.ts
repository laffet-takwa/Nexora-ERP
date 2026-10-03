/**
 * Central API client.
 *
 * Laravel reports validation failures as `{ message, errors }`. The previous
 * client read only `message`, which reduced every field-level problem - duplicate
 * SKU, duplicate email, password mismatch, insufficient stock, overpayment - to
 * the string "The given data was invalid." `ApiError` now keeps both, and
 * classifies the failure so callers can tell an expired session apart from a
 * dropped connection.
 */

export type FieldErrors = Record<string, string[]>

export type ApiErrorKind =
  | 'auth' // 401: missing, expired or revoked token
  | 'forbidden' // 403: account disabled, or role gate failed
  | 'validation' // 422: field-level or business validation
  | 'server' // 5xx
  | 'network' // connection refused, DNS failure, timeout
  | 'parse' // a response body that was not the expected JSON

export class ApiError extends Error {
  readonly status: number
  readonly kind: ApiErrorKind
  readonly fields: FieldErrors

  constructor(message: string, kind: ApiErrorKind, status = 0, fields: FieldErrors = {}) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = status
    this.fields = fields
  }

  /** The session is no longer valid and the stored token must be discarded. */
  get isAuthFailure(): boolean {
    return this.kind === 'auth'
  }

  /** The account exists but may not do this; the stored token stays valid. */
  get isForbidden(): boolean {
    return this.kind === 'forbidden'
  }

  /** A connectivity or server fault; retrying later is reasonable. */
  get isTransient(): boolean {
    return this.kind === 'network' || this.kind === 'server'
  }

  /** True when the failure is attributable to specific form fields. */
  get hasFieldErrors(): boolean {
    return Object.keys(this.fields).length > 0
  }

  /** First message recorded for a field, if any. */
  fieldError(field: string): string | undefined {
    return this.fields[field]?.[0]
  }
}

function kindForStatus(status: number): ApiErrorKind {
  if (status === 401) return 'auth'
  if (status === 403) return 'forbidden'
  if (status === 422) return 'validation'
  if (status >= 500) return 'server'

  return 'validation'
}

function readFields(payload: unknown): FieldErrors {
  if (!payload || typeof payload !== 'object') return {}

  const errors = (payload as { errors?: unknown }).errors
  if (!errors || typeof errors !== 'object') return {}

  const fields: FieldErrors = {}
  for (const [field, messages] of Object.entries(errors as Record<string, unknown>)) {
    if (Array.isArray(messages)) {
      fields[field] = messages.map((message) => String(message))
    } else if (typeof messages === 'string') {
      fields[field] = [messages]
    }
  }

  return fields
}

export async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  headers.set('Accept', 'application/json')

  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  let response: Response
  try {
    response = await fetch(`/api${path}`, { ...options, headers, credentials: 'include' })
  } catch {
    // Never surfaced as a raw "Failed to fetch": callers can show a real message.
    throw new ApiError('Unable to connect to the server. Please try again.', 'network')
  }

  const text = await response.text()
  let payload: unknown = null

  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      if (!response.ok) {
        throw new ApiError(
          response.status >= 500 ? 'The server could not complete the request.' : 'The server returned an unreadable response.',
          response.status >= 500 ? 'server' : 'parse',
          response.status,
        )
      }
      throw new ApiError('The server returned an unreadable response.', 'parse', response.status)
    }
  }

  if (!response.ok) {
    const message = (payload as { message?: string } | null)?.message
    throw new ApiError(
      message ?? `Request failed with status ${response.status}.`,
      kindForStatus(response.status),
      response.status,
      readFields(payload),
    )
  }

  return payload as T
}

/** Human-facing message for any thrown value, used by the catch-all handlers. */
export function describeError(error: unknown, fallback = 'Something went wrong.'): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error && error.message) return error.message

  return fallback
}