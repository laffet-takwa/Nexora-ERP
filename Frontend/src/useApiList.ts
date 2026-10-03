import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, apiFetch, describeError } from './api'

export type PaginatedResponse<T> = {
  data: T[]
  current_page: number
  last_page: number
  per_page: number
  total: number
}

export const PAGE_SIZE = 15

export type ListOptions = {
  /** Extra query parameters, merged after the standard ones. */
  params?: Record<string, string | number | undefined>
  /** Page size; the API caps this at 100. Defaults to PAGE_SIZE. */
  perPage?: number
}

/**
 * Server-side paginated list loading.
 *
 * The search term is debounced and the in-flight request is aborted when the
 * search, page or token changes, so a slow earlier response can never overwrite
 * a newer one and typing does not fire a request per keystroke.
 */
export function useApiList<T>(path: string, token: string, search = '', options: ListOptions = {}) {
  const { params } = options
  // Keyed by value: callers pass object literals, so the identity is never stable.
  const paramsKey = JSON.stringify(params ?? {})
  const perPage = options.perPage ?? PAGE_SIZE
  const [result, setResult] = useState<PaginatedResponse<T> | null>(null)
  const [error, setError] = useState<ApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [revision, setRevision] = useState(0)
  const latestRequest = useRef(0)

  // Reset to the first page whenever the result set itself changes, otherwise a
  // filter change could leave the user stranded on an out-of-range page.
  useEffect(() => {
    setPage(1)
  }, [path, token])

  useEffect(() => {
    const requestId = latestRequest.current + 1
    latestRequest.current = requestId
    const controller = new AbortController()

    const query = new URLSearchParams({ per_page: String(perPage), page: String(page) })
    if (search.trim()) query.set('search', search.trim())
    for (const [key, value] of Object.entries(JSON.parse(paramsKey) as Record<string, string | number | undefined>)) {
      if (value !== undefined) query.set(key, String(value))
    }

    const timer = window.setTimeout(() => {
      setLoading(true)
      setError(null)

      void apiFetch<PaginatedResponse<T>>(`/v1/${path}?${query.toString()}`, { signal: controller.signal }, token)
        .then((response) => {
          if (latestRequest.current !== requestId) return
          setResult(response)
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted || latestRequest.current !== requestId) return
          setError(
            requestError instanceof ApiError
              ? requestError
              : new ApiError(describeError(requestError, 'Unable to load records.'), 'server'),
          )
        })
        .finally(() => {
          if (latestRequest.current !== requestId) return
          setLoading(false)
        })
    }, search ? 250 : 0)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [path, token, search, page, revision, paramsKey, perPage])

  const reload = useCallback(() => setRevision((current) => current + 1), [])

  return {
    result,
    error,
    loading,
    page,
    setPage,
    reload,
    errorMessage: error ? error.message : '',
  }
}