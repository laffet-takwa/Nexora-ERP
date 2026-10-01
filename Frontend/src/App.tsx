import { useEffect, useMemo, useState } from 'react'
import './App.css'

type ThemeMode = 'light' | 'dark'
type PageKey =
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

type PaginatedResponse<T> = {
  data: T[]
  current_page: number
  last_page: number
  total: number
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
  status: string
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

async function apiFetch<T>(path: string, options: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(options.headers ?? {})
  headers.set('Accept', 'application/json')

  if (!(options.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    credentials: 'include',
  })

  const text = await response.text()
  const payload = text ? JSON.parse(text) : null

  if (!response.ok) {
    throw new Error(payload?.message ?? 'Request failed')
  }

  return payload as T
}

function useApiList<T>(path: string, token: string, search: string) {
  const [result, setResult] = useState<PaginatedResponse<T> | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    const query = new URLSearchParams({ per_page: '100' })
    if (search.trim()) query.set('search', search.trim())

    let active = true
    setLoading(true)
    setError('')
    void apiFetch<PaginatedResponse<T>>(`/v1/${path}?${query.toString()}`, { method: 'GET' }, token)
      .then((response) => {
        if (active) setResult(response)
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : 'Unable to load records.')
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => { active = false }
  }, [path, search, token, revision])

  return { result, error, loading, reload: () => setRevision((current) => current + 1) }
}

function App() {
  const [page, setPage] = useState<PageKey>('dashboard')
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
  const [authError, setAuthError] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(false)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('nexora-theme', theme)
  }, [theme])

  useEffect(() => {
    if (!token) {
      setUser(null)
      return
    }

    const loadSession = async () => {
      setIsAuthLoading(true)
      try {
        const response = await apiFetch<{ user: User }>('/v1/user', { method: 'GET' }, token)
        setUser(response.user)
        const dashboardResponse = await apiFetch<DashboardResponse>('/v1/dashboard', { method: 'GET' }, token)
        setDashboard(dashboardResponse)
      } catch (error) {
        localStorage.removeItem('nexora-token')
        setToken(null)
        setUser(null)
      } finally {
        setIsAuthLoading(false)
      }
    }

    void loadSession()
  }, [token])

  useEffect(() => {
    if (!token || globalSearch.trim().length < 2) {
      setSearchResults([])
      setSearchError('')
      setSearchLoading(false)
      return
    }

    let active = true
    const timeout = window.setTimeout(() => {
      setSearchLoading(true)
      const query = new URLSearchParams({ search: globalSearch.trim(), per_page: '4' })
      void Promise.all([
        apiFetch<PaginatedResponse<CustomerRecord>>(`/v1/customers?${query}`, {}, token),
        apiFetch<PaginatedResponse<ProductRecord>>(`/v1/products?${query}`, {}, token),
        apiFetch<PaginatedResponse<OrderRecord>>(`/v1/orders?${query}`, {}, token),
        apiFetch<PaginatedResponse<InvoiceRecord>>(`/v1/invoices?${query}`, {}, token),
      ]).then(([customers, products, orders, invoices]) => {
        if (!active) return
        setSearchResults([
          ...customers.data.map((customer) => ({ title: `${customer.first_name} ${customer.last_name}`.trim(), type: 'Customer', meta: customer.company || customer.email || '', page: 'customers' as const })),
          ...products.data.map((product) => ({ title: product.name, type: 'Product', meta: `SKU ${product.sku}`, page: 'products' as const })),
          ...orders.data.map((order) => ({ title: order.order_number, type: 'Order', meta: formatCurrency(Number(order.total)), page: 'orders' as const })),
          ...invoices.data.map((invoice) => ({ title: invoice.invoice_number, type: 'Invoice', meta: formatCurrency(Number(invoice.total)), page: 'invoices' as const })),
        ])
        setSearchError('')
      }).catch((requestError) => {
        if (active) setSearchError(requestError instanceof Error ? requestError.message : 'Search failed.')
      }).finally(() => {
        if (active) setSearchLoading(false)
      })
    }, 250)

    return () => {
      active = false
      window.clearTimeout(timeout)
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
    () => NAV_GROUPS.flatMap((group) => group.items).find((item) => item.key === page)?.label ?? 'Dashboard',
    [page],
  )

  const handleLogout = async () => {
    if (token) {
      await apiFetch('/v1/logout', { method: 'POST' }, token).catch(() => null)
    }
    localStorage.removeItem('nexora-token')
    setToken(null)
    setUser(null)
    setDashboard(null)
  }

  const handleMarkAllNotificationsRead = async () => {
    if (!token) return
    try {
      await apiFetch('/v1/notifications/read-all', { method: 'PATCH' }, token)
      setNotifications((current) => current.map((notification) => ({ ...notification, read_at: notification.read_at ?? new Date().toISOString() })))
      setUnreadNotifications(0)
    } catch {
      setNotificationError('Unable to update notifications.')
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
      setAuthError(error instanceof Error ? error.message : 'Unable to sign in.')
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

          <form className="login-form" onSubmit={handleLogin}>
            <label>
              Email
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <label>
              Password
              <input name="password" type="password" autoComplete="current-password" required />
            </label>

            {authError ? <div className="auth-error">{authError}</div> : null}

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
        return <CustomersPage token={token!} />
      case 'products':
        return <ProductsPage token={token!} />
      case 'orders':
        return <OrdersPage token={token!} />
      case 'invoices':
        return <InvoicesPage token={token!} />
      case 'payments':
        return <PaymentsPage token={token!} />
      case 'inventory':
        return <InventoryPage token={token!} />
      case 'reports':
        return <ReportsPage token={token!} />
      case 'users':
        return <UsersPage token={token!} />
      case 'roles':
        return <RolesPage />
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
          {NAV_GROUPS.map((group) => (
            <div className="nav-group" key={group.label}>
              <div className="nav-label">{group.label}</div>
              {group.items.map((item) => (
                <button
                  type="button"
                  key={item.key}
                  className={`nav-item ${page === item.key ? 'active' : ''}`}
                  onClick={() => {
                    setPage(item.key)
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
                      setPage(result.page)
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

        <div className="page-shell">{renderContent()}</div>
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
      value: formatCurrency(Number(dashboard?.kpis?.total_revenue ?? 0)),
      change: 'Live',
      detail: 'recorded payments',
    },
    {
      label: 'Orders',
      value: formatNumber(Number(dashboard?.kpis?.total_orders ?? 0)),
      change: 'Live',
      detail: 'all orders',
    },
    {
      label: 'Customers',
      value: formatNumber(Number(dashboard?.kpis?.total_customers ?? 0)),
      change: 'Live',
      detail: 'registered customers',
    },
    {
      label: 'Outstanding',
      value: formatCurrency(Number(dashboard?.kpis?.outstanding_payments ?? 0)),
      change: 'Live',
      detail: 'open invoice balance',
    },
  ]

  const recentOrders = (dashboard?.recent_orders ?? []).slice(0, 4).map((order) => ({
    id: order.order_number ?? `ORD-${order.id}`,
    customer: `${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim() || 'Customer',
    amount: formatCurrency(Number(order.total ?? 0)),
    status: order.status ?? 'Pending',
    date: order.created_at ? new Date(order.created_at).toLocaleDateString() : 'Recent',
  }))

  const topProducts = (dashboard?.top_products ?? []).slice(0, 4).map((product) => ({
    name: product.name,
    sales: `${product.quantity} units`,
  }))
  const dailySales = dashboard?.sales_over_time ?? []
  const revenueSeries = dailySales.map((point) => Number(point.total ?? 0))
  const orderSeries = dailySales.map((point) => Number(point.orders ?? 0))
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
                <span className={`status-badge ${statusClass(order.status)}`}>{order.status}</span>
              </div>
            ))}
            {recentOrders.length === 0 ? <p>No recent orders.</p> : null}
          </div>
        </div>
      </section>
    </>
  )
}

function CustomersPage({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const { result, error, loading, reload } = useApiList<CustomerRecord>('customers', token, search)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const createCustomer = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setSaving(true)
    setMutationError('')
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
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to create customer.')
    } finally {
      setSaving(false)
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
        <label>First name<input name="first_name" required maxLength={100} /></label>
        <label>Last name<input name="last_name" required maxLength={100} /></label>
        <label>Company<input name="company" maxLength={255} /></label>
        <label>Email<input name="email" type="email" /></label>
        <label>Phone<input name="phone" type="tel" maxLength={40} /></label>
        {mutationError ? <p role="alert">{mutationError}</p> : null}
        <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Create customer'}</button>
      </form> : null}

      <div className="toolbar panel">
        <div className="toolbar-group">
          <SearchIcon />
          <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search customers" aria-label="Search customers" />
        </div>
        <div className="toolbar-actions">
          <button className="secondary-button" type="button">
            Filters
          </button>
          <button className="secondary-button" type="button">
            Export
          </button>
        </div>
      </div>

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
            {error ? <tr><td colSpan={6} role="alert">{error}</td></tr> : null}
            {!loading && !error && result?.data.map((customer) => {
              const name = `${customer.first_name} ${customer.last_name}`.trim()
              return (
              <tr key={customer.id}>
                <td>
                  <div className="user-cell">
                    <div className="avatar avatar-xs">{name.slice(0, 2).toUpperCase()}</div>
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
    </>
  )
}

function ProductsPage({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const { result, error, loading, reload } = useApiList<ProductRecord>('products', token, search)
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const createProduct = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const form = event.currentTarget
    const values = new FormData(form)
    setSaving(true)
    setMutationError('')
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
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to create product.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Catalog</p><h1>Products</h1><p className="page-subtitle">Track inventory, pricing and product performance.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Add Product'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={createProduct}>
      <label>Product name<input name="name" required maxLength={255} /></label>
      <label>SKU<input name="sku" required maxLength={100} /></label>
      <label>Price<input name="selling_price" type="number" min="0.001" step="0.001" required /></label>
      <label>Opening stock<input name="stock_quantity" type="number" min="0" step="1" defaultValue="0" /></label>
      <label>Low-stock threshold<input name="minimum_stock_level" type="number" min="0" step="1" defaultValue="0" /></label>
      {mutationError ? <p role="alert">{mutationError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Create product'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products" aria-label="Search products" /></div></div>
    <div className="products-grid">
      {loading ? <div className="panel">Loading products...</div> : null}
      {error ? <div className="panel" role="alert">{error}</div> : null}
      {!loading && !error && result?.data.map((product) => {
        const stockStatus = product.stock_quantity === 0 ? 'Out of Stock' : product.stock_quantity <= product.minimum_stock_level ? 'Low Stock' : 'In Stock'
        return <div key={product.id} className="panel product-card">
          <div className="product-card-top"><div className="product-image">{product.name.slice(0, 2).toUpperCase()}</div><span className={`status-badge ${stockClass(stockStatus)}`}>{stockStatus}</span></div>
          <div className="product-info"><strong>{product.name}</strong><small>{product.sku}</small></div>
          <div className="product-meta"><span>{product.category?.name ?? 'Uncategorized'}</span><span>{formatCurrency(Number(product.selling_price))}</span></div>
          <div className="product-footer"><div><small>Stock</small><strong>{product.stock_quantity}</strong></div></div>
        </div>
      })}
      {!loading && !error && result?.data.length === 0 ? <div className="panel">No products found.</div> : null}
    </div>
  </>
}

function OrdersPage({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const { result, error, loading, reload } = useApiList<OrderRecord>('orders', token, search)
  const customers = useApiList<CustomerRecord>('customers', token, '')
  const products = useApiList<ProductRecord>('products', token, '')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const advanceOrder = async (order: OrderRecord) => {
    const nextStatus = { pending: 'confirmed', confirmed: 'processing', processing: 'completed' }[order.status]
    if (!nextStatus) return
    setMutationError('')
    try {
      await apiFetch(`/v1/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: nextStatus }) }, token)
      reload()
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to update order status.')
    }
  }

  const createOrder = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    setMutationError('')
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
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to create order.')
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
      {customers.error || products.error ? <p role="alert">{customers.error || products.error}</p> : null}
      {mutationError ? <p role="alert">{mutationError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving || customers.loading || products.loading || !customers.result?.data.length || !products.result?.data.length}>{saving ? 'Creating...' : 'Create order'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search orders or customers" aria-label="Search orders" /></div></div>
    {mutationError ? <p className="auth-error" role="alert">{mutationError}</p> : null}
    <div className="panel table-panel"><table>
      <thead><tr><th>Order ID</th><th>Customer</th><th>Total</th><th>Status</th><th>Date</th><th>Action</th></tr></thead>
      <tbody>
        {loading ? <tr><td colSpan={6}>Loading orders...</td></tr> : null}
        {error ? <tr><td colSpan={6} role="alert">{error}</td></tr> : null}
        {!loading && !error && result?.data.map((order) => <tr key={order.id}>
          <td>{order.order_number}</td><td>{`${order.customer?.first_name ?? ''} ${order.customer?.last_name ?? ''}`.trim() || '—'}</td>
          <td>{formatCurrency(Number(order.total))}</td><td><span className={`status-badge ${statusClass(order.status)}`}>{order.status}</span></td><td>{new Date(order.created_at).toLocaleDateString()}</td>
          <td>{['pending', 'confirmed', 'processing'].includes(order.status) ? <button type="button" className="table-action" onClick={() => void advanceOrder(order)}>{order.status === 'processing' ? 'Complete' : 'Advance'}</button> : '—'}</td>
        </tr>)}
        {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={6}>No orders found.</td></tr> : null}
      </tbody>
    </table></div>
  </>
}

function InvoicesPage({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const { result, error, loading, reload } = useApiList<InvoiceRecord>('invoices', token, search)
  const orders = useApiList<OrderRecord>('orders', token, '')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const createInvoice = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    setMutationError('')
    try {
      await apiFetch('/v1/invoices', { method: 'POST', body: JSON.stringify({ order_id: Number(values.get('order_id')) }) }, token)
      setFormOpen(false)
      reload()
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to create invoice.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Sales</p><h1>Invoices</h1><p className="page-subtitle">Invoice balances and payment status.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Create Invoice'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={createInvoice}>
      <label>Eligible order<select name="order_id" required defaultValue=""><option value="" disabled>Select confirmed order</option>{orders.result?.data.filter((order) => ['confirmed', 'processing', 'completed'].includes(order.status)).map((order) => <option value={order.id} key={order.id}>{order.order_number} · {formatCurrency(Number(order.total))}</option>)}</select></label>
      {orders.error ? <p role="alert">{orders.error}</p> : null}{mutationError ? <p role="alert">{mutationError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving || orders.loading}>{saving ? 'Creating...' : 'Create invoice'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoices or customers" aria-label="Search invoices" /></div></div>
    <div className="panel table-panel"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Invoice date</th><th>Due date</th><th>Total</th><th>Paid</th><th>Status</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={7}>Loading invoices...</td></tr> : null}
      {error ? <tr><td colSpan={7} role="alert">{error}</td></tr> : null}
      {!loading && !error && result?.data.map((invoice) => <tr key={invoice.id}>
        <td>{invoice.invoice_number}</td><td>{`${invoice.customer?.first_name ?? ''} ${invoice.customer?.last_name ?? ''}`.trim() || '—'}</td>
        <td>{invoice.invoice_date}</td><td>{invoice.due_date}</td><td>{formatCurrency(Number(invoice.total))}</td><td>{formatCurrency(Number(invoice.payments_sum_amount ?? 0))}</td>
        <td><span className={`status-badge ${statusClass(invoice.status)}`}>{invoice.status.replaceAll('_', ' ')}</span></td>
      </tr>)}
      {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={7}>No invoices found.</td></tr> : null}
    </tbody></table></div>
  </>
}

function PaymentsPage({ token }: { token: string }) {
  const [search, setSearch] = useState('')
  const { result, error, loading, reload } = useApiList<PaymentRecord>('payments', token, search)
  const invoices = useApiList<InvoiceRecord>('invoices', token, '')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const recordPayment = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    setMutationError('')
    try {
      await apiFetch('/v1/payments', {
        method: 'POST',
        body: JSON.stringify({ invoice_id: Number(values.get('invoice_id')), amount: Number(values.get('amount')), method: values.get('method') }),
      }, token)
      setFormOpen(false)
      reload()
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to record payment.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Sales</p><h1>Payments</h1><p className="page-subtitle">Recorded customer payments.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Record Payment'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={recordPayment}>
      <label>Invoice<select name="invoice_id" required defaultValue=""><option value="" disabled>Select open invoice</option>{invoices.result?.data.filter((invoice) => !['draft', 'cancelled', 'paid'].includes(invoice.status)).map((invoice) => <option value={invoice.id} key={invoice.id}>{invoice.invoice_number} · {formatCurrency(Number(invoice.total))}</option>)}</select></label>
      <label>Amount<input name="amount" type="number" min="0.001" step="0.001" required /></label>
      <label>Method<select name="method" defaultValue="bank_transfer"><option value="cash">Cash</option><option value="bank_transfer">Bank transfer</option><option value="card">Card</option><option value="cheque">Cheque</option><option value="other">Other</option></select></label>
      {invoices.error ? <p role="alert">{invoices.error}</p> : null}{mutationError ? <p role="alert">{mutationError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving || invoices.loading}>{saving ? 'Saving...' : 'Save payment'}</button>
    </form> : null}
    <div className="toolbar panel"><div className="toolbar-group"><SearchIcon /><input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search invoice number" aria-label="Search payments" /></div></div>
    <div className="panel table-panel"><table><thead><tr><th>Invoice</th><th>Customer</th><th>Payment date</th><th>Method</th><th>Amount</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5}>Loading payments...</td></tr> : null}
      {error ? <tr><td colSpan={5} role="alert">{error}</td></tr> : null}
      {!loading && !error && result?.data.map((payment) => <tr key={payment.id}>
        <td>{payment.invoice?.invoice_number ?? '—'}</td><td>{`${payment.customer?.first_name ?? ''} ${payment.customer?.last_name ?? ''}`.trim() || '—'}</td>
        <td>{new Date(payment.payment_date).toLocaleDateString()}</td><td>{payment.method.replaceAll('_', ' ')}</td><td>{formatCurrency(Number(payment.amount))}</td>
      </tr>)}
      {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={5}>No payments found.</td></tr> : null}
    </tbody></table></div>
  </>
}

function InventoryPage({ token }: { token: string }) {
  const { result, error, loading, reload } = useApiList<ProductRecord>('inventory', token, '')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')
  const products = result?.data ?? []
  const lowStock = products.filter((product) => product.stock_quantity <= product.minimum_stock_level)
  const metrics = [
    { label: 'Total products', value: formatNumber(result?.total ?? 0) },
    { label: 'Inventory value', value: formatCurrency(products.reduce((total, product) => total + product.stock_quantity * Number(product.selling_price), 0)) },
    { label: 'Low stock', value: formatNumber(lowStock.length) },
    { label: 'Out of stock', value: formatNumber(products.filter((product) => product.stock_quantity === 0).length) },
  ]

  const recordMovement = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    setMutationError('')
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
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to update stock.')
    } finally {
      setSaving(false)
    }
  }

  return <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Operations</p><h1>Inventory</h1><p className="page-subtitle">Monitor product availability and movement activity.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : 'Record Movement'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={recordMovement}>
      <label>Product<select name="product_id" required defaultValue=""><option value="" disabled>Select product</option>{products.map((product) => <option value={product.id} key={product.id}>{product.name} · {product.stock_quantity} available</option>)}</select></label>
      <label>Movement<select name="type" defaultValue="in"><option value="in">Stock in</option><option value="out">Stock out</option><option value="adjustment">Set stock level</option></select></label>
      <label>Quantity<input name="quantity" type="number" min="0" step="1" required /></label>
      <label>Reason<input name="reason" maxLength={255} /></label>
      {error ? <p role="alert">{error}</p> : null}{mutationError ? <p role="alert">{mutationError}</p> : null}
      <button type="submit" className="primary-button" disabled={saving || loading || products.length === 0}>{saving ? 'Saving...' : 'Save movement'}</button>
    </form> : null}
    <section className="kpi-grid inventory-grid">{metrics.map((metric) => <div className="kpi-card" key={metric.label}><div className="kpi-label">{metric.label}</div><div className="kpi-value">{metric.value}</div></div>)}</section>
    <div className="panel table-panel"><h3>Low stock</h3><table><thead><tr><th>Product</th><th>SKU</th><th>Available</th><th>Minimum</th><th>Status</th></tr></thead><tbody>
      {loading ? <tr><td colSpan={5}>Loading inventory...</td></tr> : null}
      {error ? <tr><td colSpan={5} role="alert">{error}</td></tr> : null}
      {!loading && !error && lowStock.map((product) => <tr key={product.id}><td>{product.name}</td><td>{product.sku}</td><td>{product.stock_quantity}</td><td>{product.minimum_stock_level}</td><td><span className={`status-badge ${stockClass(product.stock_quantity === 0 ? 'Out of Stock' : 'Low Stock')}`}>{product.stock_quantity === 0 ? 'Out of Stock' : 'Low Stock'}</span></td></tr>)}
      {!loading && !error && lowStock.length === 0 ? <tr><td colSpan={5}>No low-stock products.</td></tr> : null}
    </tbody></table></div>
  </>
}

function ReportsPage({ token }: { token: string }) {
  const [sales, setSales] = useState<Array<{ period: string; orders: number; revenue: number }>>([])
  const [bestSellers, setBestSellers] = useState<Array<{ name: string; quantity: number; revenue: number }>>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    void Promise.all([
      apiFetch<{ sales: Array<{ period: string; orders: number; revenue: number }> }>('/v1/reports/sales?group=month', {}, token),
      apiFetch<{ best_sellers: Array<{ name: string; quantity: number; revenue: number }> }>('/v1/reports/products', {}, token),
    ]).then(([salesResponse, productsResponse]) => {
      setSales(salesResponse.sales)
      setBestSellers(productsResponse.best_sellers)
    }).catch((requestError) => {
      setError(requestError instanceof Error ? requestError.message : 'Unable to load reports.')
    }).finally(() => setLoading(false))
  }, [token])

  return (
    <div className="panel report-panel">
      <h2>Sales overview</h2>
      {loading ? <p>Loading reports...</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!loading && !error ? <>
        <h3>Monthly sales</h3>
        <div className="table-panel"><table><thead><tr><th>Period</th><th>Orders</th><th>Revenue</th></tr></thead><tbody>
          {sales.map((row) => <tr key={row.period}><td>{row.period}</td><td>{row.orders}</td><td>{formatCurrency(Number(row.revenue))}</td></tr>)}
          {sales.length === 0 ? <tr><td colSpan={3}>No completed sales in this period.</td></tr> : null}
        </tbody></table></div>
        <h3>Best-selling products</h3>
        <div className="table-panel"><table><thead><tr><th>Product</th><th>Units</th><th>Revenue</th></tr></thead><tbody>
          {bestSellers.map((product) => <tr key={product.name}><td>{product.name}</td><td>{product.quantity}</td><td>{formatCurrency(Number(product.revenue))}</td></tr>)}
          {bestSellers.length === 0 ? <tr><td colSpan={3}>No completed product sales yet.</td></tr> : null}
        </tbody></table></div>
      </> : null}
    </div>
  )
}

function UsersPage({ token }: { token: string }) {
  const { result, error, loading, reload } = useApiList<UserRecord>('users', token, '')
  const [formOpen, setFormOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [mutationError, setMutationError] = useState('')

  const createUser = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const values = new FormData(event.currentTarget)
    setSaving(true)
    setMutationError('')
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
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to create user.')
    } finally {
      setSaving(false)
    }
  }

  const updateUser = async (user: UserRecord, changes: Partial<Pick<UserRecord, 'role' | 'is_active'>>) => {
    setMutationError('')
    try {
      await apiFetch(`/v1/users/${user.id}`, { method: 'PATCH', body: JSON.stringify(changes) }, token)
      reload()
    } catch (requestError) {
      setMutationError(requestError instanceof Error ? requestError.message : 'Unable to update user.')
    }
  }

  return (
    <>
    <div className="page-header-row page-header-stack"><div><p className="eyebrow">Administration</p><h1>Users</h1><p className="page-subtitle">Manage account access and roles.</p></div><button type="button" className="primary-button" onClick={() => setFormOpen((open) => !open)}>{formOpen ? 'Cancel' : '+ Add User'}</button></div>
    {formOpen ? <form className="resource-form panel" onSubmit={createUser}>
      <label>Name<input name="name" required maxLength={255} /></label><label>Email<input name="email" type="email" required /></label>
      <label>Role<select name="role" defaultValue="employee"><option value="employee">Employee</option><option value="administrator">Administrator</option></select></label>
      <label>Password<input name="password" type="password" autoComplete="new-password" required minLength={8} /></label>
      <label>Confirm password<input name="password_confirmation" type="password" autoComplete="new-password" required minLength={8} /></label>
      {mutationError ? <p role="alert">{mutationError}</p> : null}<button type="submit" className="primary-button" disabled={saving}>{saving ? 'Saving...' : 'Create user'}</button>
    </form> : null}
    {mutationError && !formOpen ? <p className="auth-error" role="alert">{mutationError}</p> : null}
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
          {error ? <tr><td colSpan={6} role="alert">{error}</td></tr> : null}
          {!loading && !error && result?.data.map((user) => <tr key={user.id}>
            <td>{user.name}</td><td>{user.email}</td><td>{user.role}</td>
            <td><span className={`status-badge ${user.is_active ? 'success' : 'neutral'}`}>{user.is_active ? 'Active' : 'Inactive'}</span></td>
            <td>{new Date(user.created_at).toLocaleDateString()}</td>
            <td><div className="user-admin-actions"><select aria-label={`Role for ${user.name}`} value={user.role} onChange={(event) => void updateUser(user, { role: event.target.value })}><option value="administrator">Administrator</option><option value="employee">Employee</option></select><button type="button" className="table-action" onClick={() => void updateUser(user, { is_active: !user.is_active })}>{user.is_active ? 'Disable' : 'Enable'}</button></div></td>
          </tr>)}
          {!loading && !error && result?.data.length === 0 ? <tr><td colSpan={6}>No users found.</td></tr> : null}
        </tbody>
      </table>
    </div>
    </>
  )
}

function RolesPage() {
  return (
    <div className="panel permissions-panel">
      <h2>Roles & Permissions</h2>
      <table className="permissions-table">
        <thead>
          <tr>
            <th>Module</th>
            <th>Admin</th>
            <th>Employee</th>
          </tr>
        </thead>
        <tbody>
          <tr><td>Dashboard</td><td>✓</td><td>✓</td></tr>
          <tr><td>Customers</td><td>✓</td><td>✓</td></tr>
          <tr><td>Products</td><td>✓</td><td>✓</td></tr>
          <tr><td>Orders</td><td>✓</td><td>✓</td></tr>
          <tr><td>Invoices</td><td>✓</td><td>✓</td></tr>
          <tr><td>Users</td><td>✓</td><td>✕</td></tr>
          <tr><td>Audit Logs</td><td>✓</td><td>✕</td></tr>
        </tbody>
      </table>
    </div>
  )
}

function AuditPage({ token }: { token: string }) {
  const { result, error, loading } = useApiList<AuditRecord>('audit-logs', token, '')

  return (
    <div className="panel table-panel">
      <h2>Audit Logs</h2>
      <div className="audit-list">
        {loading ? <p>Loading audit logs...</p> : null}
        {error ? <p role="alert">{error}</p> : null}
        {!loading && !error && result?.data.map((entry) => (
          <div key={entry.id} className="audit-row">
            <div className="avatar avatar-xs">{(entry.user?.name ?? 'S').slice(0, 1).toUpperCase()}</div>
            <div>
              <strong>
                {entry.user?.name ?? 'System'} {entry.action} {entry.entity}{entry.entity_id ? ` #${entry.entity_id}` : ''}
              </strong>
              <small>{new Date(entry.created_at).toLocaleString()}</small>
            </div>
          </div>
        ))}
        {!loading && !error && result?.data.length === 0 ? <p>No audit activity yet.</p> : null}
      </div>
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
      setError(requestError instanceof Error ? requestError.message : 'Unable to load settings.')
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
      setError(requestError instanceof Error ? requestError.message : 'Unable to save settings.')
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

function SalesChart({ data }: { data: number[] }) {
  const max = Math.max(...data, 1)
  return (
    <div className="mini-bars" aria-label="Sales chart">
      {data.map((value, index) => (
        <div key={index} className="mini-bar-wrap">
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

function formatCurrency(value: number) {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value)
}

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join('')
}

function parseSettingValue(value: unknown) {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value) as unknown
  } catch {
    return value
  }
}

function statusClass(value: string) {
  const normalized = value.toLowerCase()
  if (normalized.includes('paid') || normalized.includes('completed') || normalized.includes('active') || normalized.includes('vip')) return 'success'
  if (normalized.includes('pending') || normalized.includes('processing') || normalized.includes('low')) return 'warning'
  if (normalized.includes('inactive') || normalized.includes('out')) return 'danger'
  return 'neutral'
}

function stockClass(value: string) {
  if (value === 'In Stock') return 'success'
  if (value === 'Low Stock') return 'warning'
  return 'danger'
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
