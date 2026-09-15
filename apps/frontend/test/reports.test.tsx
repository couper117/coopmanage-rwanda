import { REPORT_LABELS, REPORT_TYPES } from '@coopmanage/shared'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { reportRoutes } from '../src/features/reports/reportRoutes'
import i18n, { changeLanguage } from '../src/i18n'
import enReports from '../src/i18n/locales/en/reports.json'
import rwReports from '../src/i18n/locales/rw/reports.json'
import { resetSession, signInAs } from './session'

/**
 * The reports screen, mounted for real against a stubbed network.
 *
 * What these tests hold in place, in order of how much it matters.
 *
 * **The screen renders whatever the server built, and adds nothing.** A report is a structure of
 * sections and the screen walks them; that is what keeps the page and the printed sheet the same
 * document. So these tests feed it a document with figures, a table, a total and a withheld
 * section, and assert the page shows exactly those.
 *
 * **A reader is told what they will not see before the paper is produced.** A report their role
 * does not cover is listed and disabled with the reason; one they may produce but only part of is
 * marked with the missing sections. Finding out after printing forty copies for a meeting is the
 * failure this prevents.
 *
 * **Money is written exactly as the server sent it.** Every figure here carries centimes, so a
 * rounding on the way to the screen would show.
 *
 * jsdom constraints from the earlier suites apply: `fireEvent` rather than `userEvent`, and no
 * query by role carrying a name. There are no dialogs on this screen, which makes it simpler than
 * most.
 */
i18n.addResourceBundle('en', 'reports', enReports, true, true)
i18n.addResourceBundle('rw', 'reports', rwReports, true, true)

interface StubRequest {
  url: string
  method: string
  body: unknown
}

type StubValue = unknown

interface Paged {
  __paged: true
  items: unknown[]
  meta: Record<string, unknown>
}

function paged(items: unknown[], extra: Record<string, unknown> = {}): Paged {
  return {
    __paged: true,
    items,
    meta: { page: 1, pageSize: 10, total: items.length, totalPages: 1, ...extra },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

let calls: StubRequest[] = []

function lastCallTo(fragment: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment))
}

function refusal(status: number, code: string, messageKey: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, messageKey, message, requestId: 'test' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const CATALOGUE = REPORT_TYPES.map((type) => ({
  type,
  title: REPORT_LABELS.EN[`report.${type}`],
  permitted: type !== 'financial',
  permission: type === 'financial' ? 'finance:view' : 'reports:view',
  // Every report is available now that meetings have arrived. The unavailable case is still worth
  // covering, because a later phase will add a report before its data exists, so one row here is
  // stubbed as unavailable to exercise the branch the screen keeps for it.
  available: type !== 'meeting',
  availableFromPhase: type === 'meeting' ? 99 : 9,
  withheld: type === 'monthly-cooperative' ? ['Money'] : [],
}))

/**
 * A monthly report with one of each kind of section, and figures that carry their centimes.
 * Written out in full rather than generated, because what this suite is really testing is that the
 * screen shows what it was given and invents nothing.
 */
const DOCUMENT = {
  type: 'monthly-cooperative',
  title: 'Monthly cooperative report',
  periodLabel: '1 September to 30 September 2026',
  from: '2026-09-01',
  to: '2026-09-30',
  locale: 'EN',
  currency: 'RWF',
  cooperative: {
    name: 'Abahuzamugambi Coffee',
    code: 'ABAHUZA-HUYE',
    district: 'Huye',
    sector: 'Ngoma',
  },
  sections: [
    {
      kind: 'figures',
      key: 'members',
      title: 'Membership',
      figures: [
        { key: 'total', label: 'Members', type: 'number', value: '248' },
        { key: 'active', label: 'Active members', type: 'number', value: '231' },
        { key: 'withoutPhone', label: 'Without a phone number', type: 'number', value: '58' },
      ],
    },
    {
      kind: 'withheld',
      key: 'finance',
      title: 'Money',
      text: 'The Money section is not shown, because your role does not cover it.',
    },
    {
      kind: 'table',
      key: 'lowStock',
      title: 'Running low',
      columns: [
        { key: 'sku', label: 'Code', type: 'text', weight: 1 },
        { key: 'product', label: 'Product', type: 'text', weight: 3 },
        { key: 'quantity', label: 'Quantity', type: 'quantity', weight: 1.4 },
        { key: 'value', label: 'Value', type: 'money', weight: 1.6 },
      ],
      rows: [
        {
          sku: 'MAIZE-GRAIN',
          product: 'Maize grain',
          quantity: '412.500',
          value: '3540000.50',
        },
      ],
      total: { sku: null, product: 'Total', quantity: null, value: '3540000.50' },
      emptyLabel: 'Nothing recorded in this period.',
      truncatedFrom: 9,
    },
    {
      kind: 'table',
      key: 'topProducts',
      title: 'Most sold',
      columns: [{ key: 'product', label: 'Product', type: 'text', weight: 1 }],
      rows: [],
      emptyLabel: 'Nothing recorded in this period.',
    },
  ],
  generatedAt: '2026-09-15T14:32:00.000Z',
  generatedAtLabel: '15 September 2026, 16:32',
  generatedBy: 'Claudine Uwimana <uwimana@example.test>',
  withheld: ['Money'],
  rowCount: 1,
}

const RUNS = [
  {
    id: 'run-ready',
    type: 'monthly-cooperative',
    title: 'Monthly cooperative report',
    format: 'PDF' as const,
    status: 'READY' as const,
    from: '2026-08-01',
    to: '2026-08-31',
    rowCount: 14,
    errorMessage: null,
    generatedBy: 'Claudine Uwimana',
    createdAt: '2026-09-01T08:00:00.000Z',
    completedAt: '2026-09-01T08:00:02.000Z',
    downloadable: true,
  },
  {
    id: 'run-failed',
    type: 'member',
    title: 'Membership report',
    format: 'CSV' as const,
    status: 'FAILED' as const,
    from: '2026-08-01',
    to: '2026-08-31',
    rowCount: null,
    errorMessage: 'errors.notFound',
    generatedBy: 'Claudine Uwimana',
    createdAt: '2026-09-01T09:00:00.000Z',
    completedAt: '2026-09-01T09:00:01.000Z',
    downloadable: false,
  },
]

/** A file response, which is what an export answers with rather than a JSON envelope. */
function file(contents: string, contentType: string, filename: string): Response {
  return new Response(contents, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

const routes: RouteObject[] = reportRoutes

function stubFetch(handlers: Record<string, StubValue> = {}): void {
  const table: Record<string, StubValue> = {
    '/auth/me': { user: null },
    '/cooperatives/current': { id: 'coop', code: 'ABAHUZA-HUYE', name: 'Abahuzamugambi Coffee' },
    '/reports/runs': paged(RUNS),
    '/reports/monthly-cooperative/preview': DOCUMENT,
    '/reports': CATALOGUE,
    ...handlers,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      calls.push({ url, method, body })

      // Longest path first, so `/reports/runs` is not answered by the `/reports` stub.
      const match = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((path) => url.includes(path))

      if (!match) {
        return Promise.resolve(refusal(404, 'NOT_FOUND', 'errors.notFound', 'no stub'))
      }

      const value = table[match]
      const result =
        typeof value === 'function'
          ? (value as (r: StubRequest) => unknown)({ url, method, body })
          : value
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

function renderReports() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(routes, { initialEntries: ['/reports'] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

/**
 * Waits until the report itself is on the page.
 *
 * Waiting for the report's title is not enough: the same words are in the chooser's option list
 * from the first render, so a test that waited for them would assert against a screen that had not
 * asked the server for anything yet. Every one of the first attempts at this suite failed that
 * way, and the failures looked like missing data rather than a test that was too early.
 */
async function reportOnPage(text = 'Membership'): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByText(text).length).toBeGreaterThan(0)
  })
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

describe('the reports screen', () => {
  it('opens on the monthly report for the month just gone', async () => {
    renderReports()
    await reportOnPage()

    // The period the screen asked for is a whole month, which is what a committee meets about.
    const request = lastCallTo('/preview')
    const asked = request?.body as { from: string; to: string }
    expect(asked.from.slice(8)).toBe('01')
    expect(new Date(`${asked.to}T00:00:00Z`).getUTCMonth()).toBe(
      new Date(`${asked.from}T00:00:00Z`).getUTCMonth(),
    )
  })

  it('shows the figures the server sent, to the centime', async () => {
    renderReports()
    await reportOnPage()

    expect(screen.getByText('248')).toBeTruthy()
    expect(screen.getByText('231')).toBeTruthy()
    // A member without a telephone is reported as a fact, not a defect: a phone number is never
    // required of a member, and the committee needs to know how many an SMS cannot reach.
    expect(screen.getByText('Without a phone number')).toBeTruthy()
    expect(screen.getByText('58')).toBeTruthy()

    // 3,540,000.50 — the centimes survive, because the screen formats the string it was sent.
    expect(screen.getAllByText('3,540,000.5').length).toBeGreaterThan(0)
    expect(screen.getByText('412.5')).toBeTruthy()
  })

  it('renders a table with its heading, its total and its row count', async () => {
    renderReports()
    await reportOnPage('Running low')

    const table = document.querySelector('table') as HTMLTableElement
    expect(within(table).getByText('Code')).toBeTruthy()
    expect(within(table).getByText('Maize grain')).toBeTruthy()
    expect(within(table).getByText('Total')).toBeTruthy()

    // A caption for a screen reader, which a printed grid of figures also needs.
    expect(table.querySelector('caption')?.textContent).toContain('Running low')

    // The table was cut short, and says so rather than leaving a reader to assume it is complete.
    expect(screen.getByText(/Showing the first 1 of 9 rows/)).toBeTruthy()
  })

  it('says what is empty rather than showing an empty grid', async () => {
    renderReports()
    await reportOnPage('Most sold')
    // "Nothing was sold" and "this table failed to load" are different answers, and only one of
    // them is true here.
    expect(screen.getAllByText('Nothing recorded in this period.').length).toBeGreaterThan(0)
  })

  it('names a withheld section on the page instead of dropping it', async () => {
    renderReports()
    await reportOnPage('Money')

    // In place, as a sentence...
    expect(
      screen.getByText('The Money section is not shown, because your role does not cover it.'),
    ).toBeTruthy()
    // ...and once at the top, so somebody about to print knows before they press the button.
    expect(screen.getByText(/Not shown, because your role does not cover it: Money/)).toBeTruthy()
    expect(screen.getByText(/This report will be produced without these sections/)).toBeTruthy()
  })

  it('names who produced it and when, which a filed sheet needs', async () => {
    renderReports()
    await reportOnPage()
    await waitFor(() => expect(screen.getByText(/Produced by Claudine Uwimana/)).toBeTruthy())
    expect(screen.getByText(/Produced on 15 September 2026, 16:32/)).toBeTruthy()
  })
})

describe('choosing a report', () => {
  it('keeps a report the reader may not produce in the list, disabled', async () => {
    renderReports()
    await reportOnPage()

    const select = screen.getByLabelText<HTMLSelectElement>('Report')
    const financial = [...select.options].find((option) => option.value === 'financial')
    // Knowing the cooperative has a financial report, and that this role does not cover it, is
    // more use than a short menu that leaves somebody wondering where it went.
    expect(financial).toBeTruthy()
    expect(financial?.disabled).toBe(true)
  })

  it('asks for the report and period the reader chose', async () => {
    renderReports()
    await reportOnPage()

    stubFetch({ '/reports/inventory/preview': { ...DOCUMENT, title: 'Stock report' } })
    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'inventory' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-07-01' } })
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-07-31' } })

    await waitFor(() => {
      const request = lastCallTo('/reports/inventory/preview')
      expect(request?.body).toEqual({ from: '2026-07-01', to: '2026-07-31' })
    })
  })

  it('answers a period the wrong way round itself, without asking the server', async () => {
    renderReports()
    await reportOnPage()

    calls = []
    // One change, straight to a backwards period: moving `from` first would pass through a valid
    // single-day range and the screen would rightly ask for a report of it.
    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-08-01' } })

    await waitFor(() =>
      expect(screen.getByText('The second date is before the first one.')).toBeTruthy(),
    )
    expect(calls.filter((call) => call.url.includes('/preview'))).toEqual([])
  })

  it('says which phase brings a report the server reports as not yet available', async () => {
    renderReports()
    await reportOnPage()

    fireEvent.change(screen.getByLabelText('Report'), { target: { value: 'meeting' } })

    await waitFor(() =>
      expect(screen.getByText('This report needs data that arrives in phase 99.')).toBeTruthy(),
    )
    // And it does not ask the server for a report that cannot exist yet.
    expect(lastCallTo('/reports/meeting/preview')).toBeUndefined()
  })
})

describe('producing a file', () => {
  it('sends the report, the period and the format, and names the file it saved', async () => {
    stubFetch({
      '/reports/monthly-cooperative/export': file(
        '%PDF-1.7',
        'application/pdf',
        'abahuza-huye-monthly-cooperative-2026-09-01-to-2026-09-30.pdf',
      ),
    })
    renderReports()
    await reportOnPage()

    fireEvent.click(screen.getByText('Produce the file'))

    await waitFor(() => {
      expect(
        screen.getByText(
          /abahuza-huye-monthly-cooperative-2026-09-01-to-2026-09-30\.pdf was produced/,
        ),
      ).toBeTruthy()
    })

    const request = lastCallTo('/export')
    expect(request?.method).toBe('POST')
    expect(request?.body).toMatchObject({ format: 'pdf' })
  })

  it('produces the format the reader chose', async () => {
    stubFetch({
      '/reports/monthly-cooperative/export': file('a,b\r\n', 'text/csv', 'report.csv'),
    })
    renderReports()
    await reportOnPage()

    fireEvent.change(screen.getByLabelText('File'), { target: { value: 'xlsx' } })
    fireEvent.click(screen.getByText('Produce the file'))

    await waitFor(() => {
      expect((lastCallTo('/export')?.body as { format: string }).format).toBe('xlsx')
    })
  })

  it('shows the server’s refusal rather than a generic failure', async () => {
    stubFetch({
      '/reports/monthly-cooperative/export': refusal(
        409,
        'CONFLICT',
        'errors.reports.notYetAvailable',
        'not yet',
      ),
    })
    renderReports()
    await reportOnPage()

    fireEvent.click(screen.getByText('Produce the file'))

    await waitFor(() => expect(screen.getByText('not yet')).toBeTruthy())
  })

  it('offers no export at all to a reader who may only read reports', async () => {
    signInAs('MANAGER', { permissions: ['reports:view', 'dashboard:view'] })
    renderReports()
    await reportOnPage()
    // Producing a document that leaves the cooperative is a different act from reading one.
    expect(screen.queryByText('Produce the file')).toBeNull()
    expect(screen.queryByLabelText('File')).toBeNull()
    // Reading it is still allowed, and the print button still works on what is on screen.
    expect(screen.getByText('Print')).toBeTruthy()
  })
})

describe('reports produced before', () => {
  it('lists them with what they covered and who produced them', async () => {
    renderReports()
    // The table and the phone list are both in the document under jsdom, so each run's period
    // appears twice. That is the component doing its job, not a duplicate.
    await waitFor(() =>
      expect(screen.getAllByText('2026-08-01 → 2026-08-31').length).toBeGreaterThan(0),
    )
    expect(screen.getAllByText('Claudine Uwimana').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Ready').length).toBeGreaterThan(0)
  })

  it('shows a failed run with its reason rather than hiding it', async () => {
    renderReports()
    await waitFor(() => expect(screen.getAllByText('Did not work').length).toBeGreaterThan(0))
    // A cooperative whose report did not come out needs something to ask about.
    expect(screen.getAllByText('errors.notFound').length).toBeGreaterThan(0)
    // And no way to download what does not exist: one control for the ready run, none for the
    // failed one.
    expect(screen.getAllByText('Produce again').length).toBe(1)
  })

  it('produces a past run again from the list', async () => {
    stubFetch({
      '/reports/runs/run-ready/download': file('%PDF-1.7', 'application/pdf', 'august.pdf'),
    })
    renderReports()
    await waitFor(() => expect(screen.getAllByText('Produce again').length).toBeGreaterThan(0))
    fireEvent.click(screen.getAllByText('Produce again')[0] as HTMLElement)

    await waitFor(() => {
      expect(lastCallTo('/reports/runs/run-ready/download')).toBeTruthy()
    })
  })
})

describe('in Kinyarwanda', () => {
  it('renders the screen and the report in Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubFetch({
      '/reports/monthly-cooperative/preview': {
        ...DOCUMENT,
        locale: 'RW',
        title: 'Raporo y’ukwezi ya koperative',
        periodLabel: 'Kuva 1 Nzeri kugeza 30 Nzeri 2026',
        sections: [
          {
            kind: 'figures',
            key: 'members',
            title: 'Abanyamuryango',
            figures: [
              { key: 'total', label: 'Abanyamuryango', type: 'number', value: '248' },
              { key: 'joined', label: 'Binjiye muri iki gihe', type: 'number', value: '6' },
            ],
          },
        ],
        withheld: [],
      },
    })
    renderReports()
    await reportOnPage('Abanyamuryango')
    expect(screen.getByText('Raporo y’ukwezi ya koperative')).toBeTruthy()
    expect(screen.getByText('Kuva 1 Nzeri kugeza 30 Nzeri 2026')).toBeTruthy()
    expect(screen.getByText('Binjiye muri iki gihe')).toBeTruthy()
    // The controls are translated too, not only the report.
    expect(screen.getByLabelText('Raporo')).toBeTruthy()
    expect(screen.getByText('Kora dosiye')).toBeTruthy()
    expect(screen.getByText('Raporo zakozwe mbere')).toBeTruthy()
  })
})
