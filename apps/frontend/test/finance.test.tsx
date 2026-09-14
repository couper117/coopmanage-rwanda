import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { financeRoutes } from '../src/features/finance/financeRoutes'
import i18n, { changeLanguage } from '../src/i18n'
import enFinance from '../src/i18n/locales/en/finance.json'
import rwFinance from '../src/i18n/locales/rw/finance.json'
import { resetSession, signInAs } from './session'

/**
 * The cooperative's books, mounted for real against a stubbed network.
 *
 * The routes, the permission guard, the forms, the tables and the hand-drawn chart all run; only
 * `fetch` is faked. Two jsdom constraints shape how this file is written, both learned the hard
 * way in `cooperative.test.tsx` and again in `members.test.tsx`: `userEvent`'s pointer simulation
 * does not terminate against a Radix portal, and a `byRole` query carrying a `name` option takes
 * seconds against one. So everything here uses `fireEvent` and queries by text, label or selector
 * — and no test is allowed to end with a dialog still open, because the layer it leaves behind
 * slows or confuses whatever renders next.
 *
 * The `finance` namespace is registered here rather than relied upon from `src/i18n/index.ts`, so
 * this suite tests the feature as it stands on its own.
 */
i18n.addResourceBundle('en', 'finance', enFinance, true, true)
i18n.addResourceBundle('rw', 'finance', rwFinance, true, true)

const ENTRY_ID = '2c1f0d2e-6a4b-4f31-8c7d-1e2b3a4c5d61'
const SOURCED_ENTRY_ID = '3d2e1f40-7b5c-4a21-9d8e-2f3a4b5c6d72'
const INCOME_CATEGORY_ID = 'b1c2d3e4-5f60-4a71-8b92-0c1d2e3f4a5b'
const EXPENSE_CATEGORY_ID = 'c2d3e4f5-6071-4b82-9ca3-1d2e3f4a5b6c'

interface StubRequest {
  url: string
  method: string
  body: unknown
}

/**
 * A stubbed response: either a fixed value or a function of the request. Typed as `unknown`
 * because a union with `unknown` collapses to it, which is why handlers are wrapped in `replies`
 * rather than written inline — that is what gives the parameter its type.
 */
type StubValue = unknown
type StubHandler = (request: StubRequest) => unknown

const replies = (handler: StubHandler): StubValue => handler

interface Paged {
  __paged: true
  items: unknown[]
  meta: Record<string, unknown>
}

/**
 * A page of the ledger. The totals belong to the metadata rather than to the rows, because the
 * server computes them over the whole filtered set and not over the page it happens to return.
 */
function paged(
  items: unknown[],
  totals: { income: string; expenses: string; balance: string },
  overrides: { total?: number; page?: number; pageSize?: number } = {},
): Paged {
  const total = overrides.total ?? items.length
  const pageSize = overrides.pageSize ?? 25
  return {
    __paged: true,
    items,
    meta: {
      page: overrides.page ?? 1,
      pageSize,
      total,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
      sort: '-occurredAt',
      totals,
    },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

/** Every request the screen made, in order, so a test can assert what was asked of the server. */
let calls: StubRequest[] = []

function lastCallTo(fragment: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment))
}

const NO_TOTALS = { income: '0.00', expenses: '0.00', balance: '0.00' }

/**
 * Deliberately not round. The figures carry centimes so a test can prove the screen shows what
 * the server sent rather than something a float has been through.
 */
const SUMMARY = {
  from: '2026-09-01',
  to: '2026-09-30',
  groupBy: 'month',
  opening: '2200000.00',
  income: '3200000.45',
  expenses: '1250000.10',
  net: '1950000.35',
  closing: '4150000.35',
  buckets: [
    { start: '2026-09-01', income: '3200000.45', expenses: '1250000.10', net: '1950000.35' },
  ],
  categories: [
    {
      categoryId: INCOME_CATEGORY_ID,
      name: 'Coffee sales',
      nameRw: 'Kugurisha ikawa',
      kind: 'INCOME',
      total: '3200000.45',
      share: '100.0',
    },
    {
      categoryId: EXPENSE_CATEGORY_ID,
      name: 'Transport',
      nameRw: 'Ubwikorezi',
      kind: 'EXPENSE',
      total: '1250000.10',
      share: '100.0',
    },
  ],
}

const TRENDS = {
  groupBy: 'month',
  opening: '2200000.00',
  points: [
    {
      start: '2026-08-01',
      income: '900000.00',
      expenses: '400000.00',
      net: '500000.00',
      balance: '2700000.00',
    },
    {
      start: '2026-09-01',
      income: '3200000.45',
      expenses: '1250000.10',
      net: '1950000.35',
      balance: '4650000.35',
    },
  ],
}

const CATEGORIES = [
  {
    id: INCOME_CATEGORY_ID,
    kind: 'INCOME',
    name: 'Coffee sales',
    nameRw: 'Kugurisha ikawa',
    code: 'IN-01',
    isActive: true,
    isSystem: false,
    entryCount: 12,
    total: '3200000.45',
  },
  {
    id: EXPENSE_CATEGORY_ID,
    kind: 'EXPENSE',
    name: 'Transport',
    nameRw: 'Ubwikorezi',
    code: 'EX-01',
    isActive: true,
    isSystem: true,
    entryCount: 4,
    total: '1250000.10',
  },
]

const LEDGER_ROW = {
  id: ENTRY_ID,
  reference: 'IN-2026-000042',
  kind: 'INCOME',
  categoryId: INCOME_CATEGORY_ID,
  categoryName: 'Coffee sales',
  categoryNameRw: 'Kugurisha ikawa',
  amount: '12345.67',
  occurredAt: '2026-09-04',
  method: 'CASH',
  description: 'Receipt 04521, first coffee lot',
  memberId: null,
  memberName: null,
  memberCode: null,
  status: 'POSTED',
  sourceType: 'MANUAL',
  reversalOfReference: null,
  reversedByReference: null,
}

/** The same money seen from the accounting side of a member's contribution. */
const SOURCED_ROW = {
  ...LEDGER_ROW,
  id: SOURCED_ENTRY_ID,
  reference: 'IN-2026-000043',
  amount: '5000.00',
  description: 'Savings from Chantal Mukamana',
  memberId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  memberName: 'Chantal Mukamana',
  memberCode: 'ABAH-0001',
  sourceType: 'CONTRIBUTION',
}

/** Routes each stubbed endpoint by path, longest first, so `/finance/summary` is never a row. */
function stubApi(handlers: Record<string, StubValue> = {}) {
  calls = []
  const table: Record<string, StubValue> = {
    '/settings': { enabledModules: ['finance'] },
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/cooperatives/mine': [],
    '/finance/summary': SUMMARY,
    '/finance/trends': TRENDS,
    '/finance/categories': CATEGORIES,
    '/finance/transactions': paged([LEDGER_ROW], NO_TOTALS),
    ...handlers,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      const request: StubRequest = { url, method, body }
      calls.push(request)

      const match = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((path) => url.includes(path))

      if (!match) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: {
                code: 'NOT_FOUND',
                messageKey: 'errors.notFound',
                message: 'no stub',
                requestId: 'test',
              },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      const value = table[match]
      const result =
        typeof value === 'function' ? (value as (r: StubRequest) => unknown)(request) : value
      if (result instanceof Response) return Promise.resolve(result)

      const payload = isPaged(result) ? { data: result.items, meta: result.meta } : { data: result }
      return Promise.resolve(
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

/** The feature's routes on their own, at absolute paths, mounted in a memory router. */
const routes: RouteObject[] = financeRoutes.map((route) => ({
  ...route,
  path: `/${route.path ?? ''}`,
}))

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  // The router is handed back so a test can read the address the screen wrote, which is where the
  // filters and the chosen period are supposed to live.
  return { ...view, router }
}

function openDialog(): HTMLElement {
  return document.querySelector('[role="dialog"]') as HTMLElement
}

function submitForm(id: string): void {
  fireEvent.submit(document.getElementById(id) as HTMLFormElement)
}

async function closeDialog(): Promise<void> {
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await waitFor(() => {
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
}

/** The first day of last month, worked out here rather than read from the code under test. */
function firstOfLastMonth(): string {
  const now = new Date()
  const target = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  return `${target.getFullYear()}-${`${target.getMonth() + 1}`.padStart(2, '0')}-01`
}

beforeEach(() => {
  signInAs('ACCOUNTANT')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  await changeLanguage('en')
})

describe('the finance overview', () => {
  it('heads the screen with money in, money out and the balance', async () => {
    stubApi()
    renderAt('/finance')

    await waitFor(() => {
      expect(screen.getAllByText('+3,200,000.45 RWF').length).toBeGreaterThan(0)
    })
    // All three come from the summary, and all three are the figures for the chosen period.
    const headline = screen.getByLabelText(/These three figures cover/)
    expect(within(headline).getByText('+3,200,000.45 RWF')).toBeInTheDocument()
    expect(within(headline).getByText('−1,250,000.1 RWF')).toBeInTheDocument()
    expect(within(headline).getByText('4,150,000.35 RWF')).toBeInTheDocument()
    expect(within(headline).getByText('Money in')).toBeInTheDocument()
    expect(within(headline).getByText('Money out')).toBeInTheDocument()
    expect(within(headline).getByText('Balance')).toBeInTheDocument()
    // The balance says how much of itself was carried in from before the period.
    expect(within(headline).getByText(/2,200,000 RWF carried in/)).toBeInTheDocument()
  })

  it('shows every amount exactly as the server sent it, to the centime', async () => {
    stubApi()
    renderAt('/finance')

    await waitFor(() => {
      expect(screen.getAllByText('+3,200,000.45 RWF').length).toBeGreaterThan(0)
    })
    // Forty-five centimes, still there. A float would have been enough to lose them, and the
    // string never goes through one: it is rendered from the characters the server sent.
    const headline = screen.getByLabelText(/These three figures cover/)
    expect(within(headline).getByText('+3,200,000.45 RWF').textContent).toBe('+3,200,000.45 RWF')
    expect(screen.queryByText('+3,200,000 RWF')).toBeNull()
    expect(screen.queryByText(/3,200,000\.4499/)).toBeNull()
  })

  it('draws the movement as bars and writes the same figures out as a table', async () => {
    stubApi()
    renderAt('/finance')

    await waitFor(() => {
      expect(screen.getByText('The same figures, period by period.')).toBeInTheDocument()
    })
    expect(screen.getByText('Movement over the period')).toBeInTheDocument()
    // Each bucket is one labelled group rather than a bare coloured rectangle, so the chart says
    // what it shows to somebody who cannot see it.
    const bars = document.querySelectorAll('[role="img"]')
    expect(bars).toHaveLength(2)
    expect(bars[0]?.getAttribute('aria-label')).toContain('900,000 RWF in')
    expect(bars[0]?.getAttribute('aria-label')).toContain('400,000 RWF out')

    // And the accessible alternative is a real table of the same numbers, including the running
    // balance a bar cannot express.
    expect(screen.getByText('The same figures, period by period.')).toBeInTheDocument()
    expect(screen.getByText('4,650,000.35')).toBeInTheDocument()
  })

  it('says where the money came from and where it went, using the server’s own share', async () => {
    stubApi()
    renderAt('/finance')

    await waitFor(() => {
      expect(screen.getAllByText('100.0% of the total')).toHaveLength(2)
    })
    expect(screen.getByText('Where the money came from')).toBeInTheDocument()
    expect(screen.getByText('Where the money went')).toBeInTheDocument()
    expect(screen.getAllByText('Coffee sales').length).toBeGreaterThan(0)
    expect(screen.getByText('Transport')).toBeInTheDocument()
  })

  it('writes the chosen period into the address, so it can be sent to somebody', async () => {
    stubApi()
    const { router } = renderAt('/finance')

    await waitFor(() => {
      expect(screen.getByText('Last month')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Last month'))

    const expected = firstOfLastMonth()
    await waitFor(() => {
      expect(router.state.location.search).toContain(`from=${expected}`)
    })
    expect(router.state.location.search).toContain('to=')
    expect(screen.getByLabelText('From')).toHaveValue(expected)
    // And the request for the figures covers exactly that period.
    await waitFor(() => {
      expect(lastCallTo('/finance/summary')?.url).toContain(`from=${expected}`)
    })
  })

  it('asks for both dates, because the server will not summarise without them', async () => {
    stubApi()
    renderAt('/finance')

    await waitFor(() => {
      expect(lastCallTo('/finance/summary')).toBeDefined()
    })
    const request = lastCallTo('/finance/summary')
    expect(request?.url).toMatch(/from=\d{4}-\d{2}-\d{2}/)
    expect(request?.url).toMatch(/to=\d{4}-\d{2}-\d{2}/)
    expect(request?.url).toContain('groupBy=')
  })
})

describe('the ledger', () => {
  it('lists an entry with its reference, category, description and amount', async () => {
    stubApi({ '/finance/transactions': paged([LEDGER_ROW], NO_TOTALS) })
    renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    const table = document.querySelector('table') as HTMLElement
    expect(within(table).getByText('Receipt 04521, first coffee lot')).toBeInTheDocument()
    expect(within(table).getByText('Coffee sales')).toBeInTheDocument()
    expect(within(table).getByText('Cash')).toBeInTheDocument()
    expect(within(table).getByText('Recorded')).toBeInTheDocument()
    // Every table carries a caption, which is what a screen reader announces on entering it.
    expect(within(table).getByText(/Entries in the cooperative's books/)).toBeInTheDocument()
  })

  it('shows the amount exactly as the server sent it, with a sign as well as a colour', async () => {
    stubApi({ '/finance/transactions': paged([LEDGER_ROW], NO_TOTALS) })
    renderAt('/finance/transactions')

    // Twelve thousand three hundred and forty-five francs and sixty-seven centimes, to the
    // centime. The leading sign is what tells money in from money out without relying on colour.
    await waitFor(() => {
      expect(screen.getByText('+12,345.67 RWF')).toBeInTheDocument()
    })
    expect(screen.queryByText('12,345.66 RWF')).toBeNull()
  })

  it('totals the whole filtered set rather than the page on screen', async () => {
    stubApi({
      // One row of twelve thousand francs, out of four and a half million across every page.
      '/finance/transactions': paged(
        [LEDGER_ROW],
        { income: '4500000.00', expenses: '1200000.00', balance: '3300000.00' },
        { total: 120 },
      ),
    })
    renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('Total in')).toBeInTheDocument()
    })
    const footer = document.querySelector('tfoot') as HTMLElement
    expect(within(footer).getByText('+4,500,000 RWF')).toBeInTheDocument()
    expect(within(footer).getByText('−1,200,000 RWF')).toBeInTheDocument()
    expect(within(footer).getByText('3,300,000 RWF')).toBeInTheDocument()
    expect(within(footer).getByText(/cover every page of the current filters/)).toBeInTheDocument()
    // The figure is not the page's: the page holds one row of twelve thousand.
    expect(within(footer).queryByText('+12,345.67 RWF')).toBeNull()
  })

  it('writes its filters into the address and sends them to the server', async () => {
    stubApi()
    const { router } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Money in or out'), { target: { value: 'EXPENSE' } })

    await waitFor(() => {
      expect(router.state.location.search).toContain('kind=EXPENSE')
    })
    fireEvent.change(screen.getByLabelText('Dated from'), { target: { value: '2026-08-01' } })

    await waitFor(() => {
      expect(router.state.location.search).toContain('from=2026-08-01')
    })
    await waitFor(() => {
      const request = lastCallTo('/finance/transactions')
      expect(request?.url).toContain('kind=EXPENSE')
      expect(request?.url).toContain('from=2026-08-01')
    })
  })

  it('reads its filters back out of the address, so a narrowed view can be bookmarked', async () => {
    stubApi()
    renderAt('/finance/transactions?kind=EXPENSE&method=BANK&status=VOID&sort=amount')

    await waitFor(() => {
      expect(screen.getByLabelText('Money in or out')).toHaveValue('EXPENSE')
    })
    expect(screen.getByLabelText('How the money moved')).toHaveValue('BANK')
    expect(screen.getByLabelText('State')).toHaveValue('VOID')
    expect(screen.getByLabelText('Order')).toHaveValue('amount')
  })

  it('offers no way to delete an entry', async () => {
    stubApi()
    renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    // A wrong entry is cancelled, which writes a correction. Deleting it would leave the books
    // short with nothing to show why.
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.queryByText(/remove/i)).toBeNull()
  })

  it('downloads the filtered ledger as a file, over every page of it', async () => {
    const created = vi.fn(() => 'blob:finance')
    vi.stubGlobal(
      'URL',
      Object.assign(Object.create(URL), URL, {
        createObjectURL: created,
        revokeObjectURL: vi.fn(),
      }),
    )
    stubApi({
      '/finance/export': () =>
        new Response('Reference\r\n"IN-2026-000042"\r\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition':
              'attachment; filename="finance-ABAH-2026-09-01-to-2026-09-30.csv"',
          },
        }),
    })
    renderAt('/finance/transactions?kind=INCOME')

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Export CSV'))

    await waitFor(() => {
      expect(lastCallTo('/finance/export')).toBeDefined()
    })
    const request = lastCallTo('/finance/export')
    expect(request?.url).toContain('kind=INCOME')
    expect(request?.url).toContain('format=csv')
    // Paging never applies to a file: the export covers the whole filtered set.
    expect(request?.url).not.toContain('pageSize=')
    await waitFor(() => {
      expect(created).toHaveBeenCalled()
    })
  })
})

describe('recording an entry', () => {
  it('sends the amount as the string it was typed as, and the kind that was chosen', async () => {
    stubApi({
      '/finance/transactions': replies((request) =>
        request.method === 'POST'
          ? { ...LEDGER_ROW, kind: 'EXPENSE', amount: '7500.50', reference: 'EX-2026-000018' }
          : paged([LEDGER_ROW], NO_TOTALS),
      ),
    })
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('Record money out')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record money out'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    // The dialog says which side of the books it is working on, because the reader chose it before
    // it opened rather than inside it.
    expect(within(openDialog()).getByText('Record money going out')).toBeInTheDocument()
    expect(within(openDialog()).getByLabelText('Expense category')).toBeInTheDocument()

    await waitFor(() => {
      expect(
        within(openDialog())
          .getByLabelText('Expense category')
          .querySelector(`option[value="${EXPENSE_CATEGORY_ID}"]`),
      ).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Expense category'), {
      target: { value: EXPENSE_CATEGORY_ID },
    })
    fireEvent.change(within(openDialog()).getByLabelText('Amount in RWF'), {
      target: { value: '7500.50' },
    })
    fireEvent.change(within(openDialog()).getByLabelText('What the money was for'), {
      target: { value: 'Transport to Kigali' },
    })
    submitForm('record-entry-form')

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true)
    })
    const posted = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>
    // A string on the wire, not a number: a float cannot hold a decimal amount exactly.
    expect(posted.amount).toBe('7500.50')
    expect(typeof posted.amount).toBe('string')
    expect(posted.kind).toBe('EXPENSE')
    expect(posted.categoryId).toBe(EXPENSE_CATEGORY_ID)
    expect(posted.method).toBe('CASH')
    expect(posted.description).toBe('Transport to Kigali')

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('refuses an amount with three decimal places before anything is sent', async () => {
    stubApi()
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('Record money in')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record money in'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    await waitFor(() => {
      expect(
        within(openDialog())
          .getByLabelText('Income category')
          .querySelector(`option[value="${INCOME_CATEGORY_ID}"]`),
      ).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Income category'), {
      target: { value: INCOME_CATEGORY_ID },
    })
    fireEvent.change(within(openDialog()).getByLabelText('Amount in RWF'), {
      target: { value: '1000.555' },
    })
    fireEvent.change(within(openDialog()).getByLabelText('What the money was for'), {
      target: { value: 'Membership fees' },
    })
    submitForm('record-entry-form')

    await waitFor(() => {
      expect(within(openDialog()).getByText(/at most two decimal places/)).toBeInTheDocument()
    })
    // Nothing was sent, so the server never had to refuse it.
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    await closeDialog()
    unmount()
  })

  it('names the member the money concerns, so it reaches their profile', async () => {
    stubApi({
      '/members': paged(
        [
          {
            id: 'a2f5c7e1-3b4d-4e5f-9a8b-7c6d5e4f3a2b',
            memberCode: 'ABAH-0007',
            firstName: 'Chantal',
            lastName: 'Mukamana',
            fullName: 'Chantal Mukamana',
            gender: 'FEMALE',
            phone: null,
            district: 'Musanze',
            sector: 'Muhoza',
            joinedOn: '2024-03-04',
            position: 'MEMBER',
            status: 'ACTIVE',
            nationalIdMasked: null,
          },
        ],
        NO_TOTALS,
      ),
      '/finance/transactions': replies((request) =>
        request.method === 'POST'
          ? { ...LEDGER_ROW, kind: 'EXPENSE', amount: '40000.00' }
          : paged([LEDGER_ROW], NO_TOTALS),
      ),
    })
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('Record money out')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record money out'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })

    // Without this field nothing would ever set a member on a ledger row, and the payments figure
    // on a member's profile could not be anything but nil.
    const picker = within(openDialog()).getByLabelText(/Member this concerns/)
    fireEvent.change(picker, { target: { value: 'Mukamana' } })

    await waitFor(() => {
      expect(within(openDialog()).getByText('ABAH-0007')).toBeInTheDocument()
    })
    fireEvent.keyDown(picker, { key: 'Enter' })

    await waitFor(() => {
      expect(
        within(openDialog())
          .getByLabelText('Expense category')
          .querySelector(`option[value="${EXPENSE_CATEGORY_ID}"]`),
      ).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Expense category'), {
      target: { value: EXPENSE_CATEGORY_ID },
    })
    fireEvent.change(within(openDialog()).getByLabelText('Amount in RWF'), {
      target: { value: '40000' },
    })
    fireEvent.change(within(openDialog()).getByLabelText('What the money was for'), {
      target: { value: 'First payment for delivered maize' },
    })
    submitForm('record-entry-form')

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true)
    })
    const posted = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>
    expect(posted.memberId).toBe('a2f5c7e1-3b4d-4e5f-9a8b-7c6d5e4f3a2b')

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('leaves the member out when nobody was named', async () => {
    stubApi({
      '/finance/transactions': replies((request) =>
        request.method === 'POST' ? LEDGER_ROW : paged([LEDGER_ROW], NO_TOTALS),
      ),
    })
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('Record money in')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record money in'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    await waitFor(() => {
      expect(
        within(openDialog())
          .getByLabelText('Income category')
          .querySelector(`option[value="${INCOME_CATEGORY_ID}"]`),
      ).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Income category'), {
      target: { value: INCOME_CATEGORY_ID },
    })
    fireEvent.change(within(openDialog()).getByLabelText('Amount in RWF'), {
      target: { value: '1000' },
    })
    fireEvent.change(within(openDialog()).getByLabelText('What the money was for'), {
      target: { value: 'Sale at the store' },
    })
    submitForm('record-entry-form')

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true)
    })
    const posted = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>
    // Most entries in a cooperative's books concern nobody in particular, so the field must not
    // be sent as an empty string the server would then have to refuse.
    expect('memberId' in posted).toBe(false)

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('restates what is about to be recorded before the button that records it', async () => {
    stubApi()
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('Record money in')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record money in'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Amount in RWF'), {
      target: { value: '250000' },
    })

    await waitFor(() => {
      expect(
        within(openDialog()).getByText(/250,000 RWF received by the cooperative/),
      ).toBeInTheDocument()
    })

    await closeDialog()
    unmount()
  })
})

describe('cancelling an entry', () => {
  it('sends the reason and names the correction that was written', async () => {
    stubApi({
      // One handler, because the stub matches on the longest key the URL contains and
      // `/finance/transactions` would otherwise swallow `/finance/transactions/<id>/void`.
      '/finance/transactions': replies((request) =>
        request.url.endsWith('/void')
          ? {
              voided: {
                id: ENTRY_ID,
                reference: 'IN-2026-000042',
                kind: 'INCOME',
                amount: '12345.67',
              },
              reversal: {
                id: 'reversal',
                reference: 'EX-2026-000007',
                kind: 'EXPENSE',
                amount: '12345.67',
              },
            }
          : paged([LEDGER_ROW], NO_TOTALS),
      ),
    })
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    // The dialog says outright that a correction is written and nothing is deleted.
    expect(
      within(openDialog()).getByText(/a matching correction of the opposite kind is written/),
    ).toBeInTheDocument()
    expect(within(openDialog()).getByText(/Nothing is deleted/)).toBeInTheDocument()

    fireEvent.change(within(openDialog()).getByLabelText('Why it is being cancelled'), {
      target: { value: 'Recorded twice by mistake' },
    })
    fireEvent.click(within(openDialog()).getByText('Cancel the entry'))

    await waitFor(() => {
      expect(screen.getByText(/The correction is EX-2026-000007/)).toBeInTheDocument()
    })
    const sent = lastCallTo('/void')
    expect(sent?.method).toBe('POST')
    expect(sent?.body).toEqual({ reason: 'Recorded twice by mistake' })

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('refuses to cancel an entry without a reason', async () => {
    stubApi()
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.click(within(openDialog()).getByText('Cancel the entry'))

    await waitFor(() => {
      expect(
        within(openDialog()).getByText('Say why this entry is being cancelled.'),
      ).toBeInTheDocument()
    })
    expect(lastCallTo('/void')).toBeUndefined()

    await closeDialog()
    unmount()
  })

  it('offers no cancel control for an entry that came from a member’s contribution', async () => {
    stubApi({ '/finance/transactions': paged([SOURCED_ROW], NO_TOTALS) })
    renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000043')).toBeInTheDocument()
    })
    // The ledger row and the member's record are two views of the same money, so the correction
    // has to be made where it was recorded. The screen says so instead of offering a control the
    // server would refuse.
    expect(screen.getByText("From a member's contribution")).toBeInTheDocument()
    expect(screen.getByText("Cancel this from the member's record")).toBeInTheDocument()
    expect(screen.queryByText('Cancel')).toBeNull()
    expect(screen.queryByText('Cancel the entry')).toBeNull()
  })

  it('says that the amount and the date of an entry can never be edited', async () => {
    stubApi()
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('Edit')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Edit'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()
    expect(within(dialog).getByText(/can never be changed/)).toBeInTheDocument()
    // Only the two fields a posted entry can still change are present.
    expect(within(dialog).getByLabelText('Category')).toBeInTheDocument()
    expect(within(dialog).getByLabelText('What the money was for')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/Amount/)).toBeNull()
    expect(within(dialog).queryByLabelText(/Date/)).toBeNull()

    await closeDialog()
    unmount()
  })
})

describe('taking the books away as a file', () => {
  it('offers both formats and asks the server for the one that was clicked', async () => {
    stubApi({ '/finance/transactions': paged([LEDGER_ROW], NO_TOTALS) })
    renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })

    // Two formats, because they are used for different things: the CSV opens anywhere, and the
    // workbook is what an accountant wants when the first thing they do is select the amount
    // column and read the sum.
    fireEvent.click(screen.getByText('Export CSV'))
    await waitFor(() => {
      expect(lastCallTo('/finance/export')?.url).toContain('format=csv')
    })

    fireEvent.click(screen.getByText('Export Excel'))
    await waitFor(() => {
      expect(lastCallTo('/finance/export')?.url).toContain('format=xlsx')
    })
  })

  it('takes the filters on screen into the file', async () => {
    stubApi({ '/finance/transactions': paged([LEDGER_ROW], NO_TOTALS) })
    renderAt('/finance/transactions?kind=EXPENSE&from=2026-03-01&to=2026-03-31')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Export CSV'))

    // The file has to contain the rows the reader was looking at, or the two disagree and the
    // one they keep is the wrong one.
    await waitFor(() => {
      const url = lastCallTo('/finance/export')?.url ?? ''
      expect(url).toContain('kind=EXPENSE')
      expect(url).toContain('from=2026-03-01')
      expect(url).toContain('to=2026-03-31')
    })
  })
})

describe('what a viewer may do', () => {
  it('shows a viewer the books and nothing that would change them', async () => {
    resetSession()
    signInAs('VIEWER')
    stubApi({ '/finance/transactions': paged([LEDGER_ROW], NO_TOTALS) })
    renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    // A viewer holds `finance:view` and nothing else. The server refuses each of these as well;
    // this is only about not offering a control that would fail.
    expect(screen.queryByText('Record money in')).toBeNull()
    expect(screen.queryByText('Record money out')).toBeNull()
    expect(screen.queryByText('Export CSV')).toBeNull()
    expect(screen.queryByText('Export Excel')).toBeNull()
    expect(screen.queryByText('Cancel')).toBeNull()
    expect(screen.queryByText('Edit')).toBeNull()
  })

  it('shows a viewer no way to add or change a category', async () => {
    resetSession()
    signInAs('VIEWER')
    stubApi()
    renderAt('/finance/categories')

    await waitFor(() => {
      expect(screen.getByText('Coffee sales')).toBeInTheDocument()
    })
    expect(screen.queryByText('Add an income category')).toBeNull()
    expect(screen.queryByText('Put out of service')).toBeNull()
    expect(screen.queryByText('Edit')).toBeNull()
  })
})

describe('the categories', () => {
  it('lists income and expenses separately, with their use and their origin', async () => {
    stubApi()
    renderAt('/finance/categories')

    await waitFor(() => {
      expect(screen.getByText('Coffee sales')).toBeInTheDocument()
    })
    expect(screen.getByText('Income categories')).toBeInTheDocument()
    expect(screen.getByText('Expense categories')).toBeInTheDocument()
    expect(screen.getByText('Kugurisha ikawa')).toBeInTheDocument()
    expect(screen.getByText('IN-01')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
    // A system category can be renamed, but where it came from is shown.
    expect(screen.getByText('Came with the system')).toBeInTheDocument()
  })

  it('gives a category no way to change its kind', async () => {
    stubApi({ '/finance/categories': [CATEGORIES[0]] })
    const { unmount } = renderAt('/finance/categories')

    await waitFor(() => {
      expect(screen.getByText('Coffee sales')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Edit'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()
    // Nothing to choose a kind with, anywhere in the dialog, and a sentence saying why.
    expect(dialog.querySelector('select')).toBeNull()
    expect(dialog.querySelector('input[type="radio"]')).toBeNull()
    expect(within(dialog).getByText(/kind can never change/)).toBeInTheDocument()
    expect(within(dialog).getByText(/This is an income category/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Coffee sales')

    await closeDialog()
    unmount()
  })

  it('deactivates a category rather than deleting it, and says what stays behind', async () => {
    stubApi({
      '/finance/categories': replies((request) =>
        request.method === 'PATCH' ? { ...CATEGORIES[0], isActive: false } : [CATEGORIES[0]],
      ),
    })
    const { unmount } = renderAt('/finance/categories')

    await waitFor(() => {
      expect(screen.getByText('Coffee sales')).toBeInTheDocument()
    })
    // The removal control says what it is: putting the category out of service, not deleting it.
    expect(screen.queryByText('Delete')).toBeNull()
    fireEvent.click(screen.getByText('Put out of service'))

    await waitFor(() => {
      expect(screen.getByText('Put Coffee sales out of service?')).toBeInTheDocument()
    })
    expect(screen.getByText(/12 entries are already recorded against it/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Yes, put it out of service'))

    await waitFor(() => {
      expect(screen.getByText('Coffee sales is out of service.')).toBeInTheDocument()
    })
    const sent = lastCallTo('/finance/categories/')
    expect(sent?.method).toBe('PATCH')
    expect(sent?.body).toEqual({ isActive: false })
    // Nothing was deleted, and nothing tried to be.
    expect(calls.some((call) => call.method === 'DELETE')).toBe(false)

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('adds a category on the side of the books it was opened from', async () => {
    stubApi({
      '/finance/categories': replies((request) =>
        request.method === 'POST'
          ? { ...CATEGORIES[1], name: 'Fertiliser', entryCount: 0, total: '0.00' }
          : CATEGORIES,
      ),
    })
    const { unmount } = renderAt('/finance/categories')

    await waitFor(() => {
      expect(screen.getByText('Add an expense category')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add an expense category'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Name'), {
      target: { value: 'Fertiliser' },
    })
    submitForm('category-form')

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true)
    })
    const posted = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>
    expect(posted.kind).toBe('EXPENSE')
    expect(posted.name).toBe('Fertiliser')

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })
})

describe('Kinyarwanda', () => {
  it('renders the whole ledger in Kinyarwanda, with no English left behind', async () => {
    await changeLanguage('rw')
    stubApi({
      '/finance/transactions': paged([LEDGER_ROW], {
        income: '12345.67',
        expenses: '0.00',
        balance: '12345.67',
      }),
    })
    renderAt('/finance/transactions')

    // The heading is there before the ledger loads, so the wait is for the table itself.
    await waitFor(() => {
      expect(document.querySelector('table')).not.toBeNull()
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent("Igitabo cy'amafaranga")
    expect(screen.getByText('Andika amafaranga yinjiye')).toBeInTheDocument()
    expect(screen.getByText('Andika amafaranga yasohotse')).toBeInTheDocument()
    expect(screen.getByText("Igiteranyo cy'ayinjiye")).toBeInTheDocument()
    expect(screen.getByText('Shakisha mu gitabo')).toBeInTheDocument()

    const table = document.querySelector('table') as HTMLElement
    expect(within(table).getByText('Byanditswe')).toBeInTheDocument()
    expect(within(table).getByText('Kugurisha ikawa')).toBeInTheDocument()

    // No English left behind on the screen.
    expect(screen.queryByText('Ledger')).toBeNull()
    expect(screen.queryByText('Record money in')).toBeNull()
    expect(screen.queryByText('Total in')).toBeNull()
    expect(screen.queryByText('Recorded')).toBeNull()
    expect(screen.queryByText('Search the ledger')).toBeNull()
    expect(screen.queryByText('Coffee sales')).toBeNull()
  })

  it('names the two sides of the books with the agreed Kinyarwanda terms', async () => {
    await changeLanguage('rw')
    stubApi()
    renderAt('/finance')

    await waitFor(() => {
      expect(screen.getAllByText('+3,200,000.45 RWF').length).toBeGreaterThan(0)
    })
    // The glossary fixes these three, and they are the same words everywhere in the product.
    const headline = screen.getByLabelText(/Iyi mibare itatu/)
    expect(within(headline).getByText('Amafaranga yinjiye')).toBeInTheDocument()
    expect(within(headline).getByText('Amafaranga yasohotse')).toBeInTheDocument()
    expect(within(headline).getByText('Amafaranga asigaye')).toBeInTheDocument()
    expect(screen.queryByText('Balance')).toBeNull()
    expect(screen.queryByText('Money in')).toBeNull()
  })

  it('uses Kureka for abandoning a form and Guhagarika for cancelling a record', async () => {
    await changeLanguage('rw')
    stubApi()
    const { unmount } = renderAt('/finance/transactions')

    await waitFor(() => {
      expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    })
    // The row action puts a record out of service, which is Guhagarika.
    fireEvent.click(screen.getByText('Guhagarika'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    // And the button that walks away from the dialog is never the same word as the one that goes
    // ahead with it, in either language.
    expect(within(openDialog()).getByText('Gikomeze kwandikwa')).toBeInTheDocument()
    expect(within(openDialog()).getByText('Emeza guhagarika icyanditswe')).toBeInTheDocument()
    expect(within(openDialog()).queryByText('Kureka')).toBeNull()

    await closeDialog()
    unmount()
  })
})

describe('translation parity for the finance namespace', () => {
  type Json = Record<string, unknown>

  function flatten(input: Json, prefix = ''): string[] {
    return Object.entries(input).flatMap(([key, value]) => {
      const path = prefix ? `${prefix}.${key}` : key
      if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
        return flatten(value as Json, path)
      }
      return [path]
    })
  }

  function read(bundle: Json, key: string): string {
    return String(key.split('.').reduce<unknown>((node, part) => (node as Json)?.[part], bundle))
  }

  const en = enFinance as Json
  const rw = rwFinance as Json

  it('ships the same keys in both languages', () => {
    expect(flatten(en).sort()).toEqual(flatten(rw).sort())
  })

  it('translates every one of them', () => {
    const identical = flatten(en).filter((key) => read(en, key) === read(rw, key))
    expect(identical, `untranslated: ${identical.join(', ')}`).toEqual([])
  })

  it('keeps the interpolation placeholders identical', () => {
    const placeholders = (text: string): string[] =>
      [...text.matchAll(/\{\{(\w+)\}\}/g)].map((match) => match[1] as string).sort()

    for (const key of flatten(en)) {
      expect(placeholders(read(rw, key)), `${key} placeholders differ`).toEqual(
        placeholders(read(en, key)),
      )
    }
  })

  it('leaves no value empty', () => {
    for (const bundle of [en, rw]) {
      for (const key of flatten(bundle)) {
        expect(read(bundle, key).trim().length, `${key} is empty`).toBeGreaterThan(0)
      }
    }
  })
})
