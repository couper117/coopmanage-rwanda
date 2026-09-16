import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { NotificationBell } from '../src/features/notifications/NotificationBell'
import type {
  NotificationRow,
  NotificationSummary,
} from '../src/features/notifications/notifications.api'
import { NotificationsPage } from '../src/pages/NotificationsPage'
import { changeLanguage, loadNamespaces } from '../src/i18n'
import { resetSession, signInAs } from './session'

/**
 * Phase 12 on the screen: the bell and the notification centre.
 *
 * The thing worth testing here is not the list — it is that **a notification is a sentence**. The
 * server sends a key and its parameters, so the row a cooperative sees is composed in the reader's
 * language from strings this screen fetches for itself. A bell that showed
 * `notifications.lowStock.low` would be worse than no bell.
 *
 * After that: the count, the action that takes the reader to the thing it is about, and dismissing
 * — which takes a row out of the list and leaves it answerable, because "were we warned?" is asked
 * after the fertiliser has run out.
 */

interface StubRequest {
  url: string
  method: string
}

let calls: StubRequest[] = []

const LOW_STOCK: NotificationRow = {
  id: 'note-1',
  type: 'LOW_STOCK',
  severity: 'WARNING',
  messageKey: 'notifications.lowStock.low',
  messageParams: {
    product: 'Ifumbire NPK 17-17-17',
    quantity: '8',
    unit: 'sack',
    minimum: '40',
  },
  entityType: 'Product',
  entityId: 'prod-1',
  actionUrl: '/inventory/stock',
  personal: false,
  readAt: null,
  createdAt: '2026-09-16T06:30:00.000Z',
}

const REPORT_READY: NotificationRow = {
  id: 'note-2',
  type: 'REPORT_READY',
  severity: 'INFO',
  messageKey: 'notifications.report.ready',
  messageParams: {
    // The server sends the interface's own key for the report's name, not a finished word.
    report: 'reports.type.financial',
    period: '1 September to 30 September 2026',
  },
  entityType: 'ReportRun',
  entityId: 'run-1',
  actionUrl: '/reports/runs/run-1',
  personal: true,
  readAt: '2026-09-16T07:00:00.000Z',
  createdAt: '2026-09-16T06:00:00.000Z',
}

const SUMMARY: NotificationSummary = {
  unread: 3,
  unreadByType: { LOW_STOCK: 2, REPORT_READY: 1 },
  latest: [LOW_STOCK],
}

interface Paged {
  __paged: true
  items: unknown[]
  meta: Record<string, unknown>
}

function paged(items: unknown[]): Paged {
  return {
    __paged: true,
    items,
    meta: { page: 1, pageSize: 25, total: items.length, totalPages: 1 },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

function stubFetch(handlers: Record<string, unknown> = {}): void {
  const table: Record<string, unknown> = {
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/notifications/summary': SUMMARY,
    '/notifications/read-all': { marked: 3 },
    '/notifications/note-1/read': { ...LOW_STOCK, readAt: '2026-09-16T08:00:00.000Z' },
    '/notifications/note-1/dismiss': { ...LOW_STOCK, readAt: '2026-09-16T08:00:00.000Z' },
    '/notifications': paged([LOW_STOCK, REPORT_READY]),
    ...handlers,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      calls.push({ url, method: init?.method ?? 'GET' })

      const match = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((path) => url.includes(path))

      if (!match) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'NOT_FOUND', messageKey: 'errors.notFound', message: 'no stub' },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      const value = table[match]
      const payload = isPaged(value) ? { data: value.items, meta: value.meta } : { data: value }
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

function renderElement(element: React.ReactElement, path = '/') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const routes: RouteObject[] = [
    { path: '/', element },
    { path: '/inventory/stock', element: <p>stock screen</p> },
    { path: '*', element: <p>elsewhere</p> },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

beforeEach(async () => {
  calls = []
  signInAs('MANAGER')
  stubFetch()
  // The bell and the centre quote whichever module raised each notification, so their strings are
  // loaded the way the components load them.
  await loadNamespaces(['inventory', 'reports', 'audit'])
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  await changeLanguage('en')
})

describe('the bell', () => {
  it('shows how many are waiting, and says it to a screen reader too', async () => {
    renderElement(<NotificationBell />)
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Notifications, 3 waiting' })).toBeInTheDocument(),
    )
    // The badge is decorative; the count that matters is in the accessible name.
    expect(screen.getByText('3')).toBeInTheDocument()
  })

  it('writes each notification as a sentence, not as a key', async () => {
    renderElement(<NotificationBell />)
    await waitFor(() => expect(screen.getByRole('button', { name: /waiting/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /waiting/ }))

    await waitFor(() =>
      expect(
        screen.getByText(
          'Ifumbire NPK 17-17-17 is down to 8 sack, below the 40 you asked to be warned about',
        ),
      ).toBeInTheDocument(),
    )
    // A bell showing `notifications.lowStock.low` would be worse than no bell.
    expect(document.body.textContent).not.toMatch(/notifications\.[a-z]/i)
  })

  it('leads to the thing the notification is about', async () => {
    const { router } = renderElement(<NotificationBell />)
    await waitFor(() => expect(screen.getByRole('button', { name: /waiting/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /waiting/ }))

    const open = await screen.findByRole('link', { name: 'Open' })
    fireEvent.click(open)

    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/stock'))
    // Opening what it is about counts as having read it, so the bell does not keep asking.
    expect(calls.some((call) => call.url.includes('/note-1/read') && call.method === 'POST')).toBe(
      true,
    )
  })

  it('clears everything in one action', async () => {
    renderElement(<NotificationBell />)
    await waitFor(() => expect(screen.getByRole('button', { name: /waiting/ })).toBeInTheDocument())
    fireEvent.click(screen.getByRole('button', { name: /waiting/ }))

    const readAll = await screen.findByRole('button', { name: 'Mark all as read' })
    fireEvent.click(readAll)

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/read-all') && call.method === 'POST')).toBe(
        true,
      ),
    )
  })
})

describe('the centre', () => {
  it('reads every notification as a sentence, including one the server sent as a key', async () => {
    renderElement(<NotificationsPage />)

    await waitFor(() =>
      expect(screen.getByText(/Ifumbire NPK 17-17-17 is down to 8 sack/)).toBeInTheDocument(),
    )
    // The report's name arrived as `reports.type.financial` and is resolved here, which is the
    // whole reason a notification is stored as a key and its parameters.
    expect(
      screen.getByText('Financial report for 1 September to 30 September 2026 is ready to read'),
    ).toBeInTheDocument()
  })

  it('offers the dismissed ones as a state rather than losing them', async () => {
    renderElement(<NotificationsPage />)
    await waitFor(() => expect(screen.getByText(/Ifumbire NPK/)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'dismissed' } })

    // "Were we warned about this?" is asked after the event, so the request asks for them.
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('dismissed=only'))).toBe(true),
    )
  })

  it('narrows to one kind', async () => {
    renderElement(<NotificationsPage />)
    await waitFor(() => expect(screen.getByText(/Ifumbire NPK/)).toBeInTheDocument())

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'LOW_STOCK' } })
    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('type=LOW_STOCK'))).toBe(true),
    )
  })

  it('dismisses one and takes it out of the list', async () => {
    renderElement(<NotificationsPage />)
    await waitFor(() => expect(screen.getByText(/Ifumbire NPK/)).toBeInTheDocument())

    const row = screen.getByText(/Ifumbire NPK/).closest('li')
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: 'Dismiss' }))

    await waitFor(() =>
      expect(calls.some((call) => call.url.includes('/dismiss') && call.method === 'POST')).toBe(
        true,
      ),
    )
  })
})

describe('in Kinyarwanda', () => {
  it('composes the same notification in Kinyarwanda', async () => {
    await changeLanguage('rw')
    renderElement(<NotificationsPage />)

    await waitFor(() =>
      expect(
        screen.getByText(/Ifumbire NPK 17-17-17 yagabanutse igera kuri 8/),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Amamenyesha')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/notifications\.[a-z]/i)
  })
})
