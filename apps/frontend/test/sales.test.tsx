import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { buyerRoutes, salesRoutes } from '../src/features/sales/salesRoutes'
import type { BuyerRow, SaleRow } from '../src/features/sales/sales.api'
import i18n, { changeLanguage } from '../src/i18n'
import enSales from '../src/i18n/locales/en/sales.json'
import rwSales from '../src/i18n/locales/rw/sales.json'
import { resetSession, signInAs } from './session'

/**
 * Sales and buyers, mounted for real against a stubbed network.
 *
 * The routes, the permission guard, the sale form, the three dialogs and the printable receipt all
 * run; only `fetch` is faked. Two jsdom constraints shape how this file is written, both learned
 * the hard way in `cooperative.test.tsx` and again in `finance.test.tsx`: `userEvent`'s pointer
 * simulation does not terminate against a Radix portal, and a `byRole` query carrying a `name`
 * option takes seconds against one. So everything here uses `fireEvent` and queries by text, label
 * or selector — and no test is allowed to end with a dialog still open, because the layer it leaves
 * behind slows or confuses whatever renders next.
 *
 * The `sales` namespace is registered here rather than relied upon from `src/i18n/index.ts`, so
 * this suite tests the feature as it stands on its own.
 */
i18n.addResourceBundle('en', 'sales', enSales, true, true)
i18n.addResourceBundle('rw', 'sales', rwSales, true, true)

const SALE_ID = '1a2b3c4d-5e6f-4071-8293-0a1b2c3d4e5f'
const DRAFT_ID = '2b3c4d5e-6f70-4182-93a4-1b2c3d4e5f60'
const CANCELLED_ID = '3c4d5e6f-7081-4293-a4b5-2c3d4e5f6071'
const BUYER_ID = '4d5e6f70-8192-43a4-b5c6-3d4e5f607182'
const WAREHOUSE_ID = '5e6f7081-92a3-44b5-c6d7-4e5f60718293'
const PRODUCT_ID = '6f708192-a3b4-45c6-d7e8-5f6071829304'
const CATEGORY_ID = '70819203-b4c5-46d7-e8f9-6071829304a5'

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

function paged(items: unknown[], extra: Record<string, unknown> = {}): Paged {
  return {
    __paged: true,
    items,
    meta: {
      page: 1,
      pageSize: 25,
      total: items.length,
      totalPages: 1,
      ...extra,
    },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

let calls: StubRequest[] = []

function lastCallTo(fragment: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment))
}

/**
 * The most recent write to a path, as opposed to the most recent request of any kind: a successful
 * mutation invalidates the feature and the refetch that follows is a `GET` to the same path.
 */
function lastWriteTo(fragment: string, method: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment) && call.method === method)
}

function refusal(status: number, code: string, messageKey: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, messageKey, message, requestId: 'test' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Deliberately not round. A sale is arithmetic a buyer is held to, so these figures carry their
 * centimes and are the proof that what the server sent is what the screen shows.
 */
const CONFIRMED_SALE: SaleRow = {
  id: SALE_ID,
  reference: 'SL-2026-000042',
  buyerId: BUYER_ID,
  buyerName: 'Musanze District Produce Buyer',
  warehouseId: WAREHOUSE_ID,
  warehouseName: 'Main store',
  saleDate: '2026-07-09',
  status: 'CONFIRMED',
  paymentStatus: 'PARTIAL',
  subtotal: '3690000.50',
  discount: '150000.00',
  taxAmount: '0.00',
  total: '3540000.50',
  amountPaid: '2500000.00',
  outstanding: '1040000.50',
  note: 'Second lot of the season',
  confirmedAt: '2026-07-09T09:15:00.000Z',
  cancelledAt: null,
  cancelReason: null,
  lineCount: 1,
}

const DRAFT_SALE: SaleRow = {
  ...CONFIRMED_SALE,
  id: DRAFT_ID,
  reference: 'SL-2026-000043',
  status: 'DRAFT',
  paymentStatus: 'UNPAID',
  amountPaid: '0.00',
  outstanding: '3540000.50',
  confirmedAt: null,
}

const CANCELLED_SALE: SaleRow = {
  ...CONFIRMED_SALE,
  id: CANCELLED_ID,
  reference: 'SL-2026-000041',
  status: 'CANCELLED',
  paymentStatus: 'UNPAID',
  amountPaid: '0.00',
  // A cancelled sale keeps its total and owes nothing, which is the distinction the screen has to
  // carry: a treasurer scanning the owed column must not be sent after business that was undone.
  outstanding: '0.00',
  cancelledAt: '2026-08-23T11:00:00.000Z',
  cancelReason: 'The buyer rejected the moisture content on delivery',
}

const LINES = [
  {
    id: 'line-1',
    productId: PRODUCT_ID,
    productName: 'Maize grain',
    sku: 'MAIZE-GRAIN',
    unitId: 'unit-kg',
    unitSymbol: 'kg',
    quantity: '8200.000',
    unitPrice: '450.00',
    lineTotal: '3690000.00',
    note: null,
    position: 0,
  },
]

function detailOf(sale: SaleRow, extra: Record<string, unknown> = {}) {
  return {
    ...sale,
    lines: LINES,
    payments:
      sale.status === 'CONFIRMED'
        ? [
            {
              id: 'pay-1',
              reference: 'IN-2026-000101',
              amount: '2500000.00',
              method: 'MOBILE_MONEY',
              occurredAt: '2026-07-09',
            },
          ]
        : [],
    movements:
      sale.status === 'DRAFT'
        ? []
        : [
            {
              id: 'mv-1',
              reference: 'STK-2026-000201',
              productName: 'Maize grain',
              quantity: '8200.000',
            },
          ],
    ...extra,
  }
}

const BUYERS: BuyerRow[] = [
  {
    id: BUYER_ID,
    name: 'Musanze District Produce Buyer',
    organization: 'Musanze District',
    contactPerson: 'Habimana Jean Baptiste',
    phone: '+250788301122',
    email: null,
    tin: '102345678',
    province: 'NORTHERN',
    district: 'Musanze',
    sector: 'Muhoza',
    address: null,
    notes: null,
    isActive: true,
    saleCount: 2,
    totalSold: '6690000.50',
    outstanding: '1040000.50',
    lastSaleDate: '2026-07-09',
  },
]

const SUMMARY = {
  from: '2026-09-01',
  to: '2026-09-30',
  groupBy: 'day',
  sold: '8560500.00',
  paid: '7520500.00',
  outstanding: '1040000.00',
  saleCount: 4,
  buckets: [
    { start: '2026-09-01', sold: '0.00', saleCount: 0 },
    { start: '2026-09-08', sold: '255500.00', saleCount: 1 },
  ],
  topBuyers: [
    { buyerId: BUYER_ID, name: 'Musanze District Produce Buyer', sold: '6690000.50', saleCount: 2 },
  ],
  topProducts: [
    {
      productId: PRODUCT_ID,
      name: 'Maize grain',
      sku: 'MAIZE-GRAIN',
      quantity: '15200.000',
      sold: '6840000.00',
    },
  ],
}

const PRODUCTS = [
  {
    id: PRODUCT_ID,
    sku: 'MAIZE-GRAIN',
    name: 'Maize grain',
    nameRw: 'Ibigori',
    categoryId: null,
    categoryName: null,
    unitId: 'unit-kg',
    unitSymbol: 'kg',
    unitName: 'Kilogram',
    type: 'GOODS',
    trackInventory: true,
    minStockLevel: '2000.000',
    defaultPurchasePrice: '380.00',
    defaultSalePrice: '450.00',
    description: null,
    isActive: true,
    quantityOnHand: '14650.000',
    hasMovements: true,
  },
]

const WAREHOUSES = [
  {
    id: WAREHOUSE_ID,
    name: 'Main store',
    code: 'MAIN',
    district: 'Musanze',
    sector: 'Muhoza',
    isDefault: true,
    isActive: true,
    productsHeld: 8,
    quantityHeld: '30000.000',
  },
]

const RECEIPT = {
  sale: detailOf(CONFIRMED_SALE),
  cooperative: {
    name: 'Umurenge Farmers Cooperative',
    code: 'UMURENGE-MUSANZE',
    district: 'Musanze',
    sector: 'Muhoza',
  },
  buyer: BUYERS[0],
  issuedAt: '2026-09-15T08:30:00.000Z',
  issuedBy: 'Claudine Uwimana',
}

function stubApi(handlers: Record<string, StubValue> = {}) {
  calls = []
  const table: Record<string, StubValue> = {
    '/settings': { enabledModules: ['sales', 'buyers'] },
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/cooperatives/mine': [],
    '/warehouses': WAREHOUSES,
    '/products': paged(PRODUCTS),
    // The whole row, because the dialog filters to the active categories and a stub missing
    // `isActive` would leave the select empty and the form unable to submit.
    '/finance/categories': [
      {
        id: CATEGORY_ID,
        kind: 'INCOME',
        name: 'Sale of produce',
        nameRw: 'Kugurisha umusaruro',
        code: null,
        isActive: true,
        isSystem: true,
        entryCount: 4,
        total: '8560500.00',
      },
    ],
    '/buyers': paged(BUYERS),
    [`/buyers/${BUYER_ID}/summary`]: {
      buyer: BUYERS[0],
      sales: [CONFIRMED_SALE],
      totals: { sold: '6690000.50', paid: '5650000.00', outstanding: '1040000.50' },
    },
    [`/buyers/${BUYER_ID}`]: BUYERS[0],
    '/sales/summary': SUMMARY,
    [`/sales/${SALE_ID}/receipt`]: RECEIPT,
    [`/sales/${SALE_ID}`]: detailOf(CONFIRMED_SALE),
    [`/sales/${DRAFT_ID}`]: detailOf(DRAFT_SALE),
    [`/sales/${CANCELLED_ID}`]: detailOf(CANCELLED_SALE),
    '/sales': paged([DRAFT_SALE, CONFIRMED_SALE, CANCELLED_SALE], {
      totals: { sold: '3540000.50', paid: '2500000.00', outstanding: '1040000.50' },
    }),
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
        return Promise.resolve(refusal(404, 'NOT_FOUND', 'errors.notFound', 'no stub'))
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

const routes: RouteObject[] = [...salesRoutes, ...buyerRoutes].map((route) => ({
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
  return { ...view, router }
}

function openDialog(): HTMLElement {
  return document.querySelector('[role="dialog"]') as HTMLElement
}

async function closeDialog(): Promise<void> {
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await waitFor(() => {
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
}

function submitForm(id: string): void {
  fireEvent.submit(document.getElementById(id) as HTMLFormElement)
}

beforeEach(() => {
  signInAs('MANAGER')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  await changeLanguage('en')
})

describe('the sales list', () => {
  it('shows each sale with its state and what is still owed', async () => {
    stubApi()
    const { unmount } = renderAt('/sales')

    await waitFor(() => {
      expect(screen.getByText('SL-2026-000042')).toBeInTheDocument()
    })
    expect(screen.getByText('SL-2026-000043')).toBeInTheDocument()
    expect(screen.getByText('SL-2026-000041')).toBeInTheDocument()
    // The figures arrive as strings and are shown as sent, centimes and all.
    expect(screen.getAllByText(/3,540,000\.5/).length).toBeGreaterThan(0)
    unmount()
  })

  it('says the footer totals cover confirmed sales only', async () => {
    stubApi()
    const { unmount } = renderAt('/sales')

    await waitFor(() => {
      expect(screen.getByText('SL-2026-000042')).toBeInTheDocument()
    })
    // A draft is an intention somebody typed and a cancelled sale is business that was undone.
    // Counting either would overstate what the cooperative sold.
    expect(screen.getByText(/Confirmed sales only/)).toBeInTheDocument()
    expect(screen.getAllByText(/2,500,000/).length).toBeGreaterThan(0)
    unmount()
  })

  it('carries the filters into the address, so a narrowed view can be sent to somebody', async () => {
    stubApi()
    const { unmount, router } = renderAt('/sales')

    await waitFor(() => {
      expect(screen.getByText('SL-2026-000042')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('State of the sale'), {
      target: { value: 'CONFIRMED' },
    })

    await waitFor(() => {
      expect(router.state.location.search).toContain('status=CONFIRMED')
    })
    expect(lastCallTo('/sales?')?.url).toContain('status=CONFIRMED')
    unmount()
  })

  it('reports what was sold over the period, and to whom', async () => {
    stubApi()
    const { unmount } = renderAt('/sales')

    await waitFor(() => {
      expect(screen.getAllByText('Musanze District Produce Buyer').length).toBeGreaterThan(0)
    })
    // The top products figure is a quantity and keeps its three decimal places.
    expect(screen.getByText(/15,200/)).toBeInTheDocument()
    unmount()
  })

  it('shows a viewer the sales and nothing that would change them', async () => {
    resetSession()
    signInAs('VIEWER')
    stubApi()
    const { unmount } = renderAt('/sales')

    await waitFor(() => {
      expect(screen.getByText('SL-2026-000042')).toBeInTheDocument()
    })
    // A viewer holds the read permissions only. The server refuses each of these as well; this is
    // about not offering a control that would fail.
    expect(screen.queryByText('Record a sale')).toBeNull()
    unmount()
  })
})

describe('writing up a sale', () => {
  it('works out each line and the sale total for the reader to check', async () => {
    stubApi()
    const { unmount } = renderAt('/sales/new')

    await waitFor(() => {
      expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
    })

    // A line with no product contributes nothing, so that the running total stays readable while
    // somebody is still typing. The product comes first.
    const productBox = screen.getByLabelText(/^Product/)
    fireEvent.change(productBox, { target: { value: 'Maize' } })
    await waitFor(() => {
      expect(screen.getByText(/MAIZE-GRAIN/)).toBeInTheDocument()
    })
    fireEvent.keyDown(productBox, { key: 'Enter' })

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '8200' } })
    fireEvent.change(screen.getByLabelText('Price of one in RWF'), { target: { value: '450' } })

    await waitFor(() => {
      expect(screen.getAllByText(/3,690,000/).length).toBeGreaterThan(0)
    })
    // Worked out here only so it can be checked against the receipt. The server prices the sale
    // and is the authority, which is why no total is ever sent.
    expect(screen.getByText(/worked out here/)).toBeInTheDocument()
    unmount()
  })

  it('sends the lines as strings, and never a total', async () => {
    stubApi({
      '/sales': replies((request) =>
        request.method === 'POST' ? detailOf(DRAFT_SALE) : paged([DRAFT_SALE]),
      ),
    })
    const { unmount } = renderAt('/sales/new')

    await waitFor(() => {
      expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
    })

    const buyerBox = screen.getByLabelText(/Buyer/)
    fireEvent.change(buyerBox, { target: { value: 'Musanze' } })
    await waitFor(() => {
      expect(screen.getByText('Musanze District Produce Buyer')).toBeInTheDocument()
    })
    fireEvent.keyDown(buyerBox, { key: 'Enter' })

    const productBox = screen.getByLabelText(/^Product/)
    fireEvent.change(productBox, { target: { value: 'Maize' } })
    await waitFor(() => {
      expect(screen.getByText(/MAIZE-GRAIN/)).toBeInTheDocument()
    })
    fireEvent.keyDown(productBox, { key: 'Enter' })

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '8200.5' } })
    fireEvent.change(screen.getByLabelText('Price of one in RWF'), { target: { value: '450' } })
    submitForm('sale-form')

    await waitFor(() => {
      expect(lastWriteTo('/sales', 'POST')).toBeDefined()
    })
    const posted = lastWriteTo('/sales', 'POST')?.body as {
      lines: { quantity: string; unitPrice: string }[]
      total?: string
    }
    expect(posted.lines[0]?.quantity).toBe('8200.5')
    expect(typeof posted.lines[0]?.quantity).toBe('string')
    expect(posted.lines[0]?.unitPrice).toBe('450')
    // The total is the server's to compute. Sending one would invite the two to disagree.
    expect('total' in posted).toBe(false)
    unmount()
  })

  it('refuses a discount larger than the lines before anything is sent', async () => {
    stubApi()
    const { unmount } = renderAt('/sales/new')

    await waitFor(() => {
      expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
    })
    const chosen = screen.getByLabelText(/^Product/)
    fireEvent.change(chosen, { target: { value: 'Maize' } })
    await waitFor(() => {
      expect(screen.getByText(/MAIZE-GRAIN/)).toBeInTheDocument()
    })
    fireEvent.keyDown(chosen, { key: 'Enter' })

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '10' } })
    fireEvent.change(screen.getByLabelText('Price of one in RWF'), { target: { value: '100' } })
    fireEvent.change(screen.getByLabelText(/Discount in RWF/), { target: { value: '5000' } })
    submitForm('sale-form')

    await waitFor(() => {
      expect(screen.getByText(/would make the sale/i)).toBeInTheDocument()
    })
    // A discount bigger than what is being discounted turns the total negative, and the server
    // refuses it as well. Catching it here saves a round trip and says so on the field.
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    unmount()
  })

  it('warns about a line for more than the store holds, without blocking it', async () => {
    stubApi()
    const { unmount } = renderAt('/sales/new')

    await waitFor(() => {
      expect(screen.getByLabelText('Quantity')).toBeInTheDocument()
    })
    const productBox = screen.getByLabelText(/^Product/)
    fireEvent.change(productBox, { target: { value: 'Maize' } })
    await waitFor(() => {
      expect(screen.getByText(/MAIZE-GRAIN/)).toBeInTheDocument()
    })
    fireEvent.keyDown(productBox, { key: 'Enter' })

    fireEvent.change(screen.getByLabelText('Quantity'), { target: { value: '99999' } })

    // A draft for more than the store holds is legitimate: the sale is often written up before
    // the stock is counted, and the check happens at confirmation.
    await waitFor(() => {
      expect(screen.getByText(/recorded as holding/)).toBeInTheDocument()
    })
    unmount()
  })
})

describe('the sale detail', () => {
  it('offers a draft the actions that apply to a draft', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${DRAFT_ID}`)

    await waitFor(() => {
      expect(screen.getByText(/SL-2026-000043/)).toBeInTheDocument()
    })
    expect(screen.getByText('Change the draft')).toBeInTheDocument()
    expect(screen.getByText('Confirm the sale')).toBeInTheDocument()
    // Nothing has left the store, so there is nothing to be paid for yet.
    expect(screen.queryByText('Record a payment')).toBeNull()
    expect(screen.getByText(/Nothing has left the store/)).toBeInTheDocument()
    unmount()
  })

  it('offers a confirmed sale no way to change it', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${SALE_ID}`)

    await waitFor(() => {
      expect(screen.getByText(/SL-2026-000042/)).toBeInTheDocument()
    })
    // A confirmed sale has left the store and been paid against.
    expect(screen.queryByText('Change the draft')).toBeNull()
    expect(screen.queryByText('Confirm the sale')).toBeNull()
    expect(screen.getByText('Record a payment')).toBeInTheDocument()
    expect(screen.getByText('Cancel the sale')).toBeInTheDocument()
    unmount()
  })

  it('says why a cancelled sale was cancelled, and offers nothing further', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${CANCELLED_ID}`)

    await waitFor(() => {
      expect(screen.getByText(/SL-2026-000041/)).toBeInTheDocument()
    })
    expect(screen.getByText(/rejected the moisture content/)).toBeInTheDocument()
    expect(screen.queryByText('Confirm the sale')).toBeNull()
    expect(screen.queryByText('Cancel the sale')).toBeNull()
    expect(screen.queryByText('Record a payment')).toBeNull()
    unmount()
  })

  it('shows the stock that left and the money that came in', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${SALE_ID}`)

    await waitFor(() => {
      expect(screen.getByText('STK-2026-000201')).toBeInTheDocument()
    })
    expect(screen.getByText('IN-2026-000101')).toBeInTheDocument()
    expect(screen.getAllByText(/8,200/).length).toBeGreaterThan(0)
    unmount()
  })

  it('shows an accountant the confirm control and not the cancel one', async () => {
    resetSession()
    signInAs('ACCOUNTANT')
    stubApi()
    const { unmount } = renderAt(`/sales/${DRAFT_ID}`)

    await waitFor(() => {
      expect(screen.getByText(/SL-2026-000043/)).toBeInTheDocument()
    })
    // An accountant may complete a sale but not undo one, which is a different decision.
    expect(screen.getByText('Confirm the sale')).toBeInTheDocument()
    expect(screen.queryByText('Cancel the sale')).toBeNull()
    unmount()
  })
})

describe('confirming', () => {
  it('sends the payment fields together', async () => {
    stubApi({
      [`/sales/${DRAFT_ID}/confirm`]: replies(() => detailOf(CONFIRMED_SALE)),
    })
    const { unmount } = renderAt(`/sales/${DRAFT_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Confirm the sale')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Confirm the sale'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText(/Paid now in RWF/), {
      target: { value: '2500000' },
    })
    await waitFor(() => {
      expect(
        within(openDialog())
          .getByLabelText('Where the money goes in the books')
          .querySelector(`option[value="${CATEGORY_ID}"]`),
      ).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Where the money goes in the books'), {
      target: { value: CATEGORY_ID },
    })
    submitForm('confirm-sale-form')

    await waitFor(() => {
      expect(lastWriteTo('/confirm', 'POST')).toBeDefined()
    })
    const sent = lastWriteTo('/confirm', 'POST')?.body as Record<string, unknown>
    expect(sent.amountPaid).toBe('2500000')
    expect(sent.incomeCategoryId).toBe(CATEGORY_ID)

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('reports an insufficient-stock refusal as still a draft with nothing moved', async () => {
    stubApi({
      [`/sales/${DRAFT_ID}/confirm`]: replies(() =>
        refusal(
          409,
          'INSUFFICIENT_STOCK',
          'errors.inventory.insufficientStock',
          'not enough stock',
        ),
      ),
    })
    const { unmount } = renderAt(`/sales/${DRAFT_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Confirm the sale')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Confirm the sale'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    submitForm('confirm-sale-form')

    // The server does not say how much stock there is, because the figure the reader saw may
    // already be stale. What it can say for certain is that nothing moved.
    await waitFor(() => {
      expect(within(openDialog()).getByText(/still a draft/i)).toBeInTheDocument()
    })

    await closeDialog()
    unmount()
  })

  it('offers no payment fields to somebody who may not write into the books', async () => {
    resetSession()
    // An inventory officer holds no finance permission at all, so recording the money is not
    // theirs to do — but they have no sales:confirm either, so the guard is what to check.
    signInAs('MANAGER', { permissions: ['sales:view', 'sales:confirm', 'dashboard:view'] })
    stubApi()
    const { unmount } = renderAt(`/sales/${DRAFT_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Confirm the sale')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Confirm the sale'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    expect(within(openDialog()).queryByLabelText(/Paid now in RWF/)).toBeNull()
    expect(within(openDialog()).getByText(/needs the books/)).toBeInTheDocument()

    await closeDialog()
    unmount()
  })
})

describe('cancelling', () => {
  it('asks for a reason and says the stock goes back', async () => {
    stubApi({
      [`/sales/${SALE_ID}/cancel`]: replies(() => detailOf(CANCELLED_SALE)),
    })
    const { unmount } = renderAt(`/sales/${SALE_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Cancel the sale')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Cancel the sale'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    // Said plainly, because the two are new entries rather than the first ones being removed.
    expect(within(openDialog()).getByText(/goes back/i)).toBeInTheDocument()

    fireEvent.change(within(openDialog()).getByLabelText(/Why it is being cancelled/), {
      target: { value: 'The buyer rejected the quality' },
    })
    fireEvent.click(within(openDialog()).getByText('Cancel the sale', { selector: 'button' }))

    await waitFor(() => {
      expect(lastWriteTo('/cancel', 'POST')).toBeDefined()
    })
    expect((lastWriteTo('/cancel', 'POST')?.body as { reason: string }).reason).toBe(
      'The buyer rejected the quality',
    )

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('refuses to cancel with no reason given', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${SALE_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Cancel the sale')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Cancel the sale'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.click(within(openDialog()).getByText('Cancel the sale', { selector: 'button' }))

    // A cancelled sale that cannot be explained is one nobody can audit.
    await waitFor(() => {
      expect(
        within(openDialog()).getByText('Say why this sale is being cancelled.'),
      ).toBeInTheDocument()
    })
    expect(calls.some((call) => call.url.includes('/cancel'))).toBe(false)

    await closeDialog()
    unmount()
  })
})

describe('recording a payment', () => {
  it('refuses more than is still owed before anything is sent', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${SALE_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Record a payment')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record a payment'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText(/Amount/i), {
      target: { value: '9999999' },
    })
    submitForm('sale-payment-form')

    // Overpaying is a data-entry slip rather than a payment, and accepting it would show more
    // received than the sale was ever worth.
    await waitFor(() => {
      expect(within(openDialog()).getByText(/more than/i)).toBeInTheDocument()
    })
    expect(calls.some((call) => call.url.includes('/payments'))).toBe(false)

    await closeDialog()
    unmount()
  })
})

describe('the receipt', () => {
  it('carries the cooperative, the buyer, the lines and the totals', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${SALE_ID}/receipt`)

    await waitFor(() => {
      expect(screen.getByText('Umurenge Farmers Cooperative')).toBeInTheDocument()
    })
    expect(screen.getByText(/Musanze District, Muhoza Sector/)).toBeInTheDocument()
    expect(screen.getByText('Musanze District Produce Buyer')).toBeInTheDocument()
    expect(screen.getByText('SL-2026-000042')).toBeInTheDocument()
    expect(screen.getByText('Maize grain')).toBeInTheDocument()
    // Every figure is printed exactly as the server sent it, so nothing in the printing path can
    // arrive at a different total from the books.
    expect(screen.getAllByText(/3,540,000\.5/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Claudine Uwimana/)).toBeInTheDocument()
    unmount()
  })

  it('says in words what state the sale is in, rather than only in colour', async () => {
    stubApi()
    const { unmount } = renderAt(`/sales/${SALE_ID}/receipt`)

    await waitFor(() => {
      expect(screen.getByText('Umurenge Farmers Cooperative')).toBeInTheDocument()
    })
    // A coloured badge carries nothing on paper, and a photocopy carries less.
    expect(screen.getByText('State of the sale')).toBeInTheDocument()
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0)
    unmount()
  })

  it('warns when a draft is being printed', async () => {
    stubApi({
      [`/sales/${SALE_ID}/receipt`]: { ...RECEIPT, sale: detailOf(DRAFT_SALE) },
    })
    const { unmount } = renderAt(`/sales/${SALE_ID}/receipt`)

    await waitFor(() => {
      expect(screen.getByText(/still a draft/i)).toBeInTheDocument()
    })
    unmount()
  })
})

describe('buyers', () => {
  it('shows what each has bought and what each still owes', async () => {
    stubApi()
    const { unmount } = renderAt('/buyers')

    await waitFor(() => {
      expect(screen.getByText('Musanze District Produce Buyer')).toBeInTheDocument()
    })
    expect(screen.getAllByText(/6,690,000\.5/).length).toBeGreaterThan(0)
    expect(screen.getByText(/Confirmed sales only/)).toBeInTheDocument()
    unmount()
  })

  it('needs a name and nothing else to add one', async () => {
    stubApi({
      '/buyers': replies((request) => (request.method === 'POST' ? BUYERS[0] : paged(BUYERS))),
    })
    const { unmount } = renderAt('/buyers')

    await waitFor(() => {
      expect(screen.getByText('Add a buyer')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add a buyer'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText(/^Name/), {
      target: { value: 'Kigali wholesaler' },
    })
    submitForm('buyer-form')

    await waitFor(() => {
      expect(lastWriteTo('/buyers', 'POST')).toBeDefined()
    })
    // Whoever records a sale at the store has the buyer's name and may have nothing else.
    const posted = lastWriteTo('/buyers', 'POST')?.body as Record<string, unknown>
    expect(posted.name).toBe('Kigali wholesaler')

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('offers no way to delete a buyer', async () => {
    stubApi()
    const { unmount } = renderAt('/buyers')

    await waitFor(() => {
      expect(screen.getByText('Musanze District Produce Buyer')).toBeInTheDocument()
    })
    // Every confirmed sale names them, and a report has to be able to say who bought the maize.
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.getByText(/never deleted/)).toBeInTheDocument()
    unmount()
  })

  it('shows a buyer history, and says so when it is withheld', async () => {
    stubApi()
    const { unmount } = renderAt(`/buyers/${BUYER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('SL-2026-000042')).toBeInTheDocument()
    })
    unmount()

    resetSession()
    // Buyer list without the sales: the history is withheld rather than shown as empty, which
    // would read as a buyer who has never bought anything.
    signInAs('MANAGER', { permissions: ['buyers:view', 'buyers:manage', 'dashboard:view'] })
    stubApi()
    const second = renderAt(`/buyers/${BUYER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Musanze District Produce Buyer')).toBeInTheDocument()
    })
    expect(screen.getByText(/needs a sales permission/)).toBeInTheDocument()
    expect(screen.queryByText('SL-2026-000042')).toBeNull()
    second.unmount()
  })
})

describe('Kinyarwanda', () => {
  it('renders the whole sales list in Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubApi()
    const { unmount } = renderAt('/sales')

    await waitFor(() => {
      expect(document.querySelector('table')).not.toBeNull()
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(rwSales.list.title)
    expect(screen.getByText(rwSales.list.recordSale)).toBeInTheDocument()
    // No English chrome left behind on the screen.
    expect(screen.queryByText('Record a sale')).toBeNull()
    expect(screen.queryByText('Sales')).toBeNull()
    unmount()
  })

  it('reports a refusal from the server in Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubApi({
      [`/sales/${SALE_ID}/cancel`]: replies(() =>
        refusal(409, 'CONFLICT', 'errors.sales.alreadyCancelled', 'already cancelled'),
      ),
    })
    const { unmount } = renderAt(`/sales/${SALE_ID}`)

    await waitFor(() => {
      expect(screen.getByText(rwSales.detail.cancel)).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText(rwSales.detail.cancel))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText(rwSales.cancelDialog.reason), {
      target: { value: 'Impamvu' },
    })
    fireEvent.click(within(openDialog()).getByText(rwSales.cancelDialog.submit))

    await waitFor(() => {
      expect(within(openDialog()).getByText(rwSales.apiErrors.alreadyCancelled)).toBeInTheDocument()
    })

    await closeDialog()
    unmount()
  })
})
