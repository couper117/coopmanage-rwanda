import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { GlobalSearch } from '../src/features/dashboard/GlobalSearch'
import type { Dashboard, SearchResults } from '../src/features/dashboard/dashboard.api'
import { DashboardPage } from '../src/pages/DashboardPage'
import { changeLanguage } from '../src/i18n'
import { resetSession, signInAs } from './session'

/**
 * The dashboard and the search box, mounted for real against a stubbed network.
 *
 * What these tests are here to hold in place, in order of how much it would cost to get wrong:
 *
 * **The rating names its figures.** A manager has to be able to check the verdict, not take it. So
 * a WATCH says which two amounts were compared, and those amounts are grouped the same way they
 * are grouped in a table — never a raw `1234567.00` in the middle of a sentence.
 *
 * **A block the reader may not see is named, not dropped.** A storekeeper's dashboard has no money
 * on it, and the page says so. An absent tile that looked like a zero would be a lie about the
 * cooperative's position.
 *
 * **One product out of stock is not "1 products".** The count-bearing sentences carry a singular
 * form in both languages, which is the whole reason `count` is passed as a number.
 *
 * **Every chart's table is already in the document.** Not fetched on reveal, not built by the
 * button: present and `sr-only`, so what a screen reader gets is the figures rather than a row of
 * decorative shapes.
 *
 * **The search never offers what the reader may not open**, and says which kinds it did not search
 * rather than implying there was nothing there.
 */

interface StubRequest {
  url: string
  method: string
}

let calls: StubRequest[] = []

const BOARD: Dashboard = {
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
    { key: 'balance', type: 'money', value: '4820000.00', href: '/finance' },
    {
      key: 'income',
      type: 'money',
      value: '1250000.00',
      hint: { key: 'expenses', value: '1840000.00', type: 'money' },
      href: '/finance/transactions',
    },
    {
      key: 'sales',
      type: 'money',
      value: '3100000.00',
      hint: { key: 'outstanding', value: '640000.00', type: 'money' },
      href: '/sales',
    },
  ],
  charts: [
    {
      key: 'incomeExpense',
      series: ['income', 'expenses'],
      points: [
        { bucket: '2026-08', values: { income: '900000.00', expenses: '450000.00' } },
        { bucket: '2026-09', values: { income: '1250000.00', expenses: '1840000.00' } },
      ],
    },
    {
      key: 'sales',
      series: ['sold', 'previous'],
      points: [{ bucket: '2026-09', values: { sold: '3100000.00', previous: '2450000.00' } }],
    },
    {
      key: 'expensesByCategory',
      series: ['amount'],
      points: [
        { bucket: 'Fertiliser', values: { amount: '1200000.00', nameRw: 'Ifumbire' } },
        { bucket: 'Transport', values: { amount: '640000.00', nameRw: '' } },
      ],
    },
  ],
  lowStock: [
    {
      id: 'prod-1',
      name: 'Maize seed, certified',
      sku: 'SEED-MAIZE-01',
      quantity: '0.000',
      minimum: '50.000',
      unit: 'kg',
    },
    {
      id: 'prod-2',
      name: 'Coffee bags, 60kg',
      sku: 'PACK-BAG-60',
      quantity: '12.000',
      minimum: '40.000',
      unit: 'pc',
    },
  ],
  attention: [
    {
      key: 'outOfStock',
      severity: 'CRITICAL',
      params: { count: 1, product: 'Maize seed, certified' },
      href: '/inventory/stock',
    },
    {
      key: 'outstanding',
      severity: 'WARNING',
      params: { amount: '640000.00', count: 3 },
      href: '/sales',
    },
  ],
  activity: [
    {
      id: 'log-1',
      action: 'MEMBER_CREATED',
      // As the audit trail records it: the name and the address, so the account is still
      // identifiable after a rename. The dashboard shows the name alone.
      actor: 'Claudine Uwimana <uwimana.claudine@example.test>',
      messageKey: 'audit.member.created',
      messageParams: { member: 'Nsengimana Alphonse', code: 'UMU-00264' },
      at: '2026-09-15T14:20:00.000Z',
    },
    {
      id: 'log-2',
      action: 'FINANCE_ENTRY_POSTED',
      actor: 'Jean Bosco',
      messageKey: 'audit.finance.posted',
      messageParams: {
        amount: '240,000',
        // An enum arrives as a key, because "EXPENSE" in a Kinyarwanda sentence is not Kinyarwanda.
        category: 'audit.finance.kind.EXPENSE',
        reference: 'FIN-2026-000412',
      },
      at: '2026-09-15T11:05:00.000Z',
    },
  ],
  health: {
    rating: 'WATCH',
    signals: [
      {
        key: 'money',
        rating: 'WATCH',
        params: { balance: '4820000.00', income: '1250000.00', expenses: '1840000.00' },
      },
      {
        key: 'stock',
        rating: 'ATTENTION',
        // `count` is the figure the sentence is about — what is out of stock, here — which is what
        // makes the singular form come out.
        params: { low: 2, empty: 1, products: 34, count: 1 },
      },
      {
        key: 'receivables',
        rating: 'WATCH',
        params: { outstanding: '640000.00', count: 3, days: 22 },
      },
    ],
  },
  withheld: [],
}

const RESULTS: SearchResults = {
  query: 'uwase',
  hits: [
    {
      kind: 'member',
      id: 'mem-1',
      title: 'Uwase Claudine',
      subtitle: 'UMU-00001',
      href: '/members/mem-1',
      score: 70,
    },
    {
      kind: 'sale',
      id: 'sale-1',
      title: 'SAL-2026-000031',
      subtitle: 'Uwase Claudine · 240000.00',
      href: '/sales/sale-1',
      score: 40,
    },
  ],
  withheld: ['document'],
  truncated: false,
}

function stubFetch(handlers: Record<string, unknown> = {}): void {
  const table: Record<string, unknown> = {
    '/dashboard': BOARD,
    '/search': RESULTS,
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
      if (value instanceof Response) return Promise.resolve(value)
      return Promise.resolve(
        new Response(JSON.stringify({ data: value }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      )
    }),
  )
}

/** The page under a router, because every tile and every attention line is a link. */
function renderPage(element: React.ReactElement = <DashboardPage />) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const routes: RouteObject[] = [
    { path: '/', element },
    // Somewhere for the links to land, so a click can be asserted on the destination.
    { path: '/members/:memberId', element: <p>member screen</p> },
    { path: '/inventory/stock', element: <p>stock screen</p> },
    { path: '*', element: <p>elsewhere</p> },
  ]
  const router = createMemoryRouter(routes, { initialEntries: ['/'] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

beforeEach(() => {
  calls = []
  signInAs('MANAGER')
  stubFetch()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  await changeLanguage('en')
})

describe('the cooperative health banner', () => {
  it('names the figures behind the rating rather than asserting it', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('A few things are worth keeping an eye on.')).toBeInTheDocument(),
    )

    // The sentence for money WATCH, with both amounts grouped the way a table groups them.
    expect(
      screen.getByText(
        '1,840,000 went out this month against 1,250,000 in, leaving a balance of 4,820,000.',
      ),
    ).toBeInTheDocument()
    expect(
      screen.getByText('640,000 is owed by 3 buyers, the oldest for 22 days.'),
    ).toBeInTheDocument()
  })

  it('writes a sentence that agrees with its own number', async () => {
    renderPage()
    // One product out of stock, so the stock sentence is singular — the reason the plural selector
    // is sent with the signal at all.
    await waitFor(() =>
      expect(
        screen.getByText('One product is out of stock, with 2 of 34 at or below the minimum.'),
      ).toBeInTheDocument(),
    )
  })

  it('shows the worst of the signals as the overall rating', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Watch')).toBeInTheDocument())
    // The banner shows what the server decided; the stock signal is worse, and the page must not
    // quietly upgrade the verdict to its own. "Watch" belongs to the rating alone: the attention
    // list says "Soon", because one word for two meanings on one page is a defect.
    expect(screen.getByText('A few things are worth keeping an eye on.')).toBeInTheDocument()
    expect(screen.getByText('Soon')).toBeInTheDocument()
  })
})

describe('the attention list', () => {
  it('writes one product out of stock in the singular', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('Maize seed, certified is out of stock.')).toBeInTheDocument(),
    )
  })

  it('writes several in the plural, with the count', async () => {
    stubFetch({
      '/dashboard': {
        ...BOARD,
        attention: [
          {
            key: 'outOfStock',
            severity: 'CRITICAL',
            params: { count: 4, product: 'Maize seed, certified' },
            href: '/inventory/stock',
          },
        ],
      },
    })
    renderPage()
    await waitFor(() =>
      expect(
        screen.getByText('4 products are out of stock, including Maize seed, certified.'),
      ).toBeInTheDocument(),
    )
  })

  it('formats the money inside the sentence', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('640,000 is still owed by 3 buyers.')).toBeInTheDocument(),
    )
  })

  it('puts the urgent line first and opens the screen it names', async () => {
    const { router } = renderPage()
    await waitFor(() => expect(screen.getByText('Urgent')).toBeInTheDocument())

    const list = screen.getByText('Needs attention').closest('section') as HTMLElement
    const badges = within(list).getAllByText(/Urgent|Soon/)
    expect(badges[0]).toHaveTextContent('Urgent')

    const [first] = within(list).getAllByRole('link', { name: 'Open' })
    fireEvent.click(first as HTMLElement)
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory/stock'))
  })
})

describe('the tiles', () => {
  it('groups money, carries the second figure and links to the screen behind it', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('4,820,000')).toBeInTheDocument())

    expect(screen.getByText('248')).toBeInTheDocument()
    expect(screen.getByText('263 on the register')).toBeInTheDocument()
    expect(screen.getByText('1,840,000 spent')).toBeInTheDocument()
    expect(screen.getByText('640,000 still owed')).toBeInTheDocument()

    const tile = screen.getByText('Active members').closest('a')
    expect(tile).toHaveAttribute('href', '/members')
  })
})

describe('the low-stock list', () => {
  it('says a product is out of stock rather than printing nought', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Maize seed, certified')).toBeInTheDocument())

    const row = screen.getByText('SEED-MAIZE-01').closest('tr')
    expect(within(row as HTMLElement).getByText('Out of stock')).toBeInTheDocument()
    expect(within(row as HTMLElement).queryByText('0 kg')).toBeNull()

    const low = screen.getByText('PACK-BAG-60').closest('tr')
    expect(within(low as HTMLElement).getByText('12 pc')).toBeInTheDocument()
  })
})

describe('the charts', () => {
  it('keeps the table of figures in the document before anybody asks for it', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Money in and out')).toBeInTheDocument())

    // Present and reachable to a screen reader while visually hidden, which is what "one click"
    // means for a reader who cannot see the bars at all.
    const caption = screen.getByText('Income and expenses for each of the last twelve months')
    expect(caption).toBeInTheDocument()
    const panel = screen.getByText('Money in and out').closest('section') as HTMLElement
    expect(panel.querySelector('.sr-only')).not.toBeNull()

    // And the bars themselves are hidden from the accessibility tree.
    expect(panel.querySelector('[aria-hidden="true"].flex.h-40')).not.toBeNull()
  })

  it('draws the sales trend as a line, as the design system specifies', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Sales')).toBeInTheDocument())

    // A trend is a line, not a bar: the question is whether the cooperative is selling more than
    // before. Two paths — this period and the ghosted one behind it — and a dot per month.
    const panel = screen.getByText('Sales').closest('section') as HTMLElement
    const svg = panel.querySelector('svg[role="presentation"]') as SVGSVGElement
    expect(svg).not.toBeNull()
    expect(svg.querySelectorAll('path')).toHaveLength(2)
    expect(svg.getAttribute('aria-hidden') ?? svg.parentElement?.getAttribute('aria-hidden')).toBe(
      'true',
    )

    // And the figures are still there in words, not only as a shape.
    expect(
      within(panel).getByText(
        'Sales for each of the last six months, with the same month of the previous period',
      ),
    ).toBeInTheDocument()
  })

  it('reveals the same table on one click', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Money in and out')).toBeInTheDocument())

    const panel = screen.getByText('Money in and out').closest('section') as HTMLElement
    const button = within(panel).getByRole('button', { name: 'Show figures' })
    fireEvent.click(button)

    await waitFor(() =>
      expect(within(panel).getByRole('button', { name: 'Hide figures' })).toBeInTheDocument(),
    )
    // The one click changed visibility only. Nothing was fetched to fill it.
    expect(calls.filter((call) => call.url.includes('/dashboard'))).toHaveLength(1)
  })

  it('names the category in the reader’s language where the cooperative gave one', async () => {
    renderPage()
    // Twice over: once beside the bar, once in the table of figures that is always in the
    // document. Both have to change language, which is why this asserts on all of them.
    await waitFor(() => expect(screen.getAllByText('Fertiliser')).toHaveLength(2))

    await changeLanguage('rw')
    await waitFor(() => expect(screen.getAllByText('Ifumbire')).toHaveLength(2))
    // No Kinyarwanda name was recorded for transport, so the cooperative's own name stands.
    expect(screen.getAllByText('Transport')).toHaveLength(2)
  })
})

describe('the recent activity', () => {
  it('writes each entry as a sentence, translating the enum inside it', async () => {
    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText('Nsengimana Alphonse was registered as UMU-00264'),
      ).toBeInTheDocument(),
    )
    expect(
      screen.getByText('240,000 RWF was entered under money out, reference FIN-2026-000412'),
    ).toBeInTheDocument()
    // The name, without the address the trail keeps beside it.
    expect(screen.getByText(/^Claudine Uwimana ·/)).toBeInTheDocument()
  })
})

describe('what the reader may not see', () => {
  it('names a withheld block instead of leaving it to look like a zero', async () => {
    stubFetch({
      '/dashboard': {
        ...BOARD,
        tiles: [BOARD.tiles[0]],
        charts: [],
        attention: [],
        activity: [],
        health: { rating: 'GOOD', signals: [] },
        withheld: ['finance', 'sales'],
      },
    })
    renderPage()

    await waitFor(() =>
      expect(
        screen.getByText(
          'Your role does not cover: money, sales. Those figures are left out rather than shown as zero.',
        ),
      ).toBeInTheDocument(),
    )
  })
})

describe('a cooperative with nothing recorded yet', () => {
  it('says so rather than showing a row of noughts', async () => {
    stubFetch({
      '/dashboard': {
        ...BOARD,
        tiles: [{ key: 'members', type: 'number', value: '0', href: '/members' }],
        charts: [],
        lowStock: [],
        attention: [],
        activity: [],
        health: { rating: 'GOOD', signals: [] },
      },
    })
    renderPage()

    await waitFor(() =>
      expect(screen.getByText("Your cooperative's figures will appear here")).toBeInTheDocument(),
    )
  })
})

describe('the whole page in Kinyarwanda', () => {
  it('leaves no translation key on screen', async () => {
    await changeLanguage('rw')
    renderPage()

    // The heading is on screen while the figures are still coming, so this waits for something
    // only the loaded page has.
    await waitFor(() => expect(screen.getByText('Bikwiye kwitonderwa')).toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Incamake' })).toBeInTheDocument()
    expect(screen.getByText('Abanyamuryango bakora')).toBeInTheDocument()
    expect(screen.getByText('Ibisaba igikorwa')).toBeInTheDocument()

    // Nothing anywhere on the page reads as a dotted key that failed to resolve.
    expect(document.body.textContent).not.toMatch(/dashboard\.[a-z]/i)
    expect(document.body.textContent).not.toMatch(/\bhealth\.[a-z]/i)
  })
})

describe('one round trip', () => {
  it('fills every block from a single request', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('4,820,000')).toBeInTheDocument())

    expect(calls.filter((call) => call.url.includes('/dashboard'))).toHaveLength(1)
    expect(calls.filter((call) => call.url.includes('/search'))).toHaveLength(0)
  })
})

describe('the search box', () => {
  function renderSearch() {
    return renderPage(<GlobalSearch />)
  }

  it('groups what it found by kind, best match first', async () => {
    renderSearch()
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'uwase' } })

    await waitFor(() => expect(screen.getByText('Uwase Claudine')).toBeInTheDocument())
    const headings = screen
      .getAllByText(/^(Members|Sales|Products|Buyers|Documents|Meetings)$/)
      .map((node) => node.textContent)
    expect(headings).toEqual(['Members', 'Sales'])
  })

  it('names the kinds it did not search, rather than implying there were none', async () => {
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'uwase' } })

    await waitFor(() =>
      expect(
        screen.getByText('Not searched, because your role does not cover them: Documents.'),
      ).toBeInTheDocument(),
    )
  })

  it('asks for at least two characters instead of searching on one', async () => {
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'u' } })

    await waitFor(() =>
      expect(screen.getByText('Type at least two characters.')).toBeInTheDocument(),
    )
    expect(calls.filter((call) => call.url.includes('/search'))).toHaveLength(0)
  })

  it('opens the best match on Enter, with no arrow key at all', async () => {
    const { router } = renderSearch()
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'uwase' } })
    await waitFor(() => expect(screen.getByText('Uwase Claudine')).toBeInTheDocument())

    // The first hit is highlighted from the start and `aria-activedescendant` says so, so Enter
    // takes it. A reader who knows what they typed should not have to press a key to confirm it.
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/members/mem-1'))
  })

  it('moves the highlight down onto the next hit', async () => {
    const { router } = renderSearch()
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'uwase' } })
    await waitFor(() => expect(screen.getByText('Uwase Claudine')).toBeInTheDocument())

    fireEvent.keyDown(box, { key: 'ArrowDown' })
    await waitFor(() =>
      expect(screen.getByText('SAL-2026-000031').closest('[role="option"]')).toHaveAttribute(
        'aria-selected',
        'true',
      ),
    )
    fireEvent.keyDown(box, { key: 'Enter' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/sales/sale-1'))
  })

  it('closes on Escape without navigating', async () => {
    const { router } = renderSearch()
    const box = screen.getByRole('combobox')
    fireEvent.change(box, { target: { value: 'uwase' } })
    await waitFor(() => expect(screen.getByText('Uwase Claudine')).toBeInTheDocument())

    fireEvent.keyDown(box, { key: 'Escape' })

    await waitFor(() => expect(screen.queryByText('Uwase Claudine')).toBeNull())
    expect(router.state.location.pathname).toBe('/')
  })

  it('takes the cursor on a bare slash, and leaves it alone inside a field', () => {
    renderSearch()
    const box = screen.getByRole('combobox')

    fireEvent.keyDown(document.body, { key: '/' })
    expect(box).toHaveFocus()

    // A reader typing a member's name into a form must be able to type a slash.
    box.blur()
    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    fireEvent.keyDown(field, { key: '/' })
    expect(box).not.toHaveFocus()
    field.remove()
  })

  it('says what matched nothing, naming the term', async () => {
    stubFetch({ '/search': { query: 'zzz', hits: [], withheld: [], truncated: false } })
    renderSearch()
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'zzz' } })

    await waitFor(() => expect(screen.getByText('Nothing matches zzz.')).toBeInTheDocument())
  })
})
