import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { memberRoutes } from '../src/features/members/memberRoutes'
import { AppShell } from '../src/layouts/AppShell'
import { DashboardPage } from '../src/pages/DashboardPage'
import { changeLanguage, loadNamespaces } from '../src/i18n'
import { resetSession, signInAs } from './session'
import { setViewportWidth } from './setup'

/**
 * Phase 11's exit criterion, mechanised: a full pass through a screen in Kinyarwanda finds no
 * English string and no translation key.
 *
 * Each feature already has a Kinyarwanda test of its own, and those check that the right words
 * appear. This checks the opposite and is the harder half — that nothing **else** does. A component
 * that builds a label from a variable, a string added to a component without a key, an enum the
 * server sent that nobody translated: none of those are caught by asserting that a heading reads
 * "Incamake", and all of them are caught by reading the whole rendered screen back.
 *
 * And it does it at each breakpoint, because Kinyarwanda strings run 20–40 % longer than English
 * and the layout switches shape twice on the way from a phone to a desk. jsdom has no layout
 * engine, so this cannot prove nothing overflows; what it can prove is that the shape a width
 * chooses still renders, still carries the same words, and still leaves no key on screen — which is
 * where a long string would take the interface apart.
 */

/** Phone, tablet, desk. The two numbers the layout actually branches on are 768 and 1024. */
const WIDTHS = [
  { name: 'a phone', width: 360 },
  { name: 'a tablet', width: 768 },
  { name: 'a desk', width: 1440 },
]

/**
 * English words with a fixed Kinyarwanda term in `docs/glossary.md`. Finding one of these in a
 * Kinyarwanda screen means a string escaped the translator.
 *
 * Deliberately not every English word: the words a Rwandan office keeps in English — RWF, SMS,
 * PDF, CSV, Mobile money — are correct here, and so are a cooperative's own data, a member's name
 * and a place name.
 */
const ENGLISH = new RegExp(
  '\\b(' +
    [
      'member',
      'members',
      'cooperative',
      'save',
      'cancel',
      'delete',
      'edit',
      'search',
      'filter',
      'filters',
      'report',
      'reports',
      'document',
      'documents',
      'meeting',
      'meetings',
      'product',
      'products',
      'stock',
      'inventory',
      'sale',
      'sales',
      'buyer',
      'buyers',
      'payment',
      'balance',
      'income',
      'expenses',
      'total',
      'amount',
      'category',
      'quantity',
      'warehouse',
      'share',
      'shares',
      'contribution',
      'contributions',
      'staff',
      'password',
      'settings',
      'status',
      'active',
      'inactive',
      'optional',
      'required',
      'loading',
      'export',
      'download',
      'upload',
      'print',
      'dashboard',
      'attention',
      'today',
      'soon',
      'watch',
      'good',
    ].join('|') +
    ')\\b',
  'i',
)

/**
 * Anything that looks like a translation key that failed to resolve: `dashboard.tiles.members`,
 * `attention.item.lowStock`. Two or more dotted lowercase segments with no spaces.
 */
const BARE_KEY = /\b[a-z][A-Za-z]*(\.[a-z][A-Za-z]*){2,}\b/

function visibleText(): string {
  // `sr-only` content is read by a screen reader and counts as text on the screen. Script and
  // style content does not.
  const clone = document.body.cloneNode(true) as HTMLElement
  for (const node of clone.querySelectorAll('script, style')) node.remove()
  return clone.textContent ?? ''
}

function expectKinyarwandaOnly(): void {
  const text = visibleText()

  const english = ENGLISH.exec(text)
  expect(english?.[0], `English word "${english?.[0]}" on a Kinyarwanda screen`).toBeUndefined()

  const key = BARE_KEY.exec(text)
  expect(key?.[0], `unresolved translation key "${key?.[0]}" on screen`).toBeUndefined()
}

const BOARD = {
  cooperative: { name: 'Abahuzamugambi Coffee', code: 'ABAHUZA-HUYE' },
  month: '2026-09',
  tiles: [
    {
      key: 'members',
      type: 'number',
      value: '248',
      hint: { key: 'members.total', value: '263', type: 'number' },
      href: '/members',
    },
    {
      key: 'income',
      type: 'money',
      value: '1250000.00',
      hint: { key: 'expenses', value: '1840000.00', type: 'money' },
      href: '/finance',
    },
  ],
  charts: [
    {
      key: 'incomeExpense',
      series: ['income', 'expenses'],
      points: [{ bucket: '2026-09', values: { income: '1250000.00', expenses: '1840000.00' } }],
    },
    {
      key: 'expensesByCategory',
      series: ['amount'],
      points: [{ bucket: 'Ifumbire', values: { amount: '1200000.00', nameRw: 'Ifumbire' } }],
    },
  ],
  lowStock: [
    {
      id: 'prod-1',
      name: 'Imbuto za kawa',
      sku: 'SEED-01',
      quantity: '0.000',
      minimum: '50.000',
      unit: 'kg',
    },
  ],
  attention: [
    {
      key: 'outOfStock',
      severity: 'CRITICAL',
      params: { count: 1, product: 'Imbuto za kawa' },
      href: '/inventory/stock',
    },
    {
      key: 'overdueActions',
      severity: 'WARNING',
      params: { count: 3 },
      href: '/meetings',
    },
  ],
  activity: [
    {
      id: 'log-1',
      action: 'MEMBER_CREATED',
      actor: 'Claudine Uwimana <uwimana@example.test>',
      messageKey: 'audit.member.created',
      messageParams: { member: 'Nsengimana Alphonse', code: 'UMU-00264' },
      at: '2026-09-15T14:20:00.000Z',
    },
  ],
  health: {
    rating: 'ATTENTION',
    signals: [
      {
        key: 'money',
        rating: 'WATCH',
        params: { balance: '4820000.00', income: '1250000.00', expenses: '1840000.00' },
      },
      {
        key: 'stock',
        rating: 'ATTENTION',
        params: { low: 2, empty: 1, products: 34, count: 1 },
      },
      {
        key: 'receivables',
        rating: 'GOOD',
        params: { outstanding: '0.00', count: 0, days: 0 },
      },
    ],
  },
  withheld: ['sales'],
}

const MEMBER_ROW = {
  id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  memberCode: 'ABAH-0001',
  firstName: 'Chantal',
  lastName: 'Mukamana',
  fullName: 'Chantal Mukamana',
  gender: 'FEMALE',
  phone: null,
  district: 'Huye',
  sector: 'Ngoma',
  joinedOn: '2024-03-04',
  position: 'MEMBER',
  status: 'ACTIVE',
  nationalIdMasked: '••••••••••••1234',
}

function stubFetch(): void {
  const table: Record<string, unknown> = {
    '/dashboard': BOARD,
    '/settings': { enabledModules: ['members', 'contributions'] },
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/cooperatives/mine': [],
    '/members/stats': { total: 412, byStatus: { ACTIVE: 388 }, newThisMonth: 9, withoutPhone: 137 },
    '/members/form-options': { incomeCategories: [] },
    '/members': { __paged: true, items: [MEMBER_ROW] },
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input)
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

      const value = table[match] as { __paged?: boolean; items?: unknown[] }
      const payload = value?.__paged
        ? { data: value.items, meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }
        : { data: value }
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const routes: RouteObject[] = [
    {
      path: '/',
      element: <AppShell />,
      children: [{ index: true, element: <DashboardPage /> }, ...memberRoutes],
    },
  ]
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(async () => {
  signInAs('MANAGER')
  stubFetch()
  // The activity list and the members screen fetch their own strings, so they are loaded here for
  // the same reason the routes await them: a screen must never render its keys and correct itself.
  await loadNamespaces(['members', 'audit', 'finance', 'inventory', 'sales', 'meetings'], 'rw')
  await changeLanguage('rw')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  setViewportWidth(1024)
  await changeLanguage('en')
})

describe('the dashboard in Kinyarwanda', () => {
  for (const { name, width } of WIDTHS) {
    it(`leaves no English and no key on ${name}`, async () => {
      setViewportWidth(width)
      renderAt('/')

      // The health banner only exists once the figures have arrived, so this waits for the screen
      // rather than for the shell.
      await waitFor(() => expect(screen.getByText('Byihutirwa')).toBeInTheDocument())

      expectKinyarwandaOnly()
    })
  }

  it('says which block the role does not cover, in Kinyarwanda', async () => {
    setViewportWidth(1440)
    renderAt('/')
    await waitFor(() => expect(screen.getByText('Byihutirwa')).toBeInTheDocument())

    expect(screen.getByText(/Inshingano zawe ntizirimo: amagurisha/)).toBeInTheDocument()
  })

  it('writes one product out of stock in the singular', async () => {
    setViewportWidth(1440)
    renderAt('/')
    await waitFor(() =>
      expect(screen.getByText('Imbuto za kawa yashize mu bubiko.')).toBeInTheDocument(),
    )
    // And three overdue actions in the plural, from the same list.
    expect(
      screen.getByText('Ibikorwa 3 byemejwe mu nama byarengeje itariki ntarengwa.'),
    ).toBeInTheDocument()
  })
})

describe('the member register in Kinyarwanda', () => {
  for (const { name, width } of WIDTHS) {
    it(`leaves no English and no key on ${name}`, async () => {
      setViewportWidth(width)
      renderAt('/members')

      await waitFor(() => expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument())

      expectKinyarwandaOnly()
    })
  }

  it('is a table on a desk and stacked records on a phone', async () => {
    setViewportWidth(1440)
    const desk = renderAt('/members')
    await waitFor(() => expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument())
    // A real table, with the column headings in Kinyarwanda and room for them to wrap.
    const table = document.querySelector('table')
    expect(table).not.toBeNull()
    expect(within(table as HTMLElement).getByText('Telefone')).toBeInTheDocument()
    // A heading wraps inside its cell rather than pushing the table sideways — no column carries
    // `whitespace-nowrap` — and the columns that matter least are held back to the widest layout,
    // which is what keeps longer Kinyarwanda headings from crowding the ones that matter.
    expect(table?.querySelector('th.hidden.lg\\:table-cell')).not.toBeNull()
    desk.unmount()

    setViewportWidth(360)
    renderAt('/members')
    await waitFor(() => expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument())
    // Below the breakpoint the same rows are buttons, not a table that would scroll sideways.
    expect(document.querySelector('table')).toBeNull()
  })
})
