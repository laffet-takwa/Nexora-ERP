import { useCallback, useEffect, useMemo, useState } from 'react'
import './App.css'
import { ApiError, apiFetch, describeError } from './api'
import { FieldError } from './FieldError'
import { Pagination } from './Pagination'
import { formatCurrency, formatDate, formatDateTime, formatNumber, initials, parseSettingValue, statusClass, statusLabel, stockClass, stockLabel, toNumber } from './format'
import { useApiList, type PaginatedResponse } from './useApiList'
import { useFormErrors } from './useFormErrors'
import { pageFromPath, pushPage, replacePage, type PageKey } from './routes'

/** Every list page takes the token and an optional post-mutation refresh. */
type PageProps = { token: string; onChanged?: () => void | Promise<void> }

type ThemeMode = 'light' | 'dark'

type NavGroup = {
  label: string
  items: Array<{ key: PageKey; label: string; badge?: string }>
}

type SearchResult = {
  title: string
  type: string
  meta: string
  page: PageKey
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ key: 'dashboard', label: 'Dashboard' }],
  },
  {
    label: 'CRM',
    items: [{ key: 'customers', label: 'Customers' }],
  },
  {
    label: 'Sales',
    items: [
      { key: 'orders', label: 'Orders' },
      { key: 'invoices', label: 'Invoices' },
      { key: 'payments', label: 'Payments' },
    ],
  },
  {
    label: 'Catalog',
    items: [{ key: 'products', label: 'Products' }],
  },
  {
    label: 'Inventory',
    items: [{ key: 'inventory', label: 'Inventory' }],
  },
  {
    label: 'Analytics',
    items: [{ key: 'reports', label: 'Reports' }],
  },
  {
    label: 'Administration',
    items: [
      { key: 'users', label: 'Users' },
      { key: 'roles', label: 'Roles & Permissions' },
      { key: 'audit', label: 'Audit Logs' },
    ],
  },
  {
    label: 'System',
    items: [{ key: 'settings', label: 'Settings' }],
  },
]

type User = {
  id: number
  name: string
  email: string
  role: string
  is_active?: boolean
}

type DashboardResponse = {
  kpis?: Record<string, number | string>
  recent_orders?: Array<{ id: number; order_number?: string; total?: number; status?: string; created_at?: string; customer?: { first_name?: string; last_name?: string } }>
  top_products?: Array<{ name: string; quantity: number }>
  sales_over_time?: Array<{ date?: string; orders?: number; total?: number }>
  revenue_by_month?: Array<{ month?: string; total?: number }>
  recent_invoices?: Array<{ invoice_number?: string; total?: number; status?: string; customer?: { first_name?: string; last_name?: string } }>
  recent_payments?: Array<{ amount?: number; method?: string; customer?: { first_name?: string; last_name?: string } }>
  low_stock?: Array<{ name?: string; stock_quantity?: number; minimum_stock_level?: number }>
  [key: string]: unknown
}

type CustomerRecord = {
  id: number
  first_name: string
  last_name: string
  company?: string | null
  email?: string | null
  phone?: string | null
  orders_count?: number
  invoices_count?: number
}

type ProductRecord = {
  id: number
  name: string
  sku: string
  category?: { name: string } | null
  selling_price: number | string
  stock_quantity: number
  minimum_stock_level: number
  status: string
}

type OrderRecord = {
  id: number
  order_number: string
  total: number | string
  status: string
  created_at: string
  customer?: { first_name: string; last_name: string } | null
}

type InvoiceRecord = {
  id: number
  invoice_number: string
  invoice_date: string
  due_date: string
  /** Backward-compatible collapsed value. Prefer payment_status / due_status. */
  status: string
  /** Payment progress: unpaid | partially_paid | paid */
  payment_status?: string
  /** Calendar lateness: current | overdue */
  due_status?: string
  total: number | string
  payments_sum_amount?: number | string
  customer?: { first_name: string; last_name: string } | null
}

type PaymentRecord = {
  id: number
  amount: number | string
  method: string
  payment_date: string
  invoice?: { invoice_number: string } | null
  customer?: { first_name: string; last_name: string } | null
}

type UserRecord = {
  id: number
  name: string
  email: string
  role: string
  is_active: boolean
  created_at: string
}

type AuditRecord = {
  id: number
  action: string
  entity: string
  entity_id?: number | null
  created_at: string
  user?: { name: string } | null
}

type SettingRecord = { key: string; value: unknown; group: string }

type NotificationRecord = {
  id: string
  read_at: string | null
  created_at: string
  data: { event?: string; message?: string }
}

/** Capability as reported by GET /v1/roles, derived from the backend routes. */
type RoleCapability = {
  key: string
  label: string
  permissions: Record<string, boolean>
  restricted: Record<string, boolean>
}

function App() {
  // Navigation state lives in the URL, so pages are deep-linkable and browser
  // back/forward work.
  const [page, setPage] = useState<PageKey>(() => pageFromPath(window.location.pathname))

  // Keep the URL in step with the active page; replacePage adds no history entry.
  useEffect(() => {
    replacePage(page)
  }, [page])

  useEffect(() => {
    const onPopState = () => setPage(pageFromPath(window.location.pathname))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const navigate = useCallback((next: PageKey) => {
    pushPage(next)
    setPage(next)
  }, [])
  const [theme, setTheme] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem('nexora-theme') as ThemeMode | null
    if (saved === 'light' || saved === 'dark') return saved

    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [searchOpen, setSearchOpen] = useState(false)
  const [globalSearch, setGlobalSearch] = useState('')
  const [searchResults, setSearchResults] = useState<SearchResult[]>([])
  const [searchError, setSearchError] = useState('')
  const [searchLoading, setSearchLoading] = useState(false)
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const [unreadNotifications, setUnreadNotifications] = useState(0)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const [notificationError, setNotificationError] = useState('')
  const [user, setUser] = useState<User | null>(null)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem('nexora-token'))
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null)
  const [capabilities, setCapabilities] = useState<RoleCapability[]>([])
  const [sessionError, setSessionError] = useState('')
  const [dashboardError, setDashboardError] = useState('')
  const [authError, setAuthError] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('nexora-theme', theme)
  }, [theme])

  const signOut = useCallback((message = '') => {
    localStorage.removeItem('nexora-token')
    setToken(null)
    setUser(null)
    setDashboard(null)
    setCapabilities([])
    setSessionError(message)
  }, [])

  /**
   * Load the session.
   *
   * Only a 401 means the token is no longer usable. A 403 is a disabled account or
   * a role gate, a 5xx is a server fault and a dropped connection is a network
   * fault: none of them justify deleting the token, which previously signed the user
   * out whenever the backend was briefly unreachable.
   */
  useEffect(() => {
    if (!token) {
      setUser(null)
      return
    }

    let active = true

    const loadSession = async () => {
      setIsAuthLoading(true)
      setSessionError('')

      try {
        const response = await apiFetch<{ user: User }>('/v1/user', { method: 'GET' }, token)
        if (!active) return
        setUser(response.user)
        setSessionError('')

        // A failed dashboard must not invalidate an otherwise valid session.
        try {
          const dashboardResponse = await apiFetch<DashboardResponse>('/v1/dashboard', { method: 'GET' }, token)
          if (active) setDashboard(dashboardResponse)
        } catch (dashboardError) {
          if (!active) return
          if (dashboardError instanceof ApiError && dashboardError.isAuthFailure) {
            signOut('Your session has expired. Please sign in again.')
            return
          }
          if (active) setDashboardError(describeError(dashboardError, 'Unable to load the dashboard.'))
        }
      } catch (error) {
        if (!active) return
        if (error instanceof ApiError && error.isAuthFailure) {
          signOut('Your session has expired. Please sign in again.')
          return
        }
        setSessionError(describeError(error, 'Unable to reach the server.'))
      } finally {
        if (active) setIsAuthLoading(false)
      }
    }

    void loadSession()

    return () => {
      active = false
    }
  }, [token, signOut])

  /**
   * Dashboard refresh, called after a mutation that changes any KPI.
   *
   * Targeted rather than a blanket reload: only the dashboard re-fetches, and only
   * when something that affects it actually changed.
   */
  const refreshDashboard = useCallback(async () => {
    if (!token) return
    try {
      const response = await apiFetch<DashboardResponse>('/v1/dashboard', { method: 'GET' }, token)
      setDashboard(response)
      setDashboardError('')
    } catch (error) {
      if (error instanceof ApiError && error.isAuthFailure) signOut('Your session has expired. Please sign in again.')
    }
  }, [token, signOut])

  // Reload the KPIs when returning to the dashboard so a payment recorded on
  // another page is reflected without a manual refresh.
  useEffect(() => {
    if (token && page === 'dashboard') void refreshDashboard()
  }, [token, page, refreshDashboard])

  // Role capabilities come from the backend; they decide which navigation items
  // are shown. The backend still enforces every one of them.
  const isAdministrator = user?.role === 'administrator'

  useEffect(() => {
    if (!token || !isAdministrator) {
      setCapabilities([])
      return
    }

    let active = true
    void apiFetch<{ data: RoleCapability[] }>('/v1/roles', {}, token)
      .then((response) => {
        if (active) setCapabilities(response.data)
      })
      .catch(() => {
        if (active) setCapabilities([])
      })

    return () => {
      active = false
    }
  }, [token, isAdministrator])

  const visibleNavGroups = useMemo(
    () =>
      NAV_GROUPS.map((group) => ({
        ...group,
        items: group.items.filter((item) => {
          // Administration is administrator only. Until the capability list has
          // loaded, hide it rather than showing links that would 403.
          if (item.key === 'users' || item.key === 'roles' || item.key === 'audit' || item.key === 'settings') {
            return isAdministrator && (capabilities.length === 0 || capabilities.some((capability) => capability.key === item.key && capability.permissions.administrator))
          }
          return true
        }),
      })).filter((group) => group.items.length > 0),
    [isAdministrator, capabilities],
  )

  useEffect(() => {
    if (!token || globalSearch.trim().length < 2) {
      setSearchResults([])
      setSearchError('')
      setSearchLoading(false)
      return
    }

    const controller = new AbortController()

    const timer = window.setTimeout(() => {
      setSearchLoading(true)
      const query = new URLSearchParams({ search: globalSearch.trim(), per_page: '4' })
      // Each endpoint settles on its own: one forbidden report must not hide the
      // results the caller is allowed to see.
      const sources: Array<Promise<Array<{ title: string; type: string; meta: string; page: PageKey }>>> = [
        apiFetch<PaginatedResponse<CustomerRecord>>(`/v1/customers?${query}`, { signal: controller.signal }, token)
          .then((response) => response.data.map((customer) => ({ title: `${customer.first_name} ${customer.last_name}`.trim(), type: 'Customer', meta: customer.company || customer.email || '', page: 'customers' as const }))),
        apiFetch<PaginatedResponse<ProductRecord>>(`/v1/products?${query}`, { signal: controller.signal }, token)
          .then((response) => response.data.map((product) => ({ title: product.name, type: 'Product', meta: `SKU ${product.sku}`, page: 'products' as const }))),
        apiFetch<PaginatedResponse<OrderRecord>>(`/v1/orders?${query}`, { signal: controller.signal }, token)
          .then((response) => response.data.map((order) => ({ title: order.order_number, type: 'Order', meta: formatCurrency(toNumber(order.total)), page: 'orders' as const }))),
        apiFetch<PaginatedResponse<InvoiceRecord>>(`/v1/invoices?${query}`, { signal: controller.signal }, token)
          .then((response) => response.data.map((invoice) => ({ title: invoice.invoice_number, type: 'Invoice', meta: formatCurrency(toNumber(invoice.total)), page: 'invoices' as const }))),
      ]

      void Promise.allSettled(sources).then((outcomes) => {
        if (controller.signal.aborted) return

        const results: SearchResult[] = []
        let failure: string | null = null

        for (const outcome of outcomes) {
          if (outcome.status === 'fulfilled') {
            results.push(...outcome.value)
          } else {
            const reason = outcome.reason
            failure ??= reason instanceof ApiError ? reason.message : 'Search failed.'
          }
        }

        setSearchResults(results)
        setSearchError(failure ?? '')
        setSearchLoading(false)
      })
    }, 250)

    return () => {
      window.clearTimeout(timer)
      controller.abort()
    }
  }, [globalSearch, token])

  useEffect(() => {
    if (!token) {
      setNotifications([])
      setUnreadNotifications(0)
      return
    }

    let active = true
    void apiFetch<{ unread_count: number; notifications: PaginatedResponse<NotificationRecord> }>('/v1/notifications', {}, token)
      .then((response) => {
        if (!active) return
        setNotifications(response.notifications.data)
        setUnreadNotifications(response.unread_count)
      })
      .catch(() => {
        if (active) setNotifications([])
      })
    return () => { active = false }
  }, [token])

  const currentSection = useMemo(
    () => visibleNavGroups.flatMap((group) => group.items).find((item) => item.key === page)?.label ?? 'Dashboard',
    [page, visibleNavGroups],
  )

  const handleLogout = async () => {
    if (token) {
      await apiFetch('/v1/logout', { method: 'POST' }, token).catch(() => null)
    }
    signOut()
  }

  const handleMarkAllNotificationsRead = async () => {
    if (!token) return
    try {
      await apiFetch('/v1/notifications/read-all', { method: 'PATCH' }, token)
      setNotifications((current) => current.map((notification) => ({ ...notification, read_at: notification.read_at ?? new Date().toISOString() })))
      setUnreadNotifications(0)
    } catch (error) {
      setNotificationError(describeError(error, 'Unable to update notifications.'))
    }
  }

  const handleMarkNotificationRead = async (notification: NotificationRecord) => {
    if (!token || notification.read_at) return
    setNotificationError('')
    try {
      await apiFetch(`/v1/notifications/${notification.id}/read`, { method: 'PATCH' }, token)
      setNotifications((current) => current.map((item) => item.id === notification.id ? { ...item, read_at: new Date().toISOString() } : item))
      setUnreadNotifications((count) => Math.max(0, count - 1))
    } catch (requestError) {
      setNotificationError(requestError instanceof Error ? requestError.message : 'Unable to update notification.')
    }
  }

  const handleLogin = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    const email = String(form.get('email') ?? '')
    const password = String(form.get('password') ?? '')

    setAuthError('')
    setIsAuthLoading(true)

    try {
      const response = await apiFetch<{ token: string; user: User }>('/v1/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      })

      localStorage.setItem('nexora-token', response.token)
      setToken(response.token)
      setUser(response.user)
    } catch (error) {
      setAuthError(describeError(error, 'Unable to sign in.'))
    } finally {
      setIsAuthLoading(false)
    }
  }

  if (!user) {
    return (
      <div className="login-shell">
        <div className="login-card">
          <div className="brand-wrap login-brand">
            <div className="brand-mark" aria-label="Nexora brand mark">
              <span>N</span>
            </div>
            <div>
              <div className="brand-title">Nexora ERP</div>
              <div className="brand-subtitle">Manage your business. Smarter.</div>
            </div>
          </div>

          <h1>Sign in</h1>
          <p className="page-subtitle">Connect to the ERP dashboard and continue with your operations.</p>

          {sessionError ? <div className="auth-error" role="alert">{sessionError}</div> : null}

          <form className="login-form" onSubmit={handleLogin}>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>

            {authError ? <div className="auth-error" role="alert">{authError}</div> : null}

            <button type="submit" className="primary-button" disabled={isAuthLoading}>
              {isAuthLoading ? 'Signing in...' : 'Login'}
            </button>
          </form>

        </div>
      </div>
    )
  }

  const renderContent = () => {
    switch (page) {
      case 'customers':
        return <CustomersPage token={token!} onChanged={refreshDashboard} />
      case 'products':
        return <ProductsPage token={token!} onChanged={refreshDashboard} />
      case 'orders':
        return <OrdersPage token={token!} onChanged={refreshDashboard} />
      case 'invoices':
        return <InvoicesPage token={token!} onChanged={refreshDashboard} />
      case 'payments':
        return <PaymentsPage token={token!} onChanged={refreshDashboard} />
      case 'inventory':
        return <InventoryPage token={token!} onChanged={refreshDashboard} />
      case 'reports':
        return <ReportsPage token={token!} />
      case 'users':
        return <UsersPage token={token!} />
      case 'roles':
        return <RolesPage token={token!} />
      case 'audit':
        return <AuditPage token={token!} />
      case 'settings':
        return <SettingsPage token={token!} />
      default:
        return <DashboardPage dashboard={dashboard} userName={user.name} />
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="brand-wrap">
          <div className="brand-mark" aria-label="Nexora brand mark">
            <span>N</span>
          </div>
          <div>
            <div className="brand-title">Nexora ERP</div>
            <div className="brand-subtitle">Manage your business. Smarter.</div>
          </div>
        </div>

        <nav className="sidebar-nav" aria-label="Main navigation">
          {visibleNavGroups.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`nav-item ${page === item.key ? 'active' : ''}`}
                  onClick={() => {
                    navigate(item.key)
                    setSidebarOpen(false)
                  }}
                >
                  <span className="nav-icon">{renderIcon(item.key)}</span>
                  <span>{item.label}</span>
                  {item.badge ? <span className="nav-badge">{item.badge}</span> : null}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="user-pill">
            <div className="avatar avatar-sm">{initials(user.name)}</div>
            <div>
              <strong>{user.name}</strong>
              <small>{user.email}</small>
            </div>
          </div>
        </div>
      </aside>

      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button mobile-only"
              onClick={() => setSidebarOpen((open) => !open)}
              aria-label="Toggle sidebar"
            >
              <MenuIcon />
            </button>
            <div className="breadcrumbs" aria-label="Breadcrumbs">
              <span>Home</span>
              <span> / </span>
              <span>{currentSection}</span>
            </div>
          </div>

          <div className="topbar-actions">
            <div className="search-box" onBlur={() => setTimeout(() => setSearchOpen(false), 120)}>
              <SearchIcon />
              <input
                type="text"
                aria-label="Global search"
                placeholder="Search customers, products, orders..."
                value={globalSearch}
                onChange={(event) => setGlobalSearch(event.target.value)}
                onFocus={() => setSearchOpen(true)}
              />
              {searchOpen ? (
                <div className="search-dropdown" role="listbox" aria-label="Search results">
                  {globalSearch.trim().length < 2 ? <div className="search-result">Type at least 2 characters to search.</div> : null}
                  {searchLoading ? <div className="search-result">Searching...</div> : null}
                  {searchError ? <div className="search-result" role="alert">{searchError}</div> : null}
                  {searchResults.map((result) => (
                    <button key={`${result.type}-${result.title}`} type="button" className="search-result" onMouseDown={(event) => event.preventDefault()} onClick={() => {
                      navigate(result.page)
                      setGlobalSearch('')
                      setSearchOpen(false)
                    }}>
                      <span className="search-result-type">{result.type}</span>
                      <span className="search-result-title">{result.title}</span>
                      <small>{result.meta}</small>
                    </button>
                  ))}
                  {globalSearch.trim().length >= 2 && !searchLoading && !searchError && searchResults.length === 0 ? <div className="search-result">No matching records.</div> : null}
                </div>
              ) : null}
            </div>

            <div className="notification-wrap">
              <button type="button" className="icon-button" aria-label={`Notifications, ${unreadNotifications} unread`} onClick={() => setNotificationsOpen((open) => !open)}>
                <BellIcon />
                {unreadNotifications > 0 ? <span className="dot" /> : null}
              </button>
              {notificationsOpen ? <div className="notification-popover">
                <div className="notification-popover-head"><strong>Notifications</strong><button type="button" className="table-action" onClick={() => void handleMarkAllNotificationsRead()}>Mark all read</button></div>
                {notificationError ? <p role="alert">{notificationError}</p> : null}
                {notifications.length === 0 ? <p>No notifications yet.</p> : notifications.map((notification) => <button type="button" className={`notification-entry ${notification.read_at ? '' : 'unread'}`} key={notification.id} onClick={() => void handleMarkNotificationRead(notification)}>
                  <strong>{notification.data.event?.replaceAll('_', ' ') ?? 'Update'}</strong>
                  <span>{notification.data.message ?? 'Business activity update.'}</span>
                  <small>{new Date(notification.created_at).toLocaleString()}</small>
                </button>)}
              </div> : null}
            </div>

            <button
              type="button"
              className="theme-toggle"
              onClick={() => setTheme((current) => (current === 'light' ? 'dark' : 'light'))}
              aria-label="Toggle color theme"
            >
              {theme === 'light' ? <MoonIcon /> : <SunIcon />}
            </button>

            <button type="button" className="profile-button" aria-label={`Sign out ${user.name}`} onClick={() => void handleLogout()}>
              <div className="avatar avatar-md">{initials(user.name)}</div>
              <div>
                <strong>{user.name}</strong>
                <small>{user.role}</small>
              </div>
              <ChevronDownIcon />
            </button>
          </div>
        </header>

        <div className="page-shell">
          {dashboardError ? (
            <div className="auth-error" role="alert">
              {dashboardError}{' '}
              <button type="button" className="table-action" onClick={() => void refreshDashboard()}>
                Retry
              </button>
            </div>
          ) : null}
          {renderContent()}
        </div>
      </main>
    </div>
  )
}

function DashboardPage({
  dashboard,
  userName,
}: {
  dashboard: DashboardResponse | null
  userName: string
}) {
  const kpis = [
    {
      label: 'Revenue',
      value: formatCurrency(toNumber(dashboard?.kpis?.total_revenue)),
      change: 'Live',
      detail: 'recorded payments',
    },
    {
      label: 'Orders',
      value: formatNumber(toNumber(dashboard?.kpis?.total_orders)),
      change: 'Live',
      detail: 'all orders',
    },
    {
      label: 'Customers',
      value: formatNumber(toNumber(dashboard?.kpis?.total_customers)),
      change: 'Live',
      detail: 'registered customers',
    },
    {
      label: 'Outstanding',
      value: formatCurrency(toNumber(dashboard?.kpis?.outstanding_payments)),
      change: 'Live',
      detail: 'open invoice balance',
    },
  ]

  const recentOrders = (dashboard?.recent_orders ?? []).slice(0, 4).map((order) => ({
    id: order.order_number ?? `ORD-${order.id}`,
    customer: `${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim() || 'Customer',
    amount: formatCurrency(toNumber(order.total)),
    status: order.status ?? 'pending',
    date: formatDate(order.created_at),
  }))

  const topProducts = (dashboard?.top_products ?? []).slice(0, 4).map((product) => ({
    name: product.name,
    sales: `${product.quantity} units`,
  }))
  const dailySales = dashboard?.sales_over_time ?? []
  const revenueSeries = dailySales.map((point) => toNumber(point.total))
  const orderSeries = dailySales.map((point) => toNumber(point.orders))
  const recentRevenue = revenueSeries.reduce((total, value) => total + value, 0)
  const recentOrderCount = orderSeries.reduce((total, value) => total + value, 0)

  return (
    <>
      <div className="page-header-row">
        <div>
          <p className="eyebrow">Good morning, {userName.split(' ')[0]}</p>
          <h1>Here’s what’s happening with your business today.</h1>
        </div>
        <span className="page-subtitle">Last 30 days</span>
      </div>

      <section className="kpi-grid">
        {kpis.map((card) => (
          <div key={card.label} className="kpi-card">
            <div className="kpi-header">
              <span className="kpi-icon">{renderIcon('dashboard')}</span>
              <span className="chip positive">{card.change}</span>
            </div>
            <div className="kpi-label">{card.label}</div>
            <div className="kpi-value">{card.value}</div>
            <div className="kpi-detail">{card.detail}</div>
          </div>
        ))}
      </section>

      <section className="chart-grid">
        <div className="panel span-2">
          <div className="panel-head">
            <div>
              <span className="panel-label">Revenue</span>
              <h2>{formatCurrency(recentRevenue)}</h2>
            </div>
            <span className="chip positive">30 days</span>
          </div>
          <RevenueChart data={revenueSeries} />
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-label">Sales</span>
              <h2>{formatNumber(recentOrderCount)}</h2>
            </div>
          </div>
          <SalesChart data={orderSeries} />
        </div>
      </section>

      <section className="bottom-grid">
        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-label">Top products</span>
              <h2>Best sellers</h2>
            </div>
          </div>
          <div className="product-rankings">
            {topProducts.map((product, index) => (
              <div key={product.name} className="ranking-row">
                <div className="rank-number">0{index + 1}</div>
                <div className="rank-copy">
                  <strong>{product.name}</strong>
                  <small>{product.sales}</small>
                </div>
                <span className="chip positive">{product.sales}</span>
              </div>
            ))}
            {topProducts.length === 0 ? <p>No product sales recorded yet.</p> : null}
          </div>
        </div>

        <div className="panel">
          <div className="panel-head">
            <div>
              <span className="panel-label">Recent Orders</span>
              <h2>Latest activity</h2>
            </div>
          </div>

          <div className="table-like">
            {recentOrders.map((order) => (
              <div className="table-row" key={order.id}>
                <div>
                  <strong>{order.id}</strong>
                  <small>{order.customer}</small>
                </div>
                <div>
                  <strong>{order.amount}</strong>
                  <small>{order.date}</small>
                </div>
                <span className={`status-badge ${statusClass(order.status)}`}>{statusLabel(order.status)}</span>
              </div>
            ))}
            {recentOrders.length === 0 ? <p>No recent orders.</p> : null}
          </div>
        </div>
      </section>
    </>
  )
}

function CustomersPage({ token, onChanged }: PageProps) {
  const [search, setSearch] = useState('')
  const [city, setCity] = useState('')
  const [exporting, setExporting] = useState(false)
  const [exportError, setExportError] = useState('')
  const { result, error, errorMessage, loading, page, setPage, reload } = useApiList<CustomerRecord>('customers', token, search, { params: { city: city || undefined } })
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldError, formError, reset, capture } = useFormErrors()

  const createCustomer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setSaving(true)
    reset()
    try {
      await apiFetch('/v1/customers', {
        method: 'POST',
        body: JSON.stringify({
          first_name: values.get('first_name'),
          last_name: values.get('last_name'),
          company: values.get('company') || null,
          email: values.get('email') || null,
          phone: values.get('phone') || null,
        }),
      }, token)
      setFormOpen(false)
      form.reset()
      reload()
      await onChanged?.()
    } catch (requestError) {
      capture(requestError, 'Unable to create customer.')
    } finally {
      setSaving(false)
    }
  }

  /**
   * Export the current filter as CSV.
   *
   * Walks the same paginated endpoint the table uses so the file matches what is
   * on screen instead of a truncated first page.
   */
  const exportCustomers = async () => {
    setExporting(true)
    setExportError('')
    try {
      const rows: string[][] = [['ID', 'First name', 'Last name', 'Company', 'Email', 'Phone']]
      let currentPage = 1
      let lastPage = 1

      do {
        const query = new URLSearchParams({ per_page: '100', page: String(currentPage) })
        if (search.trim()) query.set('search', search.trim())
        if (city) query.set('city', city)

        const response = await apiFetch<PaginatedResponse<CustomerRecord>>(`/v1/customers?${query}`, {}, token)
        for (const customer of response.data) {
          rows.push([
            String(customer.id),
            customer.first_name,
            customer.last_name,
            customer.company ?? '',
            customer.email ?? '',
            customer.phone ?? '',
          ])
        }
        lastPage = Math.max(response.last_page, 1)
        currentPage += 1
      } while (currentPage <= lastPage)

      const csv = rows
        .map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(','))
        .join('\r\n')

      const url = URL.createObjectURL(new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' }))
      const link = document.createElement('a')
      link.href = url
      link.download = `customers-${new Date().toISOString().slice(0, 10)}.csv`
      link.click()
      URL.revokeObjectURL(url)
    } catch (requestError) {
      setExportError(describeError(requestError, 'Unable to export customers.'))
    } finally {
      setExporting(false)
    }
  }

  return (
    <>
      <div className="page-header-row page-header-stack">
        <div>
          <p className="eyebrow">CRM</p>
          <h1>Customers</h1>
          <p className="page-subtitle">Manage your customers and business relationships.</p>
        </div>
        <button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Add Customer'}</button>
      </div>

      {formOpen ? <form className="resource-form panel" onSubmit={createCustomer}>
        <label>First name<input name="first_name" required maxLength={100} aria-describedby={fieldError('first_name') ? 'first_name-error' : undefined} /></label>
        <FieldError id="first_name-error" message={fieldError('first_name')} />
        <label>Last name<input name="last_name" required maxLength={100} aria-describedby={fieldError('last_name') ? 'last_name-error' : undefined} /></label>
        <FieldError id="last_name-error" message={fieldError('last_name')} />
        <label>Company<input name="company" maxLength={255} /></label>
        <label>Email<input name="email" type="email" aria-describedby={fieldError('email') ? 'email-error' : undefined} /></label>
        <FieldError id="email-error" message={fieldError('email')} />
        <label>Phone<input name="phone" type="tel" maxLength={40} /></label>
        {formError ? <p role="alert">{formError}</p> : null}
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create customer'}</button>
      </form> : null}

      <div className="toolbar panel">
        <div className="toolbar-group">
          <SearchIcon />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" aria-label="Search customers" />
        </div>
        <div className="toolbar-actions">
          <input
            className="toolbar-filter"
            type="text"
            value={city}
            onChange={(event) => setCity(event.target.value)}
            placeholder="Filter by city"
            aria-label="Filter by city"
          />
          {city ? <button type="button" className="table-action" onClick={() => setCity('')}>Clear filter</button> : null}
          <button type="button" className="secondary-button" onClick={() => void exportCustomers()} disabled={exporting}>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>
      </div>
      {exportError ? <p className="auth-error" role="alert">{exportError}</p> : null}

      <div className="panel table-panel">
        <table>
          <thead>
            <tr>
              <th>Customer</th>
              <th>Company</th>
              <th>Email</th>
              <th>Phone</th>
              <th>Orders</th>
              <th>Invoices</th>
            </tr>
          </thead>
          <tbody>
            {loading ? <tr><td colSpan={6}>Loading customers...</td></tr> : null}
            {error ? <tr><td colSpan={6}><span role="alert">{errorMessage}</span></td></tr> : null}
            {!loading && !error && result?.data.map((customer) => {
              const name = `${customer.first_name} ${customer.last_name}`.trim()
              return (
              <tr key={customer.id}>
                <td>
                  <div className="user-cell">
                    <div className="avatar avatar-xs">{initials(name)}</div>
                    <div>
                      <strong>{name}</strong>
                    </div>
                  </div>
                </td>
                <td>{customer.company || '—'}</td>
                <td>{customer.email || '—'}</td>
                <td>{customer.phone || '—'}</td>
                <td>{customer.orders_count ?? 0}</td>
                <td>{customer.invoices_count ?? 0}</td>
              </tr>
            )})}
            {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={6}>No customers found.</td></tr> : null}
          </tbody>
        </table>
      </div>

      <Pagination
        currentPage={result?.current_page ?? page}
        lastPage={result?.last_page ?? 1}
        total={result?.total ?? 0}
        loading={loading}
        onPageChange={setPage}
      />
    </>
  )
}

function ProductsPage({ token, onChanged }: PageProps) {
  const [search, setSearch] = useState('')
  const { result, error, errorMessage, loading, page, setPage, reload } = useApiList<ProductRecord>('products', token, search)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldError, formError, reset, capture } = useFormErrors()

  const createProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setSaving(true)
    reset()
    try {
      await apiFetch('/v1/products', {
        method: 'POST',
        body: JSON.stringify({
          name: values.get('name'),
          sku: values.get('sku'),
          selling_price: Number(values.get('selling_price')),
          stock_quantity: Number(values.get('stock_quantity') || 0),
          minimum_stock_level: Number(values.get('minimum_stock_level') || 0),
        }),
      }, token)
      form.reset()
      setFormOpen(false)
      reload()
      await onChanged?.()
    } catch (requestError) {
      capture(requestError, 'Unable to create product.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Catalog</p><h1>Products</h1><p className="page-subtitle">Track inventory, pricing and product performance.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Add Product'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={createProduct}>
      <label>Product name<input name="name" required maxLength={255} aria-describedby={fieldError('name') ? 'product-name-error' : undefined} /></label>
      <FieldError id="product-name-error" message={fieldError('name')} />
      <label>SKU<input name="sku" required maxLength={100} aria-describedby={fieldError('sku') ? 'sku-error' : undefined} /></label>
      <FieldError id="sku-error" message={fieldError('sku')} />
      <label>Price<input name="selling_price" type="number" min="0.001" step="0.001" required aria-describedby={fieldError('selling_price') ? 'price-error' : undefined} /></label>
      <FieldError id="price-error" message={fieldError('selling_price')} />
      <label>Opening stock<input name="stock_quantity" type="number" min="0" step="1" defaultValue="0" /></label>
      <label>Low-stock threshold<input name="minimum_stock_level" type="number" min="0" step="1" defaultValue="0" /></label>
      {formError ? <p role="alert">{formError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Create product'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /></div></div>
    <div className="products-grid">
      {loading ? <div className="panel">Loading products...</div> : null}
      {error ? <div className="panel" role="alert">{errorMessage}</div> : null}
      {!loading && !error && result?.data.map((product) => {
        const stockStatus = stockLabel(product.stock_quantity, product.minimum_stock_level)
        return <div key={product.id} className="panel product-card">
          <div className="product-card-top"><div className="product-image">{initials(product.name)}</div><span className={`status-badge ${stockClass(product.stock_quantity, product.minimum_stock_level)}`}>{stockStatus}</span></div>
          <div className="product-info"><strong>{product.name}</strong><small>{product.sku}</small></div>
          <div className="product-meta"><span>{product.category?.name ?? 'Uncategorized'}</span><span>{formatCurrency(toNumber(product.selling_price))}</span></div>
          <div className="product-footer"><div><small>Stock</small><strong>{product.stock_quantity}</strong></div></div>
        </div>
      })}
      {!loading && !error && result?.data.length === 0 ? <div className="panel">No products found.</div> : null}
    </div>
    <Pagination
      currentPage={result?.current_page ?? page}
      lastPage={result?.last_page ?? 1}
      total={result?.total ?? 0}
      loading={loading}
      onPageChange={setPage}
    />
  </>
}

function OrdersPage({ token, onChanged }: PageProps) {
  const [search, setSearch] = useState('')
  const { result, error, errorMessage, loading, page, setPage, reload } = useApiList<OrderRecord>('orders', token, search)
  const customers = useApiList<CustomerRecord>('customers', token, '', { perPage: 100 })
  const products = useApiList<ProductRecord>('products', token, '', { perPage: 100 })
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldError, formError, reset, capture } = useFormErrors()

  const advanceOrder = async (order: OrderRecord) => {
    const nextStatus = { pending: 'confirmed', confirmed: 'processing', processing: 'completed' }[order.status]
    if (!nextStatus) return
    reset()
    try {
      await apiFetch(`/v1/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }, token)
      reload()
      // Completing an order moves stock and changes the dashboard KPIs.
      await onChanged?.()
    } catch (requestError) {
      capture(requestError, 'Unable to update order status.')
    }
  }

  const createOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    reset()
    try {
      await apiFetch('/v1/orders', {
        method: 'POST',
        body: JSON.stringify({
          customer_id: Number(values.get('customer_id')),
          items: [{ product_id: Number(values.get('product_id')), quantity: Number(values.get('quantity')) }],
        }),
      }, token)
      setFormOpen(false)
      reload()
      await onChanged?.()
    } catch (requestError) {
      capture(requestError, 'Unable to create order.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Sales</p><h1>Orders</h1><p className="page-subtitle">Track sales progress and fulfillment.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Create Order'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={createOrder}>
      <label>Customer<select name="customer_id" required defaultValue=""><option value="" disabled>Select customer</option>{customers.result?.data.map((customer) => <option value={customer.id} key={customer.id}>{customer.first_name} {customer.last_name}</option>)}</select></label>
      <label>Product<select name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{products.result?.data.filter((product) => product.status === 'active' && product.stock_quantity > 0).map((product) => <option value={product.id} key={product.id}>{product.name} ({product.stock_quantity} available)</option>)}</select></label>
      <label>Quantity<input name="quantity" type="number" min="1" step="1" defaultValue="1" required /></label>
      {customers.error || products.error ? <p role="alert">{customers.errorMessage || products.errorMessage}</p> : null}
      {formError ? <p role="alert">{formError}</p> : null}
      {fieldError('items') ? <FieldError message={fieldError('items')} /> : null}
      <button type="submit" className="primary-button" disabled={saving || customers.loading || products.loading || !customers.result?.data.length || !products.result?.data.length}>{saving ? 'Creating...' : 'Create order'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders or customers" aria-label="Search orders" /></div></div>
    {formError ? <p className="auth-error" role="alert">{formError}</p> : null}
    <div className="panel table-panel"><table>
      <thead><tr><th>Order ID</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>
        {loading ? <tr><td colSpan={6}>Loading orders...</td></tr> : null}
        {error ? <tr><td colSpan={6}><span role="alert">{errorMessage}</span></td></tr> : null}
        {!loading && !error && result?.data.map((order) => <tr key={order.id}>
          <td>{order.order_number}</td><td>{`${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim() || '—'}</td>
          <td>{formatCurrency(toNumber(order.total))}</td><td><span className={`status-badge ${statusClass(order.status)}`}>{statusLabel(order.status)}</span></td><td>{formatDate(order.created_at)}</td>
          <td>{['pending', 'confirmed', 'processing'].includes(order.status) ? <button type="button" className="table-action" onClick={() => void advanceOrder(order)}>{order.status === 'processing' ? 'Complete' : 'Advance'}</button> : '—'}</td>
        </tr>)}
        {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={6}>No orders found.</td></tr> : null}
      </tbody>
    </table></div>
    <Pagination
      currentPage={result?.current_page ?? page}
      lastPage={result?.last_page ?? 1}
      total={result?.total ?? 0}
      loading={loading}
      onPageChange={setPage}
    />
  </>
}

function InvoicesPage({ token, onChanged }: PageProps) {
  const [search, setSearch] = useState('')
  const { result, error, errorMessage, loading, page, setPage, reload } = useApiList<InvoiceRecord>('invoices', token, search)
  const orders = useApiList<OrderRecord>('orders', token, '', { perPage: 100 })
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldError, formError, reset, capture } = useFormErrors()

  const createInvoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    reset()
    try {
      await apiFetch('/v1/invoices', { method: 'POST', body: JSON.stringify({ order_id: Number(values.get('order_id')) }) }, token)
      setFormOpen(false)
      reload()
      await onChanged?.()
    } catch (requestError) {
      capture(requestError, 'Unable to create invoice.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Sales</p><h1>Invoices</h1><p className="page-subtitle">Invoice balances and payment status.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Create Invoice'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={createInvoice}>
      <label>Eligible order<select name="order_id" required defaultValue=""><option value="" disabled>Select confirmed order</option>{orders.result?.data.filter((order) => ['confirmed', 'processing', 'completed'].includes(order.status)).map((order) => <option value={order.id} key={order.id}>{order.order_number} · {formatCurrency(toNumber(order.total))}</option>)}</select></label>
      {orders.error ? <p role="alert">{orders.errorMessage}</p> : null}{formError ? <p role="alert">{formError}</p> : null}
      {fieldError('order_id') ? <FieldError message={fieldError('order_id')} /> : null}
      <button type="submit" className="primary-button" disabled={saving || orders.loading}>{saving ? 'Creating...' : 'Create invoice'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoices or customers" aria-label="Search invoices" /></div></div>
    <div className="panel table-panel"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Invoice date</th><th>Due date</th><th>Total</th><th>Paid</th><th>Payment</th><th>Due</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={8}>Loading invoices...</td></tr> : null}
      {error ? <tr><td colSpan={8}><span role="alert">{errorMessage}</span></td></tr> : null}
      {!loading && !error && result?.data.map((invoice) => {
        // Payment progress and lateness are separate facts; showing only the
        // collapsed status hid that an invoice was 90% paid AND past due.
        const paymentStatus = invoice.payment_status ?? invoice.status
        const dueStatus = invoice.due_status ?? ''
        return <tr key={invoice.id}>
          <td>{invoice.invoice_number}</td><td>{`${invoice.customer?.first_name ?? ''} ${invoice.customer?.last_name ?? ''}`.trim() || '—'}</td>
          <td>{formatDate(invoice.invoice_date)}</td><td>{formatDate(invoice.due_date)}</td><td>{formatCurrency(toNumber(invoice.total))}</td><td>{formatCurrency(toNumber(invoice.payments_sum_amount ?? 0))}</td>
          <td><span className={`status-badge ${statusClass(paymentStatus)}`}>{statusLabel(paymentStatus)}</span></td>
          <td>{dueStatus ? <span className={`status-badge ${dueStatus === 'overdue' ? 'danger' : 'neutral'}`}>{statusLabel(dueStatus)}</span> : '—'}</td>
        </tr>
      })}
      {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={8}>No invoices found.</td></tr> : null}
    </tbody></table></div>
    <Pagination
      currentPage={result?.current_page ?? page}
      lastPage={result?.last_page ?? 1}
      total={result?.total ?? 0}
      loading={loading}
      onPageChange={setPage}
    />
  </>
}

function PaymentsPage({ token, onChanged }: PageProps) {
  const [search, setSearch] = useState('')
  const { result, error, errorMessage, loading, page, setPage, reload } = useApiList<PaymentRecord>('payments', token, search)
  const invoices = useApiList<InvoiceRecord>('invoices', token, '', { perPage: 100 })
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldError, formError, reset, capture } = useFormErrors()

  const recordPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    reset()
    try {
      await apiFetch('/v1/payments', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: Number(values.get('invoice_id')), amount: Number(values.get('amount')), method: values.get('method') }),
      }, token)
      setFormOpen(false)
      reload()
      await onChanged?.()
    } catch (requestError) {
      capture(requestError, 'Unable to record payment.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Sales</p><h1>Payments</h1><p className="page-subtitle">Recorded customer payments.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Record Payment'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={recordPayment}>
      <label>Invoice<select name="invoice_id" required defaultValue="" aria-describedby={fieldError('invoice_id') ? 'invoice-error' : undefined}><option value="" disabled>Select open invoice</option>{invoices.result?.data.filter((invoice) => !['draft', 'cancelled', 'void'].includes(invoice.status) && invoice.payment_status !== 'paid').map((invoice) => <option value={invoice.id} key={invoice.id}>{invoice.invoice_number} · {formatCurrency(toNumber(invoice.total))}</option>)}</select></label>
      <FieldError id="invoice-error" message={fieldError('invoice_id')} />
      <label>Amount<input name="amount" type="number" min="0.001" step="0.001" required aria-describedby={fieldError('amount') ? 'amount-error' : undefined} /></label>
      <FieldError id="amount-error" message={fieldError('amount')} />
      <label>Method<select name="method" defaultValue="bank_transfer"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
      {invoices.error ? <p role="alert">{invoices.errorMessage}</p> : null}{formError ? <p role="alert">{formError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving || invoices.loading}>{saving ? 'Saving...' : 'Save payment'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice number" aria-label="Search payments" /></div></div>
    <div className="panel table-panel"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Payment date</th><th>Method</th><th>Amount</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5}>Loading payments...</td></tr> : null}
      {error ? <tr><td colSpan={5}><span role="alert">{errorMessage}</span></td></tr> : null}
      {!loading && !error && result?.data.map((payment) => <tr key={payment.id}>
        <td>{payment.invoice?.invoice_number ?? '—'}</td><td>{`${payment.customer?.first_name ?? ''} ${payment.customer?.last_name ?? ''}`.trim() || '—'}</td>
        <td>{formatDate(payment.payment_date)}</td><td>{statusLabel(payment.method)}</td><td>{formatCurrency(toNumber(payment.amount))}</td>
      </tr>)}
      {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={5}>No payments found.</td></tr> : null}
    </tbody></table></div>
    <Pagination
      currentPage={result?.current_page ?? page}
      lastPage={result?.last_page ?? 1}
      total={result?.total ?? 0}
      loading={loading}
      onPageChange={setPage}
    />
  </>
}

function InventoryPage({ token, onChanged }: PageProps) {
  const { result, error, errorMessage, loading, page, setPage, reload } = useApiList<ProductRecord>('inventory', token, '')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldError, formError, reset, capture } = useFormErrors()
  const products = result?.data ?? []
  const lowStock = products.filter((product) => product.stock_quantity <= product.minimum_stock_level)
  const metrics = [
    { label: 'Total products', value: formatNumber(result?.total ?? 0) },
    { label: 'Inventory value', value: formatCurrency(products.reduce((total, product) => total + product.stock_quantity * toNumber(product.selling_price), 0)) },
    { label: 'Low stock', value: formatNumber(lowStock.length) },
    { label: 'Out of stock', value: formatNumber(products.filter((product) => product.stock_quantity === 0).length) },
  ]

  const recordMovement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    reset()
    try {
      await apiFetch('/v1/inventory/movements', {
        method: 'POST',
        body: JSON.stringify({
          product_id: Number(values.get('product_id')),
          type: values.get('type'),
          quantity: Number(values.get('quantity')),
          reason: values.get('reason') || null,
        }),
      }, token)
      setFormOpen(false)
      reload()
      await onChanged?.()
    } catch (requestError) {
      capture(requestError, 'Unable to update stock.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Operations</p><h1>Inventory</h1><p className="page-subtitle">Monitor product availability and movement activity.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : 'Record Movement'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={recordMovement}>
      <label>Product<select name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.stock_quantity} available</option>)}</select></label>
      <label>Movement<select name="type" defaultValue="in"><option value="in">Stock in</option><option value="out">Stock out</option><option value="adjustment">Set stock level</option></select></label>
      <label>Quantity<input name="quantity" type="number" min="0" step="1" required aria-describedby={fieldError('quantity') ? 'quantity-error' : undefined} /></label>
      <FieldError id="quantity-error" message={fieldError('quantity')} />
      <label>Reason<input name="reason" maxLength={255} /></label>
      {formError ? <p role="alert">{formError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving || loading || products.length === 0}>{saving ? 'Saving...' : 'Save movement'}</button>
    </form> : null}
    <section className="kpi-grid inventory-grid">{metrics.map((metric) => <div className="kpi-card" key={metric.label}><div className="kpi-label">{metric.label}</div><div className="kpi-value">{metric.value}</div></div>)}</section>
    <div className="panel table-panel"><h3>Low stock</h3><table><thead><tr><th>Product</th><th>SKU</th><th>Available</th><th>Minimum</th><th>Status</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5}>Loading inventory...</td></tr> : null}
      {error ? <tr><td colSpan={5}><span role="alert">{errorMessage}</span></td></tr> : null}
      {!loading && !error && lowStock.map((product) => {
        const label = product.stock_quantity === 0 ? 'Out of Stock' : 'Low Stock'
        return <tr key={product.id}><td>{product.name}</td><td>{product.sku}</td><td>{product.stock_quantity}</td><td>{product.minimum_stock_level}</td><td><span className={`status-badge ${label === 'Out of Stock' ? 'danger' : 'warning'}`}>{label}</span></td></tr>
      })}
      {!loading && !error && lowStock.length === 0 ? <tr><td colSpan={5}>No low-stock products.</td></tr> : null}
    </tbody></table></div>
    <Pagination
      currentPage={result?.current_page ?? page}
      lastPage={result?.last_page ?? 1}
      total={result?.total ?? 0}
      loading={loading}
      onPageChange={setPage}
    />
  </>
}

function ReportsPage({ token }: { token: string }) {
  const [sales, setSales] = useState<Array<{ period: string; orders: number; revenue: number }>>([])
  const [bestSellers, setBestSellers] = useState<Array<{ name: string; quantity: number; revenue: number }>>([])
  // Each report carries its own error: the products report is administrator only,
  // so a shared Promise.all previously discarded the authorised sales report too.
  const [salesError, setSalesError] = useState('')
  const [productsError, setProductsError] = useState('')
  const [loadingSales, setLoadingSales] = useState(true)
  const [loadingProducts, setLoadingProducts] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    void apiFetch<{ sales: Array<{ period: string; orders: number; revenue: number }> }>('/v1/reports/sales?group=month', { signal: controller.signal }, token)
      .then((response) => {
        if (controller.signal.aborted) return
        setSales(response.sales)
        setSalesError('')
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return
        setSalesError(describeError(requestError, 'Unable to load the sales report.'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingSales(false)
      })

    void apiFetch<{ best_sellers: Array<{ name: string; quantity: number; revenue: number }> }>('/v1/reports/products', { signal: controller.signal }, token)
      .then((response) => {
        if (controller.signal.aborted) return
        setBestSellers(response.best_sellers)
        setProductsError('')
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return
        setProductsError(describeError(requestError, 'Unable to load the product report.'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoadingProducts(false)
      })

    return () => controller.abort()
  }, [token])

  return (
    <div className="panel report-panel">
      <h2>Sales overview</h2>

      <h3>Monthly sales</h3>
      {loadingSales ? <p>Loading sales report...</p> : null}
      {salesError ? <p role="alert">{salesError}</p> : null}
      {!loadingSales && !salesError ? <div className="table-panel"><table><thead><tr><th>Period</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>
        {sales.map((row) => <tr key={row.period}><td>{row.period}</td><td>{row.orders}</td><td>{formatCurrency(toNumber(row.revenue))}</td></tr>)}
        {sales.length === 0 ? <tr><td colSpan={3}>No completed sales in this period.</td></tr> : null}
      </tbody></table></div> : null}

      <h3>Best-selling products</h3>
      {loadingProducts ? <p>Loading product report...</p> : null}
      {productsError ? <p role="alert">{productsError}</p> : null}
      {!loadingProducts && !productsError ? <div className="table-panel"><table><thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead><tbody>
        {bestSellers.map((product) => <tr key={product.name}><td>{product.name}</td><td>{product.quantity}</td><td>{formatCurrency(toNumber(product.revenue))}</td></tr>)}
        {bestSellers.length === 0 ? <tr><td colSpan={3}>No completed product sales yet.</td></tr> : null}
      </tbody></table></div> : null}
    </div>
  )
}

function UsersPage({ token }: PageProps) {
  const { result, error, errorMessage, loading, page, setPage, reload } = useApiList<UserRecord>('users', token, '')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const { fieldError, formError, reset, capture } = useFormErrors()

  const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    reset()
    try {
      await apiFetch('/v1/users', {
        method: 'POST',
        body: JSON.stringify({
          name: values.get('name'),
          email: values.get('email'),
          role: values.get('role'),
          password: values.get('password'),
          password_confirmation: values.get('password_confirmation'),
        }),
      }, token)
      setFormOpen(false)
      reload()
    } catch (requestError) {
      capture(requestError, 'Unable to create user.')
    } finally {
      setSaving(false)
    }
  }

  const updateUser = async (user: UserRecord, changes: Partial<Pick<UserRecord, 'role' | 'is_active'>>) => {
    reset()
    try {
      await apiFetch(`/v1/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(changes) }, token)
      reload()
    } catch (requestError) {
      capture(requestError, 'Unable to update user.')
    }
  }

  return (
    <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Administration</p><h1>Users</h1><p className="page-subtitle">Manage account access and roles.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Add User'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={createUser}>
      <label>Name<input name="name" required maxLength={255} aria-describedby={fieldError('name') ? 'user-name-error' : undefined} /></label>
      <FieldError id="user-name-error" message={fieldError('name')} />
      <label>Email<input name="email" type="email" required aria-describedby={fieldError('email') ? 'user-email-error' : undefined} /></label>
      <FieldError id="user-email-error" message={fieldError('email')} />
      <label>Role<select name="role" defaultValue="employee"><option value="employee">Employee</option><option value="administrator">Administrator</option></select></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={8} aria-describedby={fieldError('password') ? 'user-password-error' : undefined} /></label>
      <FieldError id="user-password-error" message={fieldError('password')} />
      <label>Confirm password<input name="password_confirmation" type="password" autoComplete="new-password" required minLength={8} /></label>
      {formError ? <p role="alert">{formError}</p> : null}<button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Create user'}</button>
    </form> : null}
    {formError && !formOpen ? <p className="auth-error" role="alert">{formError}</p> : null}
    <div className="panel table-panel">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Status</th>
            <th>Created</th>
            <th>Access</th>
          </tr>
        </thead>
        <tbody>
          {loading ? <tr><td colSpan={6}>Loading users...</td></tr> : null}
          {error ? <tr><td colSpan={6}><span role="alert">{errorMessage}</span></td></tr> : null}
          {!loading && !error && result?.data.map((user) => <tr key={user.id}>
            <td>{user.name}</td><td>{user.email}</td><td>{statusLabel(user.role)}</td>
            <td><span className={`status-badge ${user.is_active ? 'success' : 'neutral'}`}>{user.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>{formatDate(user.created_at)}</td>
            <td><div className="user-admin-actions"><select aria-label={`Role for ${user.name}`} value={user.role} onChange={(event) => void updateUser(user, { role: event.target.value })}><option value="administrator">Administrator</option><option value="employee">Employee</option></select><button type="button" className="table-action" onClick={() => void updateUser(user, { is_active: !user.is_active })}>{user.is_active ? 'Disable' : 'Enable'}</button></div></td>
          </tr>)}
          {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={6}>No users found.</td></tr> : null}
        </tbody>
      </table>
    </div>
    <Pagination
      currentPage={result?.current_page ?? page}
      lastPage={result?.last_page ?? 1}
      total={result?.total ?? 0}
      loading={loading}
      onPageChange={setPage}
    />
    </>
  )
}

/**
 * Roles and permissions, read from GET /v1/roles.
 *
 * The matrix used to be hardcoded markup showing the same answer for every user.
 * It is now sourced from the `role:` middleware the backend actually applies, so
 * it cannot disagree with the enforced authorization.
 */
function RolesPage({ token }: { token: string }) {
  const [capabilities, setCapabilities] = useState<RoleCapability[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const controller = new AbortController()

    void apiFetch<{ data: RoleCapability[] }>('/v1/roles', { signal: controller.signal }, token)
      .then((response) => {
        if (controller.signal.aborted) return
        setCapabilities(response.data)
        setError('')
      })
      .catch((requestError) => {
        if (controller.signal.aborted) return
        setError(describeError(requestError, 'Unable to load the permission matrix.'))
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [token])

  const roles = ['administrator', 'employee'] as const

  return (
    <div className="panel permissions-panel">
      <h2>Roles &amp; Permissions</h2>
      <p className="page-subtitle">
        Derived from the access rules enforced by the API. The server is the source of truth; this view only
        reflects it.
      </p>

      {loading ? <p>Loading permissions...</p> : null}
      {error ? <p role="alert">{error}</p> : null}

      {!loading && !error ? <table className="permissions-table">
        <thead>
          <tr>
            <th>Module</th>
            {roles.map((role) => <th key={role}>{statusLabel(role)}</th>)}
          </tr>
        </thead>
        <tbody>
          {capabilities.map((capability) => <tr key={capability.key}>
            <td>{capability.label}</td>
            {roles.map((role) => {
              const granted = capability.permissions[role] ?? false
              const restricted = capability.restricted[role] ?? false
              const text = granted ? (restricted ? '✓ (limited)' : '✓') : '✕'

              return <td key={role} title={restricted ? 'Some actions in this module require a higher role.' : undefined}>{text}</td>
            })}
          </tr>)}
          {capabilities.length === 0 ? <tr><td colSpan={3}>No capabilities reported.</td></tr> : null}
        </tbody>
      </table> : null}
    </div>
  )
}

function AuditPage({ token }: { token: string }) {
  const { result, error, errorMessage, loading, page, setPage } = useApiList<AuditRecord>('audit-logs', token, '')

  return (
    <div className="panel table-panel">
      <h2>Audit Logs</h2>
      <div className="audit-list">
        {loading ? <p>Loading audit logs...</p> : null}
        {error ? <p role="alert">{errorMessage}</p> : null}
        {!loading && !error && result?.data.map((entry) => (
          <div key={entry.id} className="audit-row">
            <div className="avatar avatar-xs">{initials(entry.user?.name ?? 'S').slice(0, 1)}</div>
            <div>
              <strong>
                {entry.user?.name ?? 'System'} {statusLabel(entry.action)} {entry.entity}{entry.entity_id ? ` #${entry.entity_id}` : ''}
              </strong>
              <small>{formatDateTime(entry.created_at)}</small>
            </div>
          </div>
        ))}
        {!loading && !error && result?.data.length === 0 ? <p>No audit activity yet.</p> : null}
      </div>
      <Pagination
        currentPage={result?.current_page ?? page}
        lastPage={result?.last_page ?? 1}
        total={result?.total ?? 0}
        loading={loading}
        onPageChange={setPage}
      />
    </div>
  )
}

function SettingsPage({ token }: { token: string }) {
  const [settings, setSettings] = useState<SettingRecord[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    void apiFetch<SettingRecord[]>('/v1/settings', {}, token).then(setSettings).catch((requestError) => {
      setError(describeError(requestError, 'Unable to load settings.'))
    }).finally(() => setLoading(false))
  }, [token])

  const saveSettings = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    try {
      const payload = settings.map((setting) => {
        return { key: setting.key, value: parseSettingValue(setting.value), group: setting.group }
      })
      const updated = await apiFetch<SettingRecord[]>('/v1/settings', { method: 'PUT', body: JSON.stringify({ settings: payload }) }, token)
      setSettings(updated)
      setSaved(true)
    } catch (requestError) {
      setError(describeError(requestError, 'Unable to save settings.'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form className="panel settings-panel" onSubmit={saveSettings}>
      <h2>System Settings</h2>
      {loading ? <p>Loading settings...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error ? <div className="setting-list">
        {settings.map((setting, index) => <label key={setting.key}>
          <span>{setting.key}</span>
          <input aria-label={setting.key} value={typeof setting.value === 'string' ? setting.value : JSON.stringify(setting.value)} onChange={(event) => {
            setSaved(false)
            setSettings((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, value: event.target.value } : row))
          }} />
        </label>)}
        {settings.length === 0 ? <p>No system settings have been configured.</p> : null}
      </div>
      : null}
      {saved ? <p role="status">Settings saved.</p> : null}
      {settings.length > 0 ? <button type="submit" className="primary-button" disabled={saving || loading}>{saving ? 'Saving...' : 'Save settings'}</button> : null}
    </form>
  )
}

function RevenueChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const points = data.map((value, index) => `${data.length < 2 ? 210 : (index / (data.length - 1)) * 420},${155 - (value / max) * 125}`).join(' ')

  return (
    <div className="chart-wrap">
      <svg viewBox="0 0 420 180" preserveAspectRatio="none" aria-label="Revenue chart">
        <defs>
          <linearGradient id="revenueFill" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--brand)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--brand)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((line) => (
          <line key={line} x1="0" x2="420" y1={line * 50 + 25} y2={line * 50 + 25} className="grid-line" />
        ))}
        {data.length > 0 ? <>
          <polyline points={`0,155 ${points} 420,155`} fill="url(#revenueFill)" />
          <polyline points={points} className="line-series" />
        </> : null}
      </svg>
    </div>
  )
}

/**
 * Daily order counts.
 *
 * The grid is defined by the data length, not a hardcoded twelve columns: the
 * dashboard endpoint returns up to 30 points, which previously overflowed the
 * panel.
 */
function SalesChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  const columns = Math.max(data.length, 1)

  return (
    <div className="mini-bars" aria-label="Sales chart" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
      {data.map((value, index) => (
        <div key={index} className="mini-bar-wrap" title={`${value} orders`}>
          <div className="mini-bar" style={{ height: `${Math.max((value / max) * 100, 2)}%` }} />
        </div>
      ))}
      {data.length === 0 ? <p>No recent sales</p> : null}
    </div>
  )
}

function renderIcon(key: string) {
  switch (key) {
    case 'dashboard':
      return <GaugeIcon />
    case 'customers':
      return <UsersIcon />
    case 'orders':
      return <ReceiptIcon />
    case 'invoices':
      return <InvoiceIcon />
    case 'payments':
      return <WalletIcon />
    case 'products':
      return <BoxIcon />
    case 'inventory':
      return <ArchiveIcon />
    case 'reports':
      return <ChartIcon />
    case 'users':
      return <UsersIcon />
    case 'roles':
      return <ShieldIcon />
    case 'audit':
      return <HistoryIcon />
    case 'settings':
      return <SettingsIcon />
    default:
      return <GaugeIcon />
  }
}

function SearchIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="11" cy="11" r="6" />
      <path d="M16 16L21 21" />
    </svg>
  )
}

function BellIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M15 17h5l-1.4-1.4A2 2 0 0 1 18 14.2V11a6 6 0 1 0-12 0v3.2a2 2 0 0 1-.6 1.4L4 17h5" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M20 12.8A8.7 8.7 0 0 1 11.2 4a8.7 8.7 0 1 0 8.8 8.8Z" />
    </svg>
  )
}

function SunIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2.2M12 19.8V22M4.9 4.9l1.6 1.6M17.5 17.5l1.6 1.6M2 12h2.2M19.8 12H22M4.9 19.1l1.6-1.6M17.5 6.5l1.6-1.6" />
    </svg>
  )
}

function GaugeIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 14a8 8 0 1 1 16 0" />
      <path d="M12 12l4-4" />
      <path d="M12 12V7" />
    </svg>
  )
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M16 19v-1a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v1" />
      <circle cx="10" cy="7" r="3" />
      <path d="M20 19v-1a4 4 0 0 0-3-3.87" />
      <path d="M16 4.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function ReceiptIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 3h10l3 3v15l-3-2-3 2-3-2-3 2-3-2V6z" />
      <path d="M9 8h6M9 12h6" />
    </svg>
  )
}

function InvoiceIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 3h9l5 5v13H6z" />
      <path d="M15 3v5h5M9 12h6M9 16h6" />
    </svg>
  )
}

function WalletIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6h13a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H4z" />
      <path d="M16 11h4V8a2 2 0 0 0-2-2h-2" />
      <circle cx="18" cy="14" r="1" fill="currentColor" stroke="none" />
    </svg>
  )
}

function BoxIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z" />
      <path d="M12 12l8-4.5M12 12L4 7.5M12 12v9" />
    </svg>
  )
}

function ArchiveIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 8h16v11H4z" />
      <path d="M9 12h6M7 4h10l2 4H5l2-4z" />
    </svg>
  )
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 18V8M10 18V5M16 18v-9M22 18V3" />
    </svg>
  )
}

function ShieldIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l7 3v6c0 4.4-3 8-7 9-4-1-7-4.6-7-9V6l7-3z" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  )
}

function HistoryIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </svg>
  )
}

function SettingsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .94 1.7 1.7 0 0 0-.17 1.1V22a2 2 0 1 1-4 0v-.09A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.94-1 1.7 1.7 0 0 0-1.1-.17H2.5a2 2 0 1 1 0-4h.09A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.94 1.7 1.7 0 0 0 .17-1.1V2.5a2 2 0 1 1 4 0v.09A1.7 1.7 0 0 0 15 4.6a1.7 1.7 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.35.2.8.23 1.1.17h.09a2 2 0 1 1 0 4h-.09a1.7 1.7 0 0 0-1.1.17c-.31.2-.67.25-1.02.16Z" />
    </svg>
  )
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 10l5 5 5-5" />
    </svg>
  )
}

export default App
