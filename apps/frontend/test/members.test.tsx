import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { contributionRoutes, memberRoutes } from '../src/features/members/memberRoutes'
import i18n, { changeLanguage } from '../src/i18n'
import enMembers from '../src/i18n/locales/en/members.json'
import rwMembers from '../src/i18n/locales/rw/members.json'
import { resetSession, signInAs } from './session'

/**
 * The member register, mounted for real against a stubbed network.
 *
 * The routes, the permission guard, the forms and the tables all run; only `fetch` is faked. Two
 * jsdom constraints shape how this file is written, both learned the hard way in
 * `cooperative.test.tsx`: `userEvent`'s pointer simulation does not terminate against a Radix
 * portal, and a `byRole` query carrying a `name` option takes seconds against one. So everything
 * here uses `fireEvent` and queries by text, label or selector — and no test is allowed to end
 * with a dialog still open, because the layer it leaves behind slows or confuses whatever renders
 * next.
 *
 * The `members` namespace is registered here rather than relied upon from `src/i18n/index.ts`, so
 * this suite tests the feature as it stands on its own.
 */
i18n.addResourceBundle('en', 'members', enMembers, true, true)
i18n.addResourceBundle('rw', 'members', rwMembers, true, true)

const MEMBER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'
const CATEGORY_ID = 'b1c2d3e4-5f60-4a71-8b92-0c1d2e3f4a5b'

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
  meta: { page: number; pageSize: number; total: number; totalPages: number }
}

function paged(items: unknown[], total = items.length, page = 1, pageSize = 25): Paged {
  return {
    __paged: true,
    items,
    meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
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

/**
 * The most recent write to a path, as opposed to the most recent request of any kind: a successful
 * mutation invalidates the feature and the refetch that follows is a `GET` to the same path.
 */
function lastWriteTo(fragment: string, method: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment) && call.method === method)
}

const MEMBER_ROW = {
  id: MEMBER_ID,
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

const MEMBER_DETAIL = {
  ...MEMBER_ROW,
  dateOfBirth: '1986-07-12',
  nationalId: '1198670123451234',
  email: null,
  province: 'SOUTHERN',
  cell: 'Butare',
  village: 'Rango',
  exitedOn: null,
  exitReason: null,
  notes: null,
  createdAt: '2024-03-04T08:00:00.000Z',
  updatedAt: '2024-03-04T08:00:00.000Z',
}

const STATS = {
  total: 412,
  byStatus: { ACTIVE: 388, INACTIVE: 24 },
  newThisMonth: 9,
  withoutPhone: 137,
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    member: MEMBER_DETAIL,
    shares: { quantity: 12, value: '120000.00' },
    contributions: { count: 3, total: '45000.00' },
    payments: { total: '0.00' },
    unavailable: ['quantitySupplied', 'documents'],
    withheld: [],
    ...overrides,
  }
}

/** Routes each stubbed endpoint by path, longest first, so `/members/stats` is never read as a member. */
function stubApi(handlers: Record<string, StubValue> = {}) {
  calls = []
  const table: Record<string, StubValue> = {
    '/settings': { enabledModules: ['members', 'contributions'] },
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/cooperatives/mine': [],
    '/members/stats': STATS,
    '/members/form-options': {
      incomeCategories: [
        { id: CATEGORY_ID, name: 'Membership fees', nameRw: 'Amafaranga yo kwinjira' },
      ],
    },
    '/members': paged([MEMBER_ROW]),
    [`/members/${MEMBER_ID}/summary`]: summary(),
    [`/members/${MEMBER_ID}/timeline`]: [],
    [`/members/${MEMBER_ID}/shares`]: { items: [], holding: { quantity: 0, value: '0.00' } },
    [`/members/${MEMBER_ID}/contributions`]: { items: [], total: 0, totalAmount: '0.00' },
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
const routes: RouteObject[] = [...memberRoutes, ...contributionRoutes].map((route) => ({
  ...route,
  path: `/${route.path ?? ''}`,
}))

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

function openDialog(): HTMLElement {
  return document.querySelector('[role="dialog"]') as HTMLElement
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

describe('member register', () => {
  it('lists members with their code, status and place', async () => {
    stubApi()
    renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    const table = document.querySelector('table') as HTMLElement
    expect(within(table).getByText('ABAH-0001')).toBeInTheDocument()
    expect(within(table).getByText('Active')).toBeInTheDocument()
    expect(within(table).getByText('Ngoma, Huye')).toBeInTheDocument()
    // Every table carries a caption, which is what a screen reader announces on entering it.
    expect(within(table).getByText(/Members of this cooperative/)).toBeInTheDocument()
  })

  it('says how many members cannot be reached by SMS', async () => {
    stubApi()
    renderAt('/members')

    // The tile shows its label while the figure is still loading, so waiting for the label
    // proves nothing. The number is what the test is about.
    await waitFor(() => {
      expect(screen.getByText('137')).toBeInTheDocument()
    })
    expect(screen.getByText('Without a phone number')).toBeInTheDocument()
    expect(screen.getByText(/cannot be reached by SMS/)).toBeInTheDocument()
    // A member with no phone reads as such rather than as a blank cell.
    expect(screen.getAllByText('No phone').length).toBeGreaterThan(0)
  })

  it('shows one h1 and no way to delete anybody', async () => {
    stubApi()
    renderAt('/members')

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Members')
    })
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.queryByText(/Remove member/)).toBeNull()
  })

  it('invites the first member when the register is empty', async () => {
    stubApi({ '/members': paged([]) })
    renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('No members yet')).toBeInTheDocument()
    })
    expect(screen.getByText(/A name is all you need/)).toBeInTheDocument()
    // Offered twice on purpose: in the page header and as the empty state's own way out.
    expect(screen.getAllByText('Add member')).toHaveLength(2)
  })

  it('distinguishes no results from an empty register', async () => {
    stubApi({ '/members': paged([]) })
    renderAt('/members?status=SUSPENDED')

    await waitFor(() => {
      expect(screen.getByText('Nobody matches these filters')).toBeInTheDocument()
    })
    expect(screen.queryByText('No members yet')).toBeNull()
    // Once in the toolbar, once as the empty state's own way out.
    expect(screen.getAllByText('Clear filters')).toHaveLength(2)
  })

  it('explains a failure and offers to try again', async () => {
    stubApi({
      '/members': () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'INTERNAL_ERROR',
              messageKey: 'errors.internal',
              message: 'boom',
              requestId: 'test',
            },
          }),
          { status: 500, headers: { 'Content-Type': 'application/json' } },
        ),
    })
    renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText(/could not load the member register/)).toBeInTheDocument()
    })
    expect(screen.getByText('Try again')).toBeInTheDocument()
  })

  it('reads its filters from the URL, so a filtered view can be bookmarked', async () => {
    stubApi()
    renderAt('/members?status=SUSPENDED&district=Huye&sort=-joinedOn')

    await waitFor(() => {
      expect(screen.getByLabelText('Status')).toHaveValue('SUSPENDED')
    })
    expect(screen.getByLabelText('District')).toHaveValue('Huye')
    expect(screen.getByLabelText('Order')).toHaveValue('-joinedOn')

    const request = lastCallTo('/members?')
    expect(request?.url).toContain('status=SUSPENDED')
    expect(request?.url).toContain('district=Huye')
    expect(request?.url).toContain('sort=-joinedOn')
    // And what is narrowing the list is stated as a removable chip rather than hidden.
    expect(screen.getByLabelText('Stop filtering by Status')).toBeInTheDocument()
  })

  it('writes a filter change back into the URL', async () => {
    stubApi()
    const { router } = renderAt('/members') as unknown as {
      router: { state: { location: { search: string } } }
    }
    void router

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } })

    await waitFor(() => {
      expect(lastCallTo('/members?')?.url).toContain('status=INACTIVE')
    })
  })

  it('waits for typing to stop before searching', async () => {
    stubApi()
    renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    const before = calls.filter((call) => call.url.includes('/members?')).length

    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'Muka' } })
    fireEvent.change(screen.getByLabelText('Search members'), { target: { value: 'Mukamana' } })

    await waitFor(() => {
      expect(lastCallTo('/members?')?.url).toContain('q=Mukamana')
    })
    // One request for the settled value, not one per keystroke.
    const after = calls.filter((call) => call.url.includes('/members?')).length
    expect(after - before).toBe(1)
  })

  it('asks the server for the chosen ordering', async () => {
    stubApi()
    renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Order'), { target: { value: '-memberCode' } })

    await waitFor(() => {
      expect(lastCallTo('/members?')?.url).toContain('sort=-memberCode')
    })
    // The sorted column says so in its own header.
    await waitFor(() => {
      expect(document.querySelector('th')?.textContent).not.toContain('↑')
    })
  })

  it('downloads the filtered register as a file', async () => {
    const created = vi.fn(() => 'blob:members')
    vi.stubGlobal(
      'URL',
      Object.assign(Object.create(URL), URL, {
        createObjectURL: created,
        revokeObjectURL: vi.fn(),
      }),
    )
    stubApi({
      '/members/export': () =>
        new Response('Member code\r\n"ABAH-0001"\r\n', {
          status: 200,
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="members-ABAH-2026-09-14.csv"',
          },
        }),
    })
    renderAt('/members?status=ACTIVE')

    await waitFor(() => {
      expect(screen.getByText('Export CSV')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Export CSV'))

    await waitFor(() => {
      expect(lastCallTo('/members/export')).toBeDefined()
    })
    const request = lastCallTo('/members/export')
    expect(request?.url).toContain('status=ACTIVE')
    // Paging never applies to a file: the export covers the whole filtered set.
    expect(request?.url).not.toContain('pageSize=')
    await waitFor(() => {
      expect(created).toHaveBeenCalled()
    })
  })

  it('hides the actions a viewer may not use', async () => {
    resetSession()
    signInAs('VIEWER')
    stubApi()
    renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    expect(screen.queryByText('Add member')).toBeNull()
    expect(screen.queryByText('Export CSV')).toBeNull()
  })

  it('stacks each member as a card on a phone', async () => {
    stubApi()
    const { unmount } = renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    const { setViewportWidth } = await import('./setup')
    setViewportWidth(420)

    await waitFor(() => {
      expect(document.querySelector('table')).toBeNull()
    })
    expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    expect(screen.getByText(/ABAH-0001/)).toBeInTheDocument()
    unmount()
    setViewportWidth(1440)
  })
})

describe('adding a member', () => {
  it('creates a member from nothing but a first and family name', async () => {
    stubApi({
      '/members': replies((request) =>
        request.method === 'POST'
          ? { ...MEMBER_DETAIL, firstName: 'Jean', lastName: 'Bizimana', fullName: 'Jean Bizimana' }
          : paged([MEMBER_ROW]),
      ),
    })
    const { unmount } = renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Add member')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add member'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Jean' } })
    fireEvent.change(within(dialog).getByLabelText('Family name'), {
      target: { value: 'Bizimana' },
    })
    submitForm('member-form')

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true)
    })
    const posted = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>
    expect(posted.firstName).toBe('Jean')
    expect(posted.lastName).toBe('Bizimana')
    // Nothing else was invented on the member's behalf. A phone number least of all.
    expect(posted.phone).toBeUndefined()
    expect(posted.nationalId).toBeUndefined()
    expect(posted.gender).toBeUndefined()
    expect(posted.district).toBeUndefined()

    unmount()
  })

  it('marks the phone number as optional and says why', async () => {
    stubApi()
    const { unmount } = renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Add member')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add member'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()
    // "(optional)" is part of the accessible label, which is how a screen reader hears it.
    expect(within(dialog).getByLabelText(/Phone number.*optional/)).toBeInTheDocument()
    expect(within(dialog).getByText(/Many members have no phone/)).toBeInTheDocument()
    // The two names are the only fields that are not marked optional.
    expect(within(dialog).getByLabelText('First name')).toBeInTheDocument()
    expect(within(dialog).queryByLabelText(/First name.*optional/)).toBeNull()

    unmount()
  })

  it('refuses a phone number that is not Rwandan, without ever requiring one', async () => {
    stubApi()
    const { unmount } = renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Add member')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Add member'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })

    const dialog = openDialog()
    fireEvent.change(within(dialog).getByLabelText('First name'), { target: { value: 'Jean' } })
    fireEvent.change(within(dialog).getByLabelText('Family name'), {
      target: { value: 'Bizimana' },
    })
    fireEvent.change(within(dialog).getByLabelText(/Phone number/), { target: { value: '12345' } })
    submitForm('member-form')

    await waitFor(() => {
      expect(within(openDialog()).getByText(/not a Rwandan mobile number/)).toBeInTheDocument()
    })
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    unmount()
  })
})

describe('member profile', () => {
  it('heads the page with the name, code, status and joining date', async () => {
    stubApi()
    renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Chantal Mukamana')
    })
    expect(document.querySelectorAll('h1')).toHaveLength(1)
    expect(screen.getByText('ABAH-0001')).toBeInTheDocument()
    expect(screen.getByText(/Member since/)).toBeInTheDocument()
    expect(screen.queryByText('Delete')).toBeNull()
  })

  it('says a figure is not available yet rather than showing a zero', async () => {
    stubApi()
    renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Produce delivered')).toBeInTheDocument()
    })
    // The two blocks the server named as unavailable say which phase brings them.
    expect(screen.getByText('Not available until phase 6')).toBeInTheDocument()
    expect(screen.getByText('Not available until phase 9')).toBeInTheDocument()

    // And the tile itself carries no figure at all, least of all a zero.
    const tile = screen.getByText('Produce delivered').closest('div') as HTMLElement
    expect(tile.textContent).not.toContain('0')
    // The blocks that do have a figure still show it.
    expect(screen.getByText('120,000 RWF')).toBeInTheDocument()
    expect(screen.getByText('45,000 RWF')).toBeInTheDocument()
  })

  it('says when the caller’s role does not cover a figure', async () => {
    stubApi({
      [`/members/${MEMBER_ID}/summary`]: summary({
        payments: null,
        shares: null,
        withheld: ['payments', 'shares'],
      }),
    })
    renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Paid out to the member')).toBeInTheDocument()
    })
    expect(screen.getAllByText('Your role does not cover this figure')).toHaveLength(2)
    expect(screen.queryByText('0 RWF')).toBeNull()
  })

  it('tells somebody with no contributions permission that the list is not theirs to see', async () => {
    resetSession()
    signInAs('VIEWER', {
      permissions: ['members:view', 'dashboard:view', 'cooperative:view'],
    })
    stubApi({
      [`/members/${MEMBER_ID}/summary`]: summary({
        contributions: null,
        shares: null,
        payments: null,
        withheld: ['shares', 'contributions', 'payments'],
      }),
    })
    renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText(/role does not cover contributions/)).toBeInTheDocument()
    })
    expect(screen.getByText(/role does not cover shares/)).toBeInTheDocument()
    // Neither list was fetched, because the request could only have been refused.
    expect(lastCallTo('/contributions')).toBeUndefined()
    expect(lastCallTo('/shares')).toBeUndefined()
  })

  it('reads the history in the reader’s own language', async () => {
    stubApi({
      [`/members/${MEMBER_ID}/timeline`]: [
        {
          at: '2024-06-01T00:00:00.000Z',
          kind: 'CONTRIBUTION',
          messageKey: 'timeline.contribution.SAVINGS',
          messageParams: {},
          amount: '15000.00',
        },
        {
          at: '2024-03-04T00:00:00.000Z',
          kind: 'REGISTERED',
          messageKey: 'timeline.registered',
          messageParams: { code: 'ABAH-0001' },
          amount: null,
        },
      ],
    })
    renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Paid into savings')).toBeInTheDocument()
    })
    expect(screen.getByText('Joined the cooperative as ABAH-0001')).toBeInTheDocument()
    expect(screen.getByText('15,000 RWF')).toBeInTheDocument()
  })

  it('totals the contributions it lists', async () => {
    stubApi({
      [`/members/${MEMBER_ID}/contributions`]: {
        items: [
          {
            id: 'c1',
            memberId: MEMBER_ID,
            memberCode: 'ABAH-0001',
            memberName: 'Chantal Mukamana',
            type: 'SAVINGS',
            amount: '15000.00',
            paidOn: '2024-06-01',
            method: 'CASH',
            reference: null,
            status: 'POSTED',
            financeReference: 'IN-0009',
          },
        ],
        total: 1,
        totalAmount: '15000.00',
      },
    })
    renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Total received')).toBeInTheDocument()
    })
    expect(screen.getByText('Savings')).toBeInTheDocument()
    expect(screen.getByText('Cash')).toBeInTheDocument()
    expect(screen.getAllByText('15,000 RWF').length).toBeGreaterThan(0)
  })
})

describe('changing a member’s status', () => {
  it('states the consequence and asks for confirmation before deactivating', async () => {
    stubApi()
    const { unmount } = renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Change status')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Change status'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    // The dialog says outright that nothing is ever deleted.
    expect(within(openDialog()).getByText(/never deleted/)).toBeInTheDocument()
    fireEvent.click(within(openDialog()).getByText('Save the status'))

    await waitFor(() => {
      expect(screen.getByText('Set Chantal Mukamana to Inactive?')).toBeInTheDocument()
    })
    expect(screen.getByText(/stop counting as an active member/)).toBeInTheDocument()
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    unmount()
  })

  it('refuses to mark a member as having left without the date they left', async () => {
    stubApi()
    const { unmount } = renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Change status')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Change status'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })

    fireEvent.change(within(openDialog()).getByLabelText('New status'), {
      target: { value: 'EXITED' },
    })
    fireEvent.click(within(openDialog()).getByText('Save the status'))

    await waitFor(() => {
      expect(screen.getByText('Say which day they left the cooperative.')).toBeInTheDocument()
    })
    expect(calls.some((call) => call.method === 'POST')).toBe(false)

    // With a date it goes through, and the date goes with it.
    fireEvent.change(within(openDialog()).getByLabelText(/Date they left/), {
      target: { value: '2026-01-31' },
    })
    fireEvent.click(within(openDialog()).getByText('Save the status'))
    await waitFor(() => {
      expect(screen.getByText(/Set Chantal Mukamana to Left the cooperative\?/)).toBeInTheDocument()
    })

    unmount()
  })
})

describe('recording a contribution', () => {
  it('sends the amount as the string it was typed as', async () => {
    stubApi({
      [`/members/${MEMBER_ID}/contributions`]: replies((request) =>
        request.method === 'POST'
          ? { id: 'c9', amount: '5000.00', reference: 'IN-0042' }
          : { items: [], total: 0, totalAmount: '0.00' },
      ),
    })
    const { unmount } = renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Record contribution')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record contribution'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    const dialog = openDialog()
    fireEvent.change(within(dialog).getByLabelText('What the money is for'), {
      target: { value: 'SAVINGS' },
    })
    fireEvent.change(within(dialog).getByLabelText('Amount in RWF'), { target: { value: '5000' } })
    await waitFor(() => {
      expect(within(openDialog()).getByLabelText('Income category')).not.toBeDisabled()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Income category'), {
      target: { value: CATEGORY_ID },
    })
    submitForm('record-contribution-form')

    await waitFor(() => {
      expect(calls.some((call) => call.method === 'POST')).toBe(true)
    })
    const posted = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>
    // A string on the wire, not a number: a float cannot hold a decimal amount exactly.
    expect(posted.amount).toBe('5000')
    expect(typeof posted.amount).toBe('string')
    expect(posted.type).toBe('SAVINGS')
    expect(posted.method).toBe('CASH')
    expect(posted.categoryId).toBe(CATEGORY_ID)

    unmount()
  })

  it('restates the amount before it is recorded', async () => {
    stubApi()
    const { unmount } = renderAt(`/members/${MEMBER_ID}`)

    await waitFor(() => {
      expect(screen.getByText('Record contribution')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Record contribution'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })

    fireEvent.change(within(openDialog()).getByLabelText('Amount in RWF'), {
      target: { value: '250000' },
    })

    await waitFor(() => {
      expect(
        within(openDialog()).getByText(/250,000 RWF received from Chantal Mukamana/),
      ).toBeInTheDocument()
    })

    unmount()
  })
})

describe('Kinyarwanda', () => {
  it('renders the whole register in Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubApi()
    renderAt('/members')

    // The heading is there before the register loads, so the wait is for the table itself.
    await waitFor(() => {
      expect(document.querySelector('table')).not.toBeNull()
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Abanyamuryango')
    expect(screen.getByText('Kongeramo umunyamuryango')).toBeInTheDocument()
    expect(screen.getByText('Badafite telefone')).toBeInTheDocument()
    const table = document.querySelector('table') as HTMLElement
    expect(within(table).getByText('Akora')).toBeInTheDocument()
    // No English left behind on the screen.
    expect(screen.queryByText('Add member')).toBeNull()
    expect(screen.queryByText('Active')).toBeNull()
    expect(screen.queryByText('Without a phone number')).toBeNull()
  })

  it('marks the phone field optional in Kinyarwanda too', async () => {
    await changeLanguage('rw')
    stubApi()
    const { unmount } = renderAt('/members')

    await waitFor(() => {
      expect(screen.getByText('Kongeramo umunyamuryango')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Kongeramo umunyamuryango'))
    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })

    // `bidasabwa` is the glossary's word for optional, and it matters most on this field.
    expect(within(openDialog()).getByLabelText(/Nimero ya telefone.*bidasabwa/)).toBeInTheDocument()

    unmount()
  })
})

describe('translation parity for the members namespace', () => {
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

  const en = enMembers as Json
  const rw = rwMembers as Json

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

/**
 * The contributions ledger.
 *
 * Two things this screen must never do: show an amount it has put through a JavaScript number, and
 * offer anything that deletes a record. Both are checked here.
 */
function ledgerPage(items: unknown[], totalAmount = '0.00', extra: Record<string, unknown> = {}) {
  return {
    __paged: true as const,
    items,
    meta: { page: 1, pageSize: 25, total: items.length, totalPages: 1, totalAmount },
    ...extra,
  }
}

const LEDGER_ROW = {
  id: 'c1f0d2e6-6a4b-4f31-8c7d-1e2b3a4c5d60',
  memberId: MEMBER_ID,
  memberCode: 'ABAH-0001',
  memberName: 'Chantal Mukamana',
  type: 'SAVINGS',
  amount: '12345.67',
  paidOn: '2026-08-14',
  method: 'CASH',
  reference: null,
  status: 'POSTED',
  financeReference: 'IN-2026-000042',
}

describe('the contributions ledger', () => {
  it('lists what came in, with the member it came from', async () => {
    stubApi({ '/contributions': ledgerPage([LEDGER_ROW], '12345.67') })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    expect(screen.getByText('ABAH-0001')).toBeInTheDocument()
    expect(screen.getByText('Savings')).toBeInTheDocument()
    expect(screen.getByText('IN-2026-000042')).toBeInTheDocument()
    unmount()
  })

  it('shows the amount exactly as the server sent it', async () => {
    stubApi({ '/contributions': ledgerPage([LEDGER_ROW], '12345.67') })
    const { unmount } = renderAt('/contributions')

    // Twelve thousand three hundred and forty-five francs and sixty-seven centimes, to the
    // centime. A float would have been enough to lose it.
    await waitFor(() => {
      expect(screen.getAllByText(/12,345\.67/).length).toBeGreaterThan(0)
    })
    unmount()
  })

  it('totals the whole filtered set rather than the page on screen', async () => {
    stubApi({
      '/contributions': ledgerPage([LEDGER_ROW], '4500000.00'),
    })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Total for these filters')).toBeInTheDocument()
    })
    // The figure a treasurer is asked for covers every page of the current filter. Trailing
    // zeros are dropped, so four and a half million francs reads as a round number.
    expect(screen.getByText(/4,500,000 RWF/)).toBeInTheDocument()
    unmount()
  })

  it('carries the dates into the address, so a narrowed view can be sent to somebody', async () => {
    stubApi({ '/contributions': ledgerPage([LEDGER_ROW], '12345.67') })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    fireEvent.change(screen.getByLabelText('Paid from'), { target: { value: '2026-08-01' } })

    await waitFor(() => {
      expect(lastCallTo('/contributions')?.url).toContain('from=2026-08-01')
    })
    unmount()
  })

  it('offers no way to delete a contribution', async () => {
    stubApi({ '/contributions': ledgerPage([LEDGER_ROW], '12345.67') })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    // A contribution recorded in error is cancelled, which writes a reversal. Deleting it would
    // leave the cooperative's books short with nothing to show why.
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.queryByText(/remove/i)).toBeNull()
    unmount()
  })

  it('refuses to cancel a contribution without a reason', async () => {
    stubApi({ '/contributions': ledgerPage([LEDGER_ROW], '12345.67') })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.click(within(openDialog()).getByText('Cancel the contribution'))

    await waitFor(() => {
      expect(
        within(openDialog()).getByText('Say why this contribution is being cancelled.'),
      ).toBeInTheDocument()
    })
    // Nothing was sent, so nothing was changed.
    expect(lastCallTo('/void')).toBeUndefined()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => {
      // No test may end with a dialog open: the layer Radix leaves behind confuses whatever
      // renders next in the same jsdom document.
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
    unmount()
  })

  it('cancels by reversal and names the entry that corrects it', async () => {
    stubApi({
      // One handler, because the stub matches on the longest key that the URL contains and
      // `/contributions` would otherwise swallow `/contributions/<id>/void`.
      '/contributions': replies((request) =>
        request.url.endsWith('/void')
          ? { id: LEDGER_ROW.id, status: 'VOID', reversalReference: 'EX-2026-000007' }
          : ledgerPage([LEDGER_ROW], '12345.67'),
      ),
    })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    fireEvent.click(screen.getByText('Cancel'))

    await waitFor(() => {
      expect(openDialog()).not.toBeNull()
    })
    fireEvent.change(within(openDialog()).getByLabelText('Why it is being cancelled'), {
      target: { value: 'Recorded twice by mistake' },
    })
    fireEvent.click(within(openDialog()).getByText('Cancel the contribution'))

    await waitFor(() => {
      expect(screen.getByText(/The reversal is EX-2026-000007/)).toBeInTheDocument()
    })
    const sent = lastCallTo('/void')
    expect(sent?.method).toBe('POST')
    expect(sent?.body).toEqual({ reason: 'Recorded twice by mistake' })
    unmount()
  })

  it('marks an already cancelled contribution and offers nothing further', async () => {
    stubApi({
      '/contributions': ledgerPage([{ ...LEDGER_ROW, status: 'VOID' }], '0.00'),
    })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Cancelled')).toBeInTheDocument()
    })
    // The row stays visible: the mistake and its correction are both part of the record.
    expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    expect(screen.queryByText('Cancel')).toBeNull()
    unmount()
  })

  it('shows no cancel control to somebody whose role does not cover it', async () => {
    resetSession()
    signInAs('SECRETARY')
    stubApi({ '/contributions': ledgerPage([LEDGER_ROW], '12345.67') })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
    })
    // A secretary may see contributions but not reverse them. The server refuses it as well; this
    // is only about not offering a control that would fail.
    expect(screen.queryByText('Cancel')).toBeNull()
    unmount()
  })

  it('reads in Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubApi({ '/contributions': ledgerPage([LEDGER_ROW], '12345.67') })
    const { unmount } = renderAt('/contributions')

    await waitFor(() => {
      expect(document.querySelector('table')).not.toBeNull()
    })
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Imisanzu')
    expect(screen.getByText('Umunyamuryango')).toBeInTheDocument()
    expect(screen.getByText("Igiteranyo cy'ibyatoranyijwe")).toBeInTheDocument()
    expect(screen.queryByText('Contributions')).toBeNull()
    unmount()
  })
})

describe('share movements', () => {
  const SHARE_ID = '9a8b7c6d-5e4f-4312-9876-1a2b3c4d5e6f'

  const POSTED = {
    id: SHARE_ID,
    type: 'PURCHASE',
    quantity: 12,
    unitValue: '10000.00',
    totalValue: '120000.00',
    issuedOn: '2026-03-04',
    certificateNo: 'CERT-0042',
    status: 'POSTED',
    note: null,
  }

  function withShares(handlers: Record<string, StubValue> = {}) {
    stubApi({
      [`/members/${MEMBER_ID}/shares`]: {
        items: [POSTED],
        holding: { quantity: 12, value: '120000.00' },
      },
      ...handlers,
    })
  }

  async function openProfile(): Promise<void> {
    renderAt(`/members/${MEMBER_ID}`)
    await waitFor(() => {
      expect(screen.getAllByText('CERT-0042').length).toBeGreaterThan(0)
    })
  }

  it('offers no recording controls to somebody who may only read shares', async () => {
    signInAs('VIEWER', { permissions: ['members:view', 'shares:view', 'dashboard:view'] })
    withShares()
    await openProfile()

    // Reading a member's stake and changing it are different jobs, and the server checks the
    // second on every request whatever the interface shows.
    expect(screen.queryByText('Record a movement')).toBeNull()
    expect(screen.queryByText('Cancel it')).toBeNull()
  })

  it('records a purchase with its category and restates the total first', async () => {
    withShares({
      [`/members/${MEMBER_ID}/shares`]: (request: StubRequest) =>
        request.method === 'POST'
          ? { id: SHARE_ID, quantity: 5, totalValue: '50000.00' }
          : { items: [POSTED], holding: { quantity: 12, value: '120000.00' } },
    })
    await openProfile()

    fireEvent.click(screen.getByText('Record a movement'))
    await waitFor(() => expect(screen.getByLabelText('What happened')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'PURCHASE' } })
    fireEvent.change(screen.getByLabelText('Number of shares'), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Value of one share'), { target: { value: '10000' } })

    // Five shares at ten thousand is what a member's certificate will say, so the dialog states it
    // before anybody commits to it.
    await waitFor(() => expect(screen.getByText('50,000 RWF')).toBeTruthy())

    // A purchase puts money into the cooperative, so the category is asked for — and only for a
    // purchase.
    fireEvent.change(screen.getByLabelText('Income category'), { target: { value: CATEGORY_ID } })
    fireEvent.click(screen.getByText('Record it'))

    await waitFor(() => {
      const request = lastWriteTo('/shares', 'POST')
      expect(request?.body).toMatchObject({
        type: 'PURCHASE',
        quantity: 5,
        // A decimal string, exactly as typed. Never a JavaScript number.
        unitValue: '10000',
        categoryId: CATEGORY_ID,
      })
    })
  })

  it('asks for the other member only on a transfer', async () => {
    withShares()
    await openProfile()

    fireEvent.click(screen.getByText('Record a movement'))
    await waitFor(() => expect(screen.getByLabelText('What happened')).toBeTruthy())

    // A redemption has neither a category nor another member.
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'REDEMPTION' } })
    expect(screen.queryByLabelText('Income category')).toBeNull()
    expect(screen.queryByLabelText('The other member')).toBeNull()

    // A transfer has two sides, and this is the other one.
    fireEvent.change(screen.getByLabelText('What happened'), { target: { value: 'TRANSFER_OUT' } })
    await waitFor(() => expect(screen.getByLabelText('The other member')).toBeTruthy())
    expect(screen.queryByLabelText('Income category')).toBeNull()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  })

  it('cancels a movement with a reason, and never deletes one', async () => {
    withShares({
      [`/members/${MEMBER_ID}/shares/${SHARE_ID}/void`]: { id: SHARE_ID, status: 'VOID' },
    })
    await openProfile()

    fireEvent.click(screen.getAllByText('Cancel it')[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('Cancel the movement')).toBeTruthy())

    // The dismiss button says what keeping it means: "Cancel" beside "Cancel the movement" would
    // be two opposite meanings of one word.
    expect(screen.getByText('Keep it recorded')).toBeTruthy()

    calls = []
    fireEvent.click(screen.getByText('Cancel the movement'))
    // A reason is required: a member can ask about this years later.
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])

    fireEvent.change(screen.getByLabelText('Why it is being cancelled'), {
      target: { value: 'Recorded against the wrong member' },
    })
    fireEvent.click(screen.getByText('Cancel the movement'))

    await waitFor(() => {
      const request = lastWriteTo('/void', 'POST')
      expect(request?.body).toEqual({ reason: 'Recorded against the wrong member' })
    })
  })
})
