/**
 * Navigation mapping between the page keys used by the components and the URL
 * paths, implemented on the History API so no routing dependency is needed.
 *
 * Deep links, refresh and browser back/forward all work, and the active section
 * stays shareable.
 */

export type PageKey =
  | 'dashboard'
  | 'customers'
  | 'products'
  | 'orders'
  | 'invoices'
  | 'payments'
  | 'inventory'
  | 'reports'
  | 'users'
  | 'roles'
  | 'audit'
  | 'settings'

export const PATHS: Record<PageKey, string> = {
  dashboard: '/dashboard',
  customers: '/customers',
  products: '/products',
  orders: '/orders',
  invoices: '/invoices',
  payments: '/payments',
  inventory: '/inventory',
  reports: '/reports',
  users: '/users',
  roles: '/roles',
  audit: '/audit-logs',
  settings: '/settings',
}

const BY_PATH = new Map<string, PageKey>(
  (Object.entries(PATHS) as Array<[PageKey, string]>).map(([key, path]) => [path, key]),
)

const DEFAULT_PAGE: PageKey = 'dashboard'

/** Resolve a pathname to a known page, falling back to the dashboard. */
export function pageFromPath(pathname: string): PageKey {
  const normalized = pathname.replace(/\/+$/, '') || '/'
  return BY_PATH.get(normalized) ?? DEFAULT_PAGE
}

export function pathForPage(page: PageKey): string {
  return PATHS[page]
}

/** Navigate to a page, adding a history entry. */
export function pushPage(page: PageKey): void {
  const path = pathForPage(page)
  if (window.location.pathname !== path) {
    window.history.pushState({ page }, '', path)
  }
}

/** Replace the current entry, used for the initial load correction. */
export function replacePage(page: PageKey): void {
  window.history.replaceState({ page }, '', pathForPage(page))
}