import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../src/app/Providers'
import { adminRoutes } from '../src/features/admin/adminRoutes'
import i18n, { changeLanguage } from '../src/i18n'
import enAdmin from '../src/i18n/locales/en/admin.json'
import rwAdmin from '../src/i18n/locales/rw/admin.json'
import { useAuthStore } from '../src/stores/authStore'
import { signInAs } from './session'

/**
 * The platform administration screens.
 *
 * Everything is faked at the `fetch` boundary, exactly as `apiClient.test.ts` does, so the query
 * client, the API client, the permission guard, the forms and the translations all run for real.
 * Interaction uses `fireEvent` rather than `userEvent` because, as `test/setup.ts` records,
 * userEvent's pointer simulation does not terminate against a Radix portal under jsdom.
 *
 * The `admin` namespace is registered here rather than assumed: these files own the namespace, and
 * a test that silently rendered translation keys would pass while the screen was unreadable.
 */
i18n.addResourceBundle('en', 'admin', enAdmin, true, false)
i18n.addResourceBundle('rw', 'admin', rwAdmin, true, false)

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

function errorResponse(
  status: number,
  code: string,
  messageKey: string,
  message: string,
): Response {
  return jsonResponse(status, { error: { code, messageKey, message, requestId: 'req-test' } })
}

function validationResponse(field: string, messageKey: string): Response {
  return jsonResponse(422, {
    error: {
      code: 'VALIDATION_FAILED',
      messageKey: 'errors.validationFailed',
      message: 'Some of the information is not valid.',
      details: [{ field, messageKey }],
      requestId: 'req-test',
    },
  })
}

type Route = (url: string, init: RequestInit) => Response | Promise<Response>

function urlOf(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input
  if (input instanceof URL) return input.href
  return input.url
}

/** The request body as the client sent it. Every write in this application sends JSON. */
function jsonBody(init: RequestInit | undefined): unknown {
  const body = init?.body
  return typeof body === 'string' ? JSON.parse(body) : null
}

function stubFetch(route: Route) {
  const mock = vi.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(route(urlOf(input), init ?? {})),
  )
  vi.stubGlobal('fetch', mock)
  return mock
}

type FetchMock = ReturnType<typeof stubFetch>

function pageMeta(total: number, page = 1, pageSize = 25) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) }
}

function callsTo(mock: FetchMock, path: string, method: string) {
  return mock.mock.calls.filter(
    (call) => urlOf(call[0]).includes(path) && (call[1]?.method ?? 'GET') === method,
  )
}

/** The body of the first matching request, so a test can assert exactly what was sent. */
function requestBody(mock: FetchMock, path: string, method: string): unknown {
  const [call] = callsTo(mock, path, method)
  if (!call) throw new Error(`No ${method} request to ${path} was made`)
  return jsonBody(call[1])
}

/** The first element with this text, for a label that repeats across rows. */
function firstWithText(text: string): HTMLElement {
  const [element] = screen.getAllByText(text)
  if (!element) throw new Error(`No element with the text "${text}"`)
  return element
}

const TYPES = [
  {
    id: 'type-1',
    key: 'COFFEE',
    nameEn: 'Coffee',
    nameRw: 'Ikawa',
    descriptionEn: 'Coffee growers',
    descriptionRw: 'Abahinzi b’ikawa',
    iconKey: 'coffee',
    defaultUnitKeys: ['KG'],
  },
  {
    id: 'type-2',
    key: 'DAIRY',
    nameEn: 'Dairy',
    nameRw: 'Amata',
    descriptionEn: 'Milk collection',
    descriptionRw: 'Gukusanya amata',
    iconKey: 'milk',
    defaultUnitKeys: ['LITRE'],
  },
]

const COFFEE = {
  id: '8c1f0d2e-6a4b-4f31-8c7d-1e2b3a4c5d61',
  code: 'ABAHUZA-HUYE',
  name: 'Abahuzamugambi Coffee',
  typeKey: 'COFFEE',
  status: 'ACTIVE',
  isDemo: false,
  province: 'SOUTHERN',
  district: 'Huye',
  registrationNumber: 'RCA/2019/0431',
  staffCount: 6,
  activeStaffCount: 4,
  createdAt: '2024-03-04T09:00:00.000Z',
}

const DEMO_DAIRY = {
  ...COFFEE,
  id: '8c1f0d2e-6a4b-4f31-8c7d-1e2b3a4c5d62',
  code: 'DEMO-GASABO',
  name: 'Demonstration Dairy',
  typeKey: 'DAIRY',
  status: 'SUSPENDED',
  isDemo: true,
  province: 'KIGALI',
  district: 'Gasabo',
  activeStaffCount: 0,
}

function selfId(): string {
  return useAuthStore.getState().user?.id ?? ''
}

function selfRow() {
  return {
    id: selfId(),
    email: 'uwimana.claudine@example.test',
    fullName: 'Claudine Uwimana',
    status: 'ACTIVE',
    isPlatformAdmin: true,
    mustChangePassword: false,
    lastLoginAt: '2026-09-13T06:15:00.000Z',
    lockedUntil: null,
    memberships: [],
    createdAt: '2024-01-05T08:00:00.000Z',
  }
}

const COLLEAGUE = {
  id: '7b2e0d1a-5c3b-4e21-9a6d-0f1b2c3d4e5f',
  email: 'mukamana.chantal@example.test',
  fullName: 'Chantal Mukamana',
  status: 'ACTIVE',
  isPlatformAdmin: false,
  mustChangePassword: true,
  lastLoginAt: null,
  lockedUntil: null,
  memberships: [
    {
      cooperativeId: COFFEE.id,
      cooperativeName: 'Abahuzamugambi Coffee',
      roleKey: 'MANAGER',
      status: 'ACTIVE',
    },
  ],
  createdAt: '2025-06-11T10:00:00.000Z',
}

/** Mounts the platform routes the way the application shell mounts them. */
function renderAdmin(path: string) {
  const router = createMemoryRouter([{ path: '/', children: adminRoutes }], {
    initialEntries: [path],
  })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

beforeEach(() => {
  // The platform screens belong to the platform role, which is the only one holding `platform:*`.
  signInAs('SYSTEM_ADMIN')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  await changeLanguage('en')
})

describe('cooperatives list', () => {
  it('renders one page heading and a row for each cooperative', async () => {
    stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      return jsonResponse(200, { data: [COFFEE, DEMO_DAIRY], meta: pageMeta(2) })
    })

    renderAdmin('/admin/cooperatives')

    expect(await screen.findByText('Abahuzamugambi Coffee')).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Cooperatives')
    expect(screen.getByText('ABAHUZA-HUYE')).toBeInTheDocument()
    // The type name comes from the public reference endpoint, not from a translation file.
    expect(screen.getByText('Coffee')).toBeInTheDocument()
    expect(screen.getByText('Huye District, Southern Province')).toBeInTheDocument()
    expect(screen.getByText('4 of 6')).toBeInTheDocument()
  })

  it('describes the table for a screen reader and marks a demonstration cooperative', async () => {
    stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      return jsonResponse(200, { data: [COFFEE, DEMO_DAIRY], meta: pageMeta(2) })
    })

    renderAdmin('/admin/cooperatives')
    await screen.findByText('Demonstration Dairy')

    const table = screen.getByRole('table')
    expect(within(table).getByText(/Cooperatives on the platform/)).toBeInTheDocument()
    expect(within(table).getByText('Demonstration')).toBeInTheDocument()
    // Scoped to the table: "Suspended" is also one of the status filter's options.
    expect(within(table).getByText('Suspended')).toBeInTheDocument()
  })

  it('shows the loading state rather than an empty table while the first page is read', () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    )

    renderAdmin('/admin/cooperatives')

    expect(screen.getByText('Loading')).toBeInTheDocument()
    expect(screen.queryByText('No cooperatives yet')).not.toBeInTheDocument()
  })

  it('offers the primary action when there is no cooperative at all', async () => {
    stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      return jsonResponse(200, { data: [], meta: pageMeta(0) })
    })

    renderAdmin('/admin/cooperatives')

    expect(await screen.findByText('No cooperatives yet')).toBeInTheDocument()
    expect(
      screen.getByText(/Create the first cooperative together with the person/),
    ).toBeInTheDocument()
    expect(screen.getAllByText('New cooperative').length).toBeGreaterThan(1)
  })

  it('distinguishes an empty filter result and clears the filters again', async () => {
    stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      if (url.includes('status=ARCHIVED')) return jsonResponse(200, { data: [], meta: pageMeta(0) })
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/cooperatives')
    await screen.findByText('Abahuzamugambi Coffee')

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'ARCHIVED' } })

    expect(await screen.findByText('No cooperative matches these filters')).toBeInTheDocument()
    expect(screen.queryByText('No cooperatives yet')).not.toBeInTheDocument()

    fireEvent.click(screen.getByText('Clear filters'))
    expect(await screen.findByText('Abahuzamugambi Coffee')).toBeInTheDocument()
  })

  it('sends the typed search to the server', async () => {
    const mock = stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/cooperatives')
    await screen.findByText('Abahuzamugambi Coffee')

    fireEvent.change(screen.getByLabelText('Search cooperatives'), { target: { value: 'Huye' } })

    await waitFor(() => {
      expect(mock.mock.calls.some((call) => urlOf(call[0]).includes('q=Huye'))).toBe(true)
    })
  })

  it('states what failed and retries', async () => {
    let attempt = 0
    stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      attempt += 1
      if (attempt === 1) {
        return errorResponse(403, 'FORBIDDEN', 'errors.forbidden', 'No permission.')
      }
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/cooperatives')

    expect(await screen.findByText(/could not load the cooperatives/i)).toBeInTheDocument()
    expect(screen.getByText('You do not have permission to do this.')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Try again'))
    expect(await screen.findByText('Abahuzamugambi Coffee')).toBeInTheDocument()
  })
})

describe('cooperative status changes', () => {
  it('suspends a cooperative once the consequence has been confirmed', async () => {
    const mock = stubFetch((url, init) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      if ((init.method ?? 'GET') === 'PATCH') {
        return jsonResponse(200, { data: { ...COFFEE, status: 'SUSPENDED' } })
      }
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/cooperatives')
    await screen.findByText('Abahuzamugambi Coffee')

    fireEvent.click(screen.getByText('Suspend'))

    expect(await screen.findByText('Suspend Abahuzamugambi Coffee?')).toBeInTheDocument()
    expect(screen.getByText(/signed out at once/)).toBeInTheDocument()

    fireEvent.click(screen.getByText('Suspend cooperative'))

    await waitFor(() => {
      expect(callsTo(mock, `/admin/cooperatives/${COFFEE.id}`, 'PATCH')).toHaveLength(1)
    })
    expect(requestBody(mock, '/admin/cooperatives/', 'PATCH')).toEqual({
      status: 'SUSPENDED',
    })
    await waitFor(() => {
      expect(screen.queryByText('Suspend Abahuzamugambi Coffee?')).not.toBeInTheDocument()
    })
  })

  it('keeps the confirmation open and explains a refused archive', async () => {
    stubFetch((url, init) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      if ((init.method ?? 'GET') === 'PATCH') {
        return errorResponse(
          409,
          'CONFLICT',
          'errors.admin.archiveHasStaff',
          'Deactivate the remaining staff before archiving this cooperative.',
        )
      }
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/cooperatives')
    await screen.findByText('Abahuzamugambi Coffee')

    fireEvent.click(screen.getByText('Archive'))
    fireEvent.click(await screen.findByText('Archive cooperative'))

    expect(
      await screen.findByText(/Deactivate the staff who are still working there/),
    ).toBeInTheDocument()
    expect(screen.getByText('Archive Abahuzamugambi Coffee?')).toBeInTheDocument()
  })

  it('only offers restore for an archived cooperative', async () => {
    stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      return jsonResponse(200, {
        data: [{ ...COFFEE, status: 'ARCHIVED' }],
        meta: pageMeta(1),
      })
    })

    renderAdmin('/admin/cooperatives')
    await screen.findByText('Abahuzamugambi Coffee')

    expect(screen.getByText('Restore')).toBeInTheDocument()
    expect(screen.queryByText('Suspend')).not.toBeInTheDocument()
    expect(screen.queryByText('Archive')).not.toBeInTheDocument()
  })
})

describe('new cooperative', () => {
  async function openAndFill(mock: FetchMock) {
    renderAdmin('/admin/cooperatives')
    await screen.findByText('Abahuzamugambi Coffee')

    fireEvent.click(firstWithText('New cooperative'))

    const type = await screen.findByLabelText('What the cooperative does')
    await waitFor(() => {
      expect(type.querySelectorAll('option').length).toBeGreaterThan(1)
    })

    fireEvent.change(screen.getByLabelText('Cooperative name'), {
      target: { value: 'Koperative Twitezimbere' },
    })
    fireEvent.change(screen.getByLabelText('Short code'), { target: { value: 'twiteze-nyagt' } })
    fireEvent.change(type, { target: { value: 'DAIRY' } })
    fireEvent.change(screen.getByLabelText('Province'), { target: { value: 'WESTERN' } })
    fireEvent.change(screen.getByLabelText('District'), { target: { value: 'Nyamasheke' } })
    fireEvent.change(screen.getByLabelText('Sector'), { target: { value: 'Kagano' } })
    fireEvent.change(screen.getByLabelText('Cell'), { target: { value: 'Gako' } })
    fireEvent.change(screen.getByLabelText('Village'), { target: { value: 'Nyabitare' } })
    fireEvent.change(screen.getByLabelText("Manager's full name"), {
      target: { value: 'Jean Bosco Habimana' },
    })
    fireEvent.change(screen.getByLabelText("Manager's email address"), {
      target: { value: 'habimana@example.test' },
    })

    fireEvent.click(screen.getByText('Create cooperative'))
    return mock
  }

  it('creates the cooperative with its first manager and says what happens next', async () => {
    const mock = stubFetch((url, init) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      if ((init.method ?? 'GET') === 'POST') {
        return jsonResponse(201, {
          data: {
            cooperative: { ...COFFEE, name: 'Koperative Twitezimbere', code: 'TWITEZE-NYAGT' },
            manager: {
              userId: 'user-new',
              email: 'habimana@example.test',
              accountCreated: true,
            },
          },
        })
      }
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    await openAndFill(mock)

    await waitFor(() => {
      expect(callsTo(mock, '/admin/cooperatives', 'POST')).toHaveLength(1)
    })
    expect(requestBody(mock, '/admin/cooperatives', 'POST')).toEqual({
      name: 'Koperative Twitezimbere',
      // Upper-cased before it is sent, which is what the server stores either way.
      code: 'TWITEZE-NYAGT',
      typeKey: 'DAIRY',
      province: 'WESTERN',
      district: 'Nyamasheke',
      sector: 'Kagano',
      cell: 'Gako',
      village: 'Nyabitare',
      manager: { email: 'habimana@example.test', fullName: 'Jean Bosco Habimana' },
    })

    expect(
      await screen.findByText(/Koperative Twitezimbere is ready\. We sent habimana@example\.test/),
    ).toBeInTheDocument()
  })

  it('refuses an impossible code before anything is sent', async () => {
    const mock = stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/cooperatives')
    await screen.findByText('Abahuzamugambi Coffee')
    fireEvent.click(firstWithText('New cooperative'))

    fireEvent.change(await screen.findByLabelText('Short code'), { target: { value: '1' } })
    fireEvent.click(screen.getByText('Create cooperative'))

    expect(
      await screen.findByText(/Use capital letters, digits and hyphens only/),
    ).toBeInTheDocument()
    expect(callsTo(mock, '/admin/cooperatives', 'POST')).toHaveLength(0)
  })

  it("shows the server's own field error against the field it names", async () => {
    const mock = stubFetch((url, init) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      if ((init.method ?? 'GET') === 'POST') {
        return validationResponse('body.district', 'validation.invalid_format')
      }
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    await openAndFill(mock)

    expect(await screen.findByText('This is not in the expected format.')).toBeInTheDocument()
    // The dialog stays open, so the correction can be made where it was typed.
    expect(screen.getByLabelText('District')).toBeInTheDocument()
  })
})

describe('platform users', () => {
  it('lists accounts with their platform rights and cooperatives', async () => {
    stubFetch(() => jsonResponse(200, { data: [selfRow(), COLLEAGUE], meta: pageMeta(2) }))

    renderAdmin('/admin/users')

    expect(await screen.findByText('Chantal Mukamana')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('People using the platform')
    expect(screen.getByText('Administers the platform')).toBeInTheDocument()
    expect(screen.getByText('Ordinary account')).toBeInTheDocument()
    expect(screen.getByText('Abahuzamugambi Coffee')).toBeInTheDocument()
    expect(screen.getByText('Has never signed in')).toBeInTheDocument()
    expect(screen.getByText('Password not set yet')).toBeInTheDocument()
  })

  it('disables the controls on the caller’s own row and explains why', async () => {
    stubFetch(() => jsonResponse(200, { data: [selfRow(), COLLEAGUE], meta: pageMeta(2) }))

    renderAdmin('/admin/users')
    await screen.findByText('Claudine Uwimana')

    expect(screen.getByText('This is you')).toBeInTheDocument()
    // Two rows, so each action label appears twice; the caller's own pair is the disabled one.
    const withdraw = screen.getByText('Withdraw administrator')
    expect(withdraw).toBeDisabled()
    const suspends = screen.getAllByText('Suspend')
    expect(suspends.filter((button) => (button as HTMLButtonElement).disabled)).toHaveLength(1)
    expect(screen.getAllByText(/You cannot change your own access/).length).toBeGreaterThan(0)
  })

  it('gives platform rights after the confirmation', async () => {
    const mock = stubFetch((url, init) => {
      if ((init.method ?? 'GET') === 'PATCH') {
        return jsonResponse(200, { data: { ...COLLEAGUE, isPlatformAdmin: true } })
      }
      return jsonResponse(200, { data: [COLLEAGUE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/users')
    await screen.findByText('Chantal Mukamana')

    fireEvent.click(screen.getByText('Make administrator'))
    expect(await screen.findByText('Give Chantal Mukamana platform rights?')).toBeInTheDocument()

    fireEvent.click(screen.getByText('Give platform rights'))

    await waitFor(() => {
      expect(callsTo(mock, `/admin/users/${COLLEAGUE.id}`, 'PATCH')).toHaveLength(1)
    })
    expect(requestBody(mock, '/admin/users/', 'PATCH')).toEqual({ isPlatformAdmin: true })
  })

  it('explains the refusal when the last administrator would be removed', async () => {
    const admin = { ...COLLEAGUE, isPlatformAdmin: true }
    stubFetch((url, init) => {
      if ((init.method ?? 'GET') === 'PATCH') {
        return errorResponse(
          409,
          'CONFLICT',
          'errors.admin.lastPlatformAdmin',
          'This is the only platform administrator.',
        )
      }
      return jsonResponse(200, { data: [admin], meta: pageMeta(1) })
    })

    renderAdmin('/admin/users')
    await screen.findByText('Chantal Mukamana')

    fireEvent.click(screen.getByText('Withdraw administrator'))
    fireEvent.click(await screen.findByText('Withdraw platform rights'))

    expect(await screen.findByText(/only platform administrator left/)).toBeInTheDocument()
  })

  it('suspends an account and asks the list again', async () => {
    const mock = stubFetch((url, init) => {
      if ((init.method ?? 'GET') === 'PATCH') {
        return jsonResponse(200, { data: { ...COLLEAGUE, status: 'SUSPENDED' } })
      }
      return jsonResponse(200, { data: [COLLEAGUE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/users')
    await screen.findByText('Chantal Mukamana')

    fireEvent.click(screen.getByText('Suspend'))
    fireEvent.click(await screen.findByText('Suspend account'))

    await waitFor(() => {
      expect(requestBody(mock, '/admin/users/', 'PATCH')).toEqual({ status: 'SUSPENDED' })
    })
    // The refreshed list is read back rather than the row being patched in place.
    await waitFor(() => {
      expect(callsTo(mock, '/admin/users', 'GET').length).toBeGreaterThan(1)
    })
  })

  it('creates an account, including the platform flag when it is switched on', async () => {
    const mock = stubFetch((url, init) => {
      if ((init.method ?? 'GET') === 'POST') {
        return jsonResponse(201, {
          data: { ...COLLEAGUE, fullName: 'Aline Uwase', email: 'uwase@example.test' },
        })
      }
      return jsonResponse(200, { data: [COLLEAGUE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/users')
    await screen.findByText('Chantal Mukamana')

    fireEvent.click(firstWithText('New user'))

    fireEvent.change(await screen.findByLabelText('Full name'), {
      target: { value: 'Aline Uwase' },
    })
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'uwase@example.test' },
    })
    fireEvent.click(screen.getByText('May administer the platform'))
    fireEvent.click(screen.getByText('Create account'))

    await waitFor(() => {
      expect(callsTo(mock, '/admin/users', 'POST')).toHaveLength(1)
    })
    expect(requestBody(mock, '/admin/users', 'POST')).toEqual({
      email: 'uwase@example.test',
      fullName: 'Aline Uwase',
      isPlatformAdmin: true,
    })
    expect(await screen.findByText(/Aline Uwase can now set a password/)).toBeInTheDocument()
  })

  it('tells an empty search apart from an empty platform', async () => {
    stubFetch((url) => {
      if (url.includes('q=Nobody')) return jsonResponse(200, { data: [], meta: pageMeta(0) })
      return jsonResponse(200, { data: [COLLEAGUE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/users')
    await screen.findByText('Chantal Mukamana')

    fireEvent.change(screen.getByLabelText('Search people'), { target: { value: 'Nobody' } })

    expect(await screen.findByText('Nobody matches these filters')).toBeInTheDocument()
    expect(screen.getByText('Clear filters')).toBeInTheDocument()
  })
})

describe('platform settings', () => {
  it('saves the default language as soon as it is chosen', async () => {
    let stored = 'RW'
    const mock = stubFetch((url, init) => {
      if ((init.method ?? 'GET') === 'PUT') {
        stored = String((jsonBody(init) as { value: string }).value)
        return jsonResponse(200, { data: { defaultCooperativeLocale: stored } })
      }
      return jsonResponse(200, { data: { defaultCooperativeLocale: stored } })
    })

    renderAdmin('/admin/settings')

    const select = await screen.findByLabelText('Starting language for a new cooperative')
    expect(select).toHaveValue('RW')

    fireEvent.change(select, { target: { value: 'EN' } })

    await waitFor(() => {
      expect(callsTo(mock, '/admin/settings/defaultCooperativeLocale', 'PUT')).toHaveLength(1)
    })
    expect(requestBody(mock, '/admin/settings/defaultCooperativeLocale', 'PUT')).toEqual({
      value: 'EN',
    })
    expect(
      await screen.findByText(/New cooperatives will start in this language/),
    ).toBeInTheDocument()
  })

  it('says plainly when the setting could not be saved', async () => {
    stubFetch((url, init) => {
      if ((init.method ?? 'GET') === 'PUT') {
        return errorResponse(403, 'FORBIDDEN', 'errors.forbidden', 'No permission.')
      }
      return jsonResponse(200, { data: { defaultCooperativeLocale: 'RW' } })
    })

    renderAdmin('/admin/settings')
    const select = await screen.findByLabelText('Starting language for a new cooperative')
    fireEvent.change(select, { target: { value: 'EN' } })

    expect(await screen.findByText('You do not have permission to do this.')).toBeInTheDocument()
    expect(screen.queryByText(/New cooperatives will start/)).not.toBeInTheDocument()
  })
})

describe('platform health', () => {
  const HEALTHY = {
    database: { reachable: true, latencyMs: 12 },
    counts: {
      cooperatives: 42,
      activeCooperatives: 40,
      users: 1350,
      activeUsers: 1290,
      platformAdmins: 3,
    },
    timestamp: '2026-09-14T07:45:00.000Z',
  }

  it('reads the figures as tiles and the state as a sentence', async () => {
    stubFetch(() => jsonResponse(200, { data: HEALTHY }))

    renderAdmin('/admin/health')

    expect(await screen.findByText('Reachable')).toBeInTheDocument()
    expect(screen.getByText('The database is answering, in 12 milliseconds.')).toBeInTheDocument()
    expect(screen.getByText('Cooperatives')).toBeInTheDocument()
    expect(screen.getByText('42')).toBeInTheDocument()
    expect(screen.getByText('1,350')).toBeInTheDocument()
    expect(screen.getByText('Platform administrators')).toBeInTheDocument()
  })

  it('says what an unreachable database means', async () => {
    stubFetch(() =>
      jsonResponse(200, {
        data: { ...HEALTHY, database: { reachable: false, latencyMs: null } },
      }),
    )

    renderAdmin('/admin/health')

    expect(await screen.findByText(/The database is not answering/)).toBeInTheDocument()
    expect(screen.getByText('Not reachable')).toBeInTheDocument()
  })

  it('checks again on demand', async () => {
    const mock = stubFetch(() => jsonResponse(200, { data: HEALTHY }))

    renderAdmin('/admin/health')
    await screen.findByText('Reachable')

    fireEvent.click(screen.getByText('Check again'))

    await waitFor(() => {
      expect(callsTo(mock, '/admin/health', 'GET').length).toBe(2)
    })
  })
})

describe('permission guard', () => {
  it('refuses a cooperative manager, who holds no platform permission', () => {
    signInAs('MANAGER')
    stubFetch(() => jsonResponse(200, { data: [], meta: pageMeta(0) }))

    renderAdmin('/admin/cooperatives')

    expect(screen.getByText('You do not have access to this page')).toBeInTheDocument()
    expect(screen.queryByText('Cooperatives')).not.toBeInTheDocument()
  })
})

describe('Kinyarwanda', () => {
  it('reads the cooperative list in Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubFetch((url) => {
      if (url.includes('/cooperative-types')) return jsonResponse(200, { data: TYPES })
      return jsonResponse(200, { data: [COFFEE], meta: pageMeta(1) })
    })

    renderAdmin('/admin/cooperatives')

    expect(await screen.findByText('Abahuzamugambi Coffee')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Koperative')
    const table = screen.getByRole('table')
    expect(within(table).getByText('Ikora')).toBeInTheDocument()
    expect(within(table).getByText('Guhagarika')).toBeInTheDocument()
    // The type name is the Kinyarwanda one the reference endpoint carries.
    expect(within(table).getByText('Ikawa')).toBeInTheDocument()
  })
})
