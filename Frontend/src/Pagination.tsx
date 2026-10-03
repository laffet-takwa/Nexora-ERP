type Props = {
  currentPage: number
  lastPage: number
  total: number
  loading?: boolean
  onPageChange: (page: number) => void
}

/**
 * Server-side pagination controls.
 *
 * Paging stays on the server; the browser never loads a full table just to slice
 * it. Search and filters are preserved because only the page number changes.
 */
export function Pagination({ currentPage, lastPage, total, loading = false, onPageChange }: Props) {
  if (lastPage <= 1) return null

  const from = (currentPage - 1) * 1 + 1
  const windowStart = Math.max(1, Math.min(currentPage - 2, lastPage - 4))
  const windowEnd = Math.min(lastPage, windowStart + 4)
  const pages = Array.from({ length: windowEnd - windowStart + 1 }, (_, index) => windowStart + index)

  return (
    <nav className="pagination" aria-label="Pagination">
      <p className="pagination-summary">
        {loading ? 'Loading…' : `Page ${currentPage} of ${lastPage}`} · {total} record{total === 1 ? '' : 's'}
      </p>
      <div className="pagination-controls">
        <button
          type="button"
          className="secondary-button"
          onClick={() => onPageChange(1)}
          disabled={loading || currentPage <= 1}
          aria-label="First page"
        >
          «
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={loading || currentPage <= 1}
          aria-label="Previous page"
        >
          ‹
        </button>
        {pages.map((page) => (
          <button
            key={page}
            type="button"
            className={`secondary-button ${page === currentPage ? 'is-current' : ''}`}
            onClick={() => onPageChange(page)}
            disabled={loading}
            aria-current={page === currentPage ? 'page' : undefined}
            aria-label={`Page ${page}`}
          >
            {page}
          </button>
        ))}
        <button
          type="button"
          className="secondary-button"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={loading || currentPage >= lastPage}
          aria-label="Next page"
        >
          ›
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => onPageChange(lastPage)}
          disabled={loading || currentPage >= lastPage}
          aria-label="Last page"
        >
          »
        </button>
      </div>
      <span className="visually-hidden" aria-live="polite">
        {`Showing page ${from} of ${lastPage}`}
      </span>
    </nav>
  )
}