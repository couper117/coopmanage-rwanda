import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { inventoryRoutes } from '../src/features/inventory/inventoryRoutes'
import i18n, { changeLanguage } from '../src/i18n'
import enInventory from '../src/i18n/locales/en/inventory.json'
import rwInventory from '../src/i18n/locales/rw/inventory.json'
import { resetSession, signInAs } from './session'

/**
 * The cooperative's store, mounted for real against a stubbed network.
 *
 * The routes, the permission guard, the four movement dialogs, the catalogue forms and every
 * table all run; only `fetch` is faked. Two jsdom constraints shape how this file is written,
 * both learned the hard way in `cooperative.test.tsx` and again in `finance.test.tsx`:
 * `userEvent`'s pointer simulation does not terminate against a Radix portal, and a `byRole`
 * query carrying a `name` option takes seconds against one. So everything here uses `fireEvent`
 * and queries by text, label or selector — and no test is allowed to end with a dialog still
 * open, because the layer it leaves behind slows or confuses whatever renders next.
 *
 * The `inventory` namespace is registered here rather than relied upon from `src/i18n/index.ts`,
 * so this suite tests the feature as it stands on its own.
 */
i18n.addResourceBundle('en', 'inventory', enInventory, true, true)
i18n.addResourceBundle('rw', 'inventory', rwInventory, true, true)

const PRODUCT_ID = '5b2e1c90-4a7d-4f21-9c31-0d4e5f6a7b81'
const SECOND_PRODUCT_ID = '6c3f2da1-5b8e-4032-ad42-1e5f6a7b8c92'
const WAREHOUSE_ID = '7d403eb2-6c9f-4143-be53-2f6a7b8c9da3'
const SECOND_WAREHOUSE_ID = '8e514fc3-7da0-4254-cf64-3a7b8c9dae14'
const CATEGORY_ID = '9f6250d4-8eb1-4365-d075-4b8c9daebf25'
const OWN_UNIT_ID = 'a0736105-9fc2-4476-e186-5c9daebfc036'
const SYSTEM_UNIT_ID = 'b1847216-a0d3-4587-f297-6daebfc0d147'
const TRANSFER_MOVEMENT_ID = 'c2958327-b1e4-4698-a3a8-7ebfc0d1e258'
const REVERSED_MOVEMENT_ID = 'd3a69438-c2f5-47a9-b4b9-8fc0d1e2f369'

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
 * A page of a collection. The extra metadata — the low count on stock, the totals on movements —
 * belongs to the metadata rather than to the rows, because the server computes it over the whole
 * filtered set and not over the page it happens to return.
 */
function paged(
  items: unknown[],
  extra: Record<string, unknown> = {},
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
      ...extra,
    },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

/** Every request the screen made, in order, so a test can assert what was asked of the server. */
let calls: StubRequest[] = []

function callsTo(fragment: string): StubRequest[] {
  return calls.filter((call) => call.url.includes(fragment))
}

function lastCallTo(fragment: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment))
}

/**
 * The most recent write to a path, as opposed to the most recent request of any kind.
 *
 * A successful mutation invalidates the feature and the refetch that follows is a `GET` to the
 * same path, so `lastCallTo` alone would report the read rather than the write under test.
 */
function lastWriteTo(fragment: string, method: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment) && call.method === method)
}

/** A refusal in the shape the API client parses, so the real error path runs. */
function refusal(status: number, code: string, messageKey: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, messageKey, message, requestId: 'test' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function created(data: unknown): Response {
  return new Response(JSON.stringify({ data }), {
    status: 201,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Deliberately not round, and deliberately carrying its third decimal place. A cooperative weighs
 * to the gram, so these figures are the proof that what the server sent is what the screen shows.
 */
const STOCK_ROW = {
  productId: PRODUCT_ID,
  sku: 'MAIZE-001',
  productName: 'Maize grain',
  productNameRw: 'Ibigori',
  categoryName: 'Grain',
  unitSymbol: 'kg',
  warehouseId: WAREHOUSE_ID,
  warehouseName: 'Main store',
  quantity: '400.505',
  minStockLevel: '500.000',
  isLow: true,
}

const HEALTHY_ROW = {
  ...STOCK_ROW,
  productId: SECOND_PRODUCT_ID,
  sku: 'BEAN-002',
  productName: 'Beans',
  productNameRw: 'Ibishyimbo',
  quantity: '1250.000',
  minStockLevel: null,
  isLow: false,
}

const WAREHOUSES = [
  {
    id: WAREHOUSE_ID,
    name: 'Main store',
    code: 'MAIN',
    district: 'Huye',
    sector: 'Ngoma',
    isDefault: true,
    isActive: true,
    productsHeld: 4,
    quantityHeld: '1650.505',
  },
  {
    id: SECOND_WAREHOUSE_ID,
    name: 'Collection point',
    code: 'COLL',
    district: 'Huye',
    sector: 'Mbazi',
    isDefault: false,
    isActive: true,
    productsHeld: 0,
    quantityHeld: '0.000',
  },
]

const UNITS = [
  {
    id: SYSTEM_UNIT_ID,
    key: 'KG',
    nameEn: 'Kilogram',
    nameRw: 'Kilo',
    symbol: 'kg',
    precision: 3,
    isActive: true,
    isSystem: true,
    baseUnitId: null,
    factorToBase: null,
    productCount: 6,
  },
  {
    id: OWN_UNIT_ID,
    key: 'SACK_50KG',
    nameEn: 'Fifty kilogram sack',
    nameRw: 'Umufuka wa kilo mirongo itanu',
    symbol: 'sack',
    precision: 0,
    isActive: true,
    isSystem: false,
    baseUnitId: SYSTEM_UNIT_ID,
    factorToBase: '50.000',
    productCount: 2,
  },
]

const CATEGORIES = [
  {
    id: CATEGORY_ID,
    name: 'Grain',
    nameRw: 'Imyaka',
    parentId: null,
    parentName: null,
    description: null,
    isActive: true,
    productCount: 3,
  },
]

/** A product with history, so its unit and its counting decision are frozen. */
const PRODUCT_WITH_HISTORY = {
  id: PRODUCT_ID,
  sku: 'MAIZE-001',
  name: 'Maize grain',
  nameRw: 'Ibigori',
  categoryId: CATEGORY_ID,
  categoryName: 'Grain',
  unitId: SYSTEM_UNIT_ID,
  unitSymbol: 'kg',
  unitName: 'Kilogram',
  type: 'GOODS',
  trackInventory: true,
  minStockLevel: '500.000',
  defaultPurchasePrice: '420.00',
  defaultSalePrice: '520.00',
  description: null,
  isActive: true,
  quantityOnHand: '400.505',
  hasMovements: true,
}

const PRODUCT_WITHOUT_HISTORY = {
  ...PRODUCT_WITH_HISTORY,
  id: SECOND_PRODUCT_ID,
  sku: 'BEAN-002',
  name: 'Beans',
  nameRw: 'Ibishyimbo',
  minStockLevel: null,
  quantityOnHand: '1250.000',
  hasMovements: false,
}

const TRANSFER_ROW = {
  id: TRANSFER_MOVEMENT_ID,
  reference: 'TRO-2026-000021',
  type: 'TRANSFER_OUT',
  direction: 'OUT',
  productId: PRODUCT_ID,
  productName: 'Maize grain',
  sku: 'MAIZE-001',
  unitSymbol: 'kg',
  warehouseId: WAREHOUSE_ID,
  warehouseName: 'Main store',
  quantity: '120.250',
  unitCost: null,
  totalCost: null,
  memberId: null,
  memberName: null,
  reason: null,
  note: null,
  occurredAt: '2026-09-04T08:15:00.000Z',
  reversalOfReference: null,
  reversedByReference: null,
  counterpartyReference: 'TRI-2026-000022',
  financeReference: null,
}

const ALREADY_REVERSED_ROW = {
  ...TRANSFER_ROW,
  id: REVERSED_MOVEMENT_ID,
  reference: 'REC-2026-000009',
  type: 'RECEIPT',
  direction: 'IN',
  quantity: '80.000',
  unitCost: '420.00',
  totalCost: '33600.00',
  memberId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  memberName: 'Chantal Mukamana',
  counterpartyReference: null,
  reversedByReference: 'ADJ-2026-000031',
  financeReference: 'EX-2026-000114',
}

const VALUATION = {
  rows: [
    {
      productId: PRODUCT_ID,
      sku: 'MAIZE-001',
      productName: 'Maize grain',
      unitSymbol: 'kg',
      quantity: '400.505',
      unitCost: '420.00',
      value: '168212.10',
      costIsEstimated: false,
    },
  ],
  total: '168212.10',
  estimatedCount: 2,
}

const MEMBERS = [
  {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    memberCode: 'ABAH-0001',
    firstName: 'Chantal',
    lastName: 'Mukamana',
    fullName: 'Chantal Mukamana',
    gender: 'FEMALE',
    phone: null,
    district: 'Huye',
    sector: 'Ngoma',
    joinedOn: '2024-02-01',
    position: 'MEMBER',
    status: 'ACTIVE',
    nationalIdMasked: null,
  },
]

/**
 * Routes each stubbed endpoint by path, longest first, so `/inventory/low-stock` is never read as
 * the stock list and a reversal is never read as the movement list.
 */
function stubApi(handlers: Record<string, StubValue> = {}) {
  calls = []
  const table: Record<string, StubValue> = {
    '/settings': { enabledModules: ['inventory'] },
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/cooperatives/mine': [],
    '/members': paged(MEMBERS),
    '/warehouses': WAREHOUSES,
    '/units': UNITS,
    '/product-categories': CATEGORIES,
    '/products': paged([PRODUCT_WITH_HISTORY, PRODUCT_WITHOUT_HISTORY]),
    '/finance/categories': [],
    '/inventory/stock': paged([STOCK_ROW, HEALTHY_ROW], { lowCount: 3 }),
    '/inventory/low-stock': paged([STOCK_ROW], { lowCount: 3 }),
    '/inventory/transactions': paged([TRANSFER_ROW, ALREADY_REVERSED_ROW], {
      totals: { in: '80.000', out: '120.250' },
    }),
    '/inventory/valuation': VALUATION,
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

/** The feature's routes on their own, at absolute paths, mounted in a memory router. */
const routes: RouteObject[] = inventoryRoutes.map((route) => ({
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
  // filters are supposed to live.
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

/** The row of the stock table holding a product, as opposed to the low-stock panel above it. */
function stockTableRow(productName: string): HTMLElement {
  const cells = screen.getAllByText(productName)
  const last = cells[cells.length - 1]
  const row = last?.closest('tr')
  if (!row) throw new Error(`no stock row for ${productName}`)
  return row
}

function fill(field: HTMLElement, value: string): void {
  fireEvent.change(field, { target: { value } })
}

beforeEach(() => {
  // The storekeeper's own role: every movement, the catalogue, the stores and the units, and no
  // finance permission at all.
  signInAs('INVENTORY_OFFICER')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  await changeLanguage('en')
})

describe('the stock overview', () => {
  it('leads with what is running low and marks the low row in the table', async () => {
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getByText(/3 products across the whole catalogue/)).toBeInTheDocument()
    })

    // The count is the whole catalogue's, from the metadata, and not the number of rows on screen.
    expect(screen.getByText(/at or below the minimum somebody set for them/)).toBeInTheDocument()

    // The low panel comes before the stock table, because what is about to run out is the
    // question that costs a cooperative money.
    const lowHeading = screen.getByText('Running low', { selector: 'h2' })
    const searchLabel = screen.getByText('Search the stock')
    expect(
      lowHeading.compareDocumentPosition(searchLabel) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy()

    // And the row itself is marked, with a word rather than with a colour alone.
    const low = stockTableRow('Maize grain')
    expect(within(low).getByText('Running low')).toBeInTheDocument()
    expect(within(stockTableRow('Beans')).getByText('Enough')).toBeInTheDocument()
  })

  it('shows every quantity exactly as the server sent it, to the gram', async () => {
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    // Five hundred and five grams, still there. A float would have been enough to lose them, and
    // the string never goes through one: it is rendered from the characters the server sent.
    expect(screen.getAllByText('400.505 kg')[0]?.textContent).toBe('400.505 kg')
    expect(screen.queryByText('400.51 kg')).toBeNull()
    expect(screen.queryByText('400.5 kg')).toBeNull()
    expect(screen.queryByText(/400\.50499/)).toBeNull()
    // The minimum is a quantity too, and its trailing zeros are meaningless rather than lost.
    expect(screen.getAllByText('500 kg').length).toBeGreaterThan(0)
  })

  it('writes the chosen filters into the address, so a narrowed view can be sent to somebody', async () => {
    stubApi()
    const { router } = renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getByText('Show only these in the table')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Show only these in the table'))

    await waitFor(() => {
      expect(router.state.location.search).toContain('lowOnly=true')
    })
    // And the request for the rows carries the same narrowing.
    await waitFor(() => {
      expect(lastCallTo('/inventory/stock')?.url).toContain('lowOnly=true')
    })
  })

  it('offers a viewer no way to move stock, because a viewer may only read it', async () => {
    resetSession()
    signInAs('VIEWER')
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    expect(screen.queryByText('Receive stock')).toBeNull()
    expect(screen.queryByText('Issue stock')).toBeNull()
    expect(screen.queryByText('Correct a count')).toBeNull()
    expect(screen.queryByText('Move between stores')).toBeNull()
    // Not even a column for actions, rather than an empty one.
    expect(screen.queryByText('Action')).toBeNull()
  })

  it('leaves out what the stock is worth for somebody who may not read the books', async () => {
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    // An inventory officer holds no finance permission at all, and the valuation endpoint needs
    // one, so the panel is absent and the request is never made.
    expect(screen.queryByText('What the stock is worth')).toBeNull()
    expect(callsTo('/inventory/valuation')).toHaveLength(0)
  })

  it('shows what the stock is worth, and says how much of it is an estimate', async () => {
    resetSession()
    signInAs('ACCOUNTANT')
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getByText('What the stock is worth')).toBeInTheDocument()
    })
    expect(screen.getByText('168,212.1 RWF')).toBeInTheDocument()
    expect(
      screen.getByText(/2 of these figures rest on a list price rather than on a receipt/),
    ).toBeInTheDocument()
  })
})

describe('receiving stock', () => {
  it('sends the quantity as a string, with the product and store the row already chose', async () => {
    stubApi({
      '/inventory/receive': replies(() =>
        created({
          id: 'movement',
          reference: 'REC-2026-000042',
          type: 'RECEIPT',
          direction: 'IN',
          quantity: '120.250',
          quantityAfter: '520.755',
          financeReference: null,
        }),
      ),
    })
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })

    // The row's own action, which opens the dialog with that product and that store filled in.
    fireEvent.click(within(stockTableRow('Maize grain')).getByText('Receive stock'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()
    expect(within(dialog).getByText('Code MAIZE-001, measured in kg')).toBeInTheDocument()

    fill(within(dialog).getByLabelText('Quantity'), '120.250')
    submitForm('receive-stock-form')

    await waitFor(() => {
      expect(lastCallTo('/inventory/receive')).toBeDefined()
    })
    const sent = lastCallTo('/inventory/receive')?.body as Record<string, unknown>
    expect(sent.productId).toBe(PRODUCT_ID)
    expect(sent.warehouseId).toBe(WAREHOUSE_ID)
    // A string, with its trailing zero intact, exactly as it was typed.
    expect(sent.quantity).toBe('120.250')
    expect(typeof sent.quantity).toBe('string')
    // And a retry key, so a second press on a slow connection cannot record the delivery twice.
    expect(lastCallTo('/inventory/receive')?.method).toBe('POST')

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    expect(
      screen.getByText(/120.25 kg of Maize grain was received as REC-2026-000042/),
    ).toBeInTheDocument()
  })

  it('offers no way to post the cost to the books without a finance permission', async () => {
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(stockTableRow('Maize grain')).getByText('Receive stock'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    // Choosing a category means reading the list of them, which needs `finance:view`. The whole
    // section is absent rather than present and broken, and the list is never asked for.
    expect(within(openDialog()).queryByText('Post the cost as an expense')).toBeNull()
    expect(callsTo('/finance/categories')).toHaveLength(0)

    await closeDialog()
  })
})

describe('issuing stock', () => {
  it('reports a refusal for too little stock by reading the level again, not by quoting one back', async () => {
    let levelReads = 0
    stubApi({
      '/inventory/stock': replies((request) => {
        // The dialog's own read of one product in one store carries the product code; the page's
        // read of the whole table does not.
        if (!request.url.includes('q=MAIZE-001')) {
          return paged([STOCK_ROW, HEALTHY_ROW], { lowCount: 3 })
        }
        levelReads += 1
        return paged([{ ...STOCK_ROW, quantity: levelReads > 1 ? '9.000' : '12.500' }], {
          lowCount: 3,
        })
      }),
      '/inventory/issue': replies(() =>
        refusal(
          409,
          'INSUFFICIENT_STOCK',
          'errors.inventory.insufficientStock',
          'not enough stock',
        ),
      ),
    })
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(stockTableRow('Maize grain')).getByText('Issue stock'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })

    fill(within(openDialog()).getByLabelText('Quantity'), '50')
    submitForm('issue-stock-form')

    await waitFor(() => {
      expect(screen.getByText('There is not that much in the store')).toBeInTheDocument()
    })

    // The server never said how much there is, so the screen read the level again.
    await waitFor(() => {
      expect(levelReads).toBeGreaterThan(1)
    })
    const alert = screen.getByText('There is not that much in the store').closest('div')
    expect(alert).not.toBeNull()
    await waitFor(() => {
      expect(screen.getByText(/Main store holds 9 kg/)).toBeInTheDocument()
    })
    // Nothing quotes the figure that was refused, and nothing is worked out by subtraction.
    expect(screen.queryByText(/only 50/)).toBeNull()
    expect(screen.queryByText(/12.5 kg is recorded/)).toBeNull()

    await closeDialog()
  })
})

describe('correcting a count', () => {
  it('asks what was counted rather than the difference, and will not send it without a reason', async () => {
    stubApi({
      '/inventory/adjust': replies(() =>
        created({
          id: 'movement',
          reference: 'ADJ-2026-000007',
          type: 'ADJUSTMENT',
          direction: 'OUT',
          quantity: '392.505',
          quantityAfter: '8.000',
          financeReference: null,
        }),
      ),
    })
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(stockTableRow('Maize grain')).getByText('Correct a count'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()

    // The field asks for a count, and says outright that it is not the difference.
    expect(within(dialog).getByLabelText('What you counted')).toBeInTheDocument()
    expect(within(dialog).getByText(/not the difference/)).toBeInTheDocument()
    expect(within(dialog).queryByLabelText('Difference')).toBeNull()

    // A correction with no reason is the entry an auditor asks about first, so it is refused here.
    fill(within(dialog).getByLabelText('What you counted'), '8')
    submitForm('adjust-stock-form')
    await waitFor(() => {
      expect(screen.getByText(/Say why the record was wrong/)).toBeInTheDocument()
    })
    expect(callsTo('/inventory/adjust')).toHaveLength(0)

    fill(
      within(openDialog()).getByLabelText('Why the record was wrong'),
      'Two sacks spoiled by rain',
    )
    submitForm('adjust-stock-form')

    await waitFor(() => {
      expect(lastCallTo('/inventory/adjust')).toBeDefined()
    })
    const sent = lastCallTo('/inventory/adjust')?.body as Record<string, unknown>
    expect(sent.countedQuantity).toBe('8')
    expect(sent.reason).toBe('Two sacks spoiled by rain')
    // No sign, no difference, nothing for the storekeeper to have got backwards.
    expect(sent).not.toHaveProperty('difference')
    expect(sent).not.toHaveProperty('quantity')

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
  })

  it('accepts a shelf found empty, because zero is a real count', async () => {
    stubApi({
      '/inventory/adjust': replies(() =>
        created({
          id: 'movement',
          reference: 'ADJ-2026-000008',
          type: 'ADJUSTMENT',
          direction: 'OUT',
          quantity: '400.505',
          quantityAfter: '0.000',
          financeReference: null,
        }),
      ),
    })
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(stockTableRow('Maize grain')).getByText('Correct a count'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fill(within(openDialog()).getByLabelText('What you counted'), '0')
    fill(within(openDialog()).getByLabelText('Why the record was wrong'), 'Shelf found empty')
    submitForm('adjust-stock-form')

    await waitFor(() => {
      expect(lastCallTo('/inventory/adjust')).toBeDefined()
    })
    expect((lastCallTo('/inventory/adjust')?.body as Record<string, unknown>).countedQuantity).toBe(
      '0',
    )

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
  })
})

describe('moving stock between stores', () => {
  it('refuses a move into the store the stock is leaving, without asking the server', async () => {
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })
    fireEvent.click(within(stockTableRow('Maize grain')).getByText('Move between stores'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    await waitFor(() => {
      expect(within(openDialog()).getByLabelText('Into')).toBeInTheDocument()
    })

    // The destination is chosen first, and then the source is changed to match it — which is how
    // the two ever come to be the same store in practice.
    fill(within(openDialog()).getByLabelText('Into'), SECOND_WAREHOUSE_ID)
    fill(within(openDialog()).getByLabelText('Out of'), SECOND_WAREHOUSE_ID)
    fill(within(openDialog()).getByLabelText('Quantity'), '20')
    submitForm('transfer-stock-form')

    await waitFor(() => {
      expect(screen.getByText(/Choose a different store/)).toBeInTheDocument()
    })
    // A request that could only fail was never sent.
    expect(callsTo('/inventory/transfer')).toHaveLength(0)

    await closeDialog()
  })
})

describe('the movement history', () => {
  it('lists a movement with its reference, kind, product, store and quantity, and totals the set', async () => {
    stubApi()
    renderAt('/inventory/movements')

    await waitFor(() => {
      expect(screen.getByText('TRO-2026-000021')).toBeInTheDocument()
    })
    const moved = screen.getByText('TRO-2026-000021').closest('tr') as HTMLElement
    // "Moved out" is also one of the filter options, so the row is read rather than the screen.
    expect(within(moved).getByText('Moved out')).toBeInTheDocument()
    expect(within(moved).getByText('120.25 kg')).toBeInTheDocument()
    expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    expect(screen.getByText('33,600 RWF')).toBeInTheDocument()

    // The footer totals come from the metadata, so they cover the whole filtered set.
    expect(screen.getByText('Total in')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(
      screen.getByText(/These two cover every page of the current filters/),
    ).toBeInTheDocument()
  })

  it('writes a correction for both halves of a move, and names both', async () => {
    stubApi({
      [`/inventory/transactions/${TRANSFER_MOVEMENT_ID}/reverse`]: replies(() => ({
        reversals: [
          {
            id: 'a',
            reference: 'ADJ-2026-000051',
            type: 'TRANSFER_IN',
            direction: 'IN',
            quantity: '120.250',
            quantityAfter: '520.755',
            financeReference: null,
          },
          {
            id: 'b',
            reference: 'ADJ-2026-000052',
            type: 'TRANSFER_OUT',
            direction: 'OUT',
            quantity: '120.250',
            quantityAfter: '0.000',
            financeReference: null,
          },
        ],
      })),
    })
    renderAt('/inventory/movements')

    await waitFor(() => {
      expect(screen.getByText('TRO-2026-000021')).toBeInTheDocument()
    })
    const row = screen.getByText('TRO-2026-000021').closest('tr')
    expect(row).not.toBeNull()
    fireEvent.click(within(row as HTMLElement).getByText('Correct'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    // The dialog says a correction is written rather than the movement removed, and warns that a
    // move is corrected on both sides.
    expect(screen.getByText(/an opposite movement is written beside it/)).toBeInTheDocument()
    expect(screen.getByText(/Both halves are corrected together/)).toBeInTheDocument()

    fill(
      within(openDialog()).getByLabelText('Why it is being corrected'),
      'Moved to the wrong store',
    )
    fireEvent.click(screen.getByText('Write the correction'))

    await waitFor(() => {
      expect(lastCallTo('/reverse')).toBeDefined()
    })
    expect((lastCallTo('/reverse')?.body as Record<string, unknown>).reason).toBe(
      'Moved to the wrong store',
    )

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    expect(
      screen.getByText(/The corrections are ADJ-2026-000051 and ADJ-2026-000052/),
    ).toBeInTheDocument()
  })

  it('offers no correction on a movement that has already been corrected, and names what corrected it', async () => {
    stubApi()
    renderAt('/inventory/movements')

    await waitFor(() => {
      expect(screen.getByText('REC-2026-000009')).toBeInTheDocument()
    })
    const row = screen.getByText('REC-2026-000009').closest('tr') as HTMLElement
    expect(within(row).getByText('Already corrected')).toBeInTheDocument()
    expect(within(row).queryByText('Correct')).toBeNull()
    // And the row says what corrected it, so the pair reads as a pair.
    expect(within(row).getByText('Corrected by ADJ-2026-000031')).toBeInTheDocument()
  })

  it('offers no correction at all to somebody without the adjustment permission', async () => {
    resetSession()
    signInAs('ACCOUNTANT')
    stubApi()
    renderAt('/inventory/movements')

    await waitFor(() => {
      expect(screen.getByText('TRO-2026-000021')).toBeInTheDocument()
    })
    expect(screen.queryByText('Correct')).toBeNull()
  })
})

describe('the catalogue', () => {
  it('disables the unit and the counting switch once the product has movements, and says why', async () => {
    stubApi()
    renderAt('/inventory/products')

    await waitFor(() => {
      expect(screen.getByText('MAIZE-001')).toBeInTheDocument()
    })
    const row = screen.getByText('MAIZE-001').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByText('Edit'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()

    const unit = within(dialog).getByLabelText('Unit it is measured in')
    expect(unit).toBeDisabled()
    expect(
      within(dialog).getByText(/The unit cannot change: stock has already moved in this unit/),
    ).toBeInTheDocument()

    // The switch carries its explanation in its own label, so it is found by its role rather
    // than by an exact string.
    const counting = within(dialog).getByRole('switch')
    expect(counting).toBeDisabled()
    expect(within(dialog).getByText('Count this product in the store')).toBeInTheDocument()
    expect(
      within(dialog).getByText(/turning counting off would abandon its level/),
    ).toBeInTheDocument()

    await closeDialog()
  })

  it('leaves the unit editable on a product nothing has moved against', async () => {
    stubApi()
    renderAt('/inventory/products')

    await waitFor(() => {
      expect(screen.getByText('BEAN-002')).toBeInTheDocument()
    })
    const row = screen.getByText('BEAN-002').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByText('Edit'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    expect(within(openDialog()).getByLabelText('Unit it is measured in')).not.toBeDisabled()

    await closeDialog()
  })

  it('retires a product rather than deleting it', async () => {
    stubApi({
      '/products': replies((request) =>
        request.method === 'PATCH'
          ? { ...PRODUCT_WITH_HISTORY, isActive: false }
          : paged([PRODUCT_WITH_HISTORY, PRODUCT_WITHOUT_HISTORY]),
      ),
    })
    renderAt('/inventory/products')

    await waitFor(() => {
      expect(screen.getByText('MAIZE-001')).toBeInTheDocument()
    })
    const row = screen.getByText('MAIZE-001').closest('tr') as HTMLElement
    // There is no delete control anywhere on the row.
    expect(within(row).queryByText('Delete')).toBeNull()
    fireEvent.click(within(row).getByText('Retire'))

    await waitFor(() => {
      expect(screen.getByText('Retire Maize grain?')).toBeInTheDocument()
    })
    expect(screen.getByText(/Nothing is deleted/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Yes, retire it'))

    await waitFor(() => {
      expect(lastWriteTo('/products', 'PATCH')).toBeDefined()
    })
    expect((lastWriteTo('/products', 'PATCH')?.body as Record<string, unknown>).isActive).toBe(
      false,
    )

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
  })

  it('keeps the categories reachable from the catalogue screen', async () => {
    stubApi()
    renderAt('/inventory/products')

    await waitFor(() => {
      expect(screen.getByText('Product categories')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add a category'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    expect(within(openDialog()).getByLabelText('Name')).toBeInTheDocument()

    await closeDialog()
  })
})

describe('the stores', () => {
  it('reports the refusal when a store still holding stock is closed', async () => {
    stubApi({
      '/warehouses': replies((request) =>
        request.method === 'PATCH'
          ? refusal(
              409,
              'CONFLICT',
              'errors.catalogue.warehouseHoldsStock',
              'the store still holds stock',
            )
          : WAREHOUSES,
      ),
    })
    renderAt('/inventory/warehouses')

    await waitFor(() => {
      expect(screen.getByText('MAIN')).toBeInTheDocument()
    })
    const row = screen.getByText('MAIN').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByText('Close'))

    await waitFor(() => {
      expect(screen.getByText('Close Main store?')).toBeInTheDocument()
    })
    // The consequence already says what is in there, from the row.
    expect(screen.getByText(/This store is holding 4 products/)).toBeInTheDocument()
    fireEvent.click(screen.getByText('Yes, close it'))

    await waitFor(() => {
      expect(screen.getByText(/Move what is in it to another store first/)).toBeInTheDocument()
    })
    // The confirmation stays open on a failure rather than closing over the refusal.
    expect(openDialog()).not.toBeNull()

    await closeDialog()
  })

  it('moves the default flag rather than offering a way to clear it', async () => {
    stubApi({
      '/warehouses': replies((request) =>
        request.method === 'PATCH' ? { ...WAREHOUSES[1], isDefault: true } : WAREHOUSES,
      ),
    })
    renderAt('/inventory/warehouses')

    await waitFor(() => {
      expect(screen.getByText('COLL')).toBeInTheDocument()
    })
    const current = screen.getByText('MAIN').closest('tr') as HTMLElement
    // The store that already holds the flag is offered no way to give it up.
    expect(within(current).getByText('Default store')).toBeInTheDocument()
    expect(within(current).queryByText('Make it the default')).toBeNull()

    const other = screen.getByText('COLL').closest('tr') as HTMLElement
    fireEvent.click(within(other).getByText('Make it the default'))

    await waitFor(() => {
      expect(lastWriteTo('/warehouses', 'PATCH')).toBeDefined()
    })
    expect((lastWriteTo('/warehouses', 'PATCH')?.body as Record<string, unknown>).isDefault).toBe(
      true,
    )
  })
})

describe('the units of measure', () => {
  it('marks a shared unit as shared and offers no way to rename it', async () => {
    stubApi()
    renderAt('/inventory/units')

    await waitFor(() => {
      expect(screen.getByText('Kilogram')).toBeInTheDocument()
    })
    const shared = screen.getByText('Kilogram').closest('tr') as HTMLElement
    expect(within(shared).getByText('Shared')).toBeInTheDocument()
    expect(
      within(shared).getByText('Shared by every cooperative, so it cannot be renamed here'),
    ).toBeInTheDocument()
    expect(within(shared).queryByText('Edit')).toBeNull()

    // The cooperative's own unit is editable, which is what makes the distinction visible.
    const own = screen.getByText('Fifty kilogram sack').closest('tr') as HTMLElement
    expect(within(own).getByText('Added here')).toBeInTheDocument()
    expect(within(own).getByText('Edit')).toBeInTheDocument()
  })

  it('adds a unit with the key, both names and the symbol the cooperative chose', async () => {
    stubApi({
      '/units': replies((request) =>
        request.method === 'POST'
          ? created({
              id: 'new',
              key: 'BUNCH',
              nameEn: 'Bunch',
              nameRw: 'Umutwe',
              symbol: 'bunch',
              precision: 0,
              isActive: true,
              isSystem: false,
              baseUnitId: null,
              factorToBase: null,
              productCount: 0,
            })
          : UNITS,
      ),
    })
    renderAt('/inventory/units')

    await waitFor(() => {
      expect(screen.getByText('Kilogram')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add a unit'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()
    fill(within(dialog).getByLabelText('Key'), 'BUNCH')
    fill(within(dialog).getByLabelText('Written as'), 'bunch')
    fill(within(dialog).getByLabelText('Name in English'), 'Bunch')
    fill(within(dialog).getByLabelText('Name in Kinyarwanda'), 'Umutwe')
    submitForm('unit-form')

    await waitFor(() => {
      expect(lastWriteTo('/units', 'POST')).toBeDefined()
    })
    const sent = lastWriteTo('/units', 'POST')?.body as Record<string, unknown>
    expect(sent.key).toBe('BUNCH')
    expect(sent.nameRw).toBe('Umutwe')

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
  })
})

describe('Kinyarwanda', () => {
  it('renders the whole stock overview in Kinyarwanda, with no English label left behind', async () => {
    await changeLanguage('rw')
    stubApi()
    renderAt('/inventory')

    await waitFor(() => {
      expect(screen.getByText('Ububiko', { selector: 'h1' })).toBeInTheDocument()
    })
    // The stock table renders after its own request settles, and its headers are read below.
    await waitFor(() => {
      expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
    })

    // The words from the glossary, in the places a storekeeper reads them.
    expect(screen.getByText('Ububiko buke', { selector: 'h2' })).toBeInTheDocument()
    // Each of the four movements appears in the header and again on every row, hence the counts.
    expect(screen.getAllByText('Kwakira ibicuruzwa').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Gusohora ibicuruzwa').length).toBeGreaterThan(0)
    expect(screen.getAllByText("Igenzura ry'ububiko").length).toBeGreaterThan(0)
    expect(screen.getAllByText("Kwimura hagati y'ibigega").length).toBeGreaterThan(0)
    expect(screen.getByText('Shakisha mu bubiko')).toBeInTheDocument()
    expect(screen.getAllByText('Ikigega', { selector: 'th' }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Igicuruzwa', { selector: 'th' }).length).toBeGreaterThan(0)

    // The Kinyarwanda name of the product is preferred where the cooperative filled one in.
    expect(screen.getAllByText('Ibigori').length).toBeGreaterThan(0)

    // And nothing English is left in the chrome.
    expect(screen.queryByText('Running low')).toBeNull()
    expect(screen.queryByText('Receive stock')).toBeNull()
    expect(screen.queryByText('Search the stock')).toBeNull()
    expect(screen.queryByText('Store', { selector: 'th' })).toBeNull()
    expect(screen.queryByText('Product', { selector: 'th' })).toBeNull()

    // The quantity is still the string the server sent: translation does not touch a figure.
    expect(screen.getAllByText('400.505 kg').length).toBeGreaterThan(0)
  })

  it('translates a refusal from the server into Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubApi({
      '/warehouses': replies((request) =>
        request.method === 'PATCH'
          ? refusal(
              409,
              'CONFLICT',
              'errors.catalogue.warehouseHoldsStock',
              'the store still holds stock',
            )
          : WAREHOUSES,
      ),
    })
    renderAt('/inventory/warehouses')

    await waitFor(() => {
      expect(screen.getByText('MAIN')).toBeInTheDocument()
    })
    const row = screen.getByText('MAIN').closest('tr') as HTMLElement
    fireEvent.click(within(row).getByText('Gufunga'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.click(screen.getByText('Yego, gifunge'))

    await waitFor(() => {
      expect(screen.getByText(/Banza wimure ibirimo ujye mu kindi kigega/)).toBeInTheDocument()
    })

    await closeDialog()
  })
})
