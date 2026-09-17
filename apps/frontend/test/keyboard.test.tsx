import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ALL_NAV_ITEMS } from '../src/app/navigation'
import { Providers } from '../src/app/Providers'
import { routes } from '../src/app/routes'
import { useAuthStore } from '../src/stores/authStore'
import { resetSession, signInAs, signOutForTests } from './session'

/**
 * The critical flows, driven by the keyboard alone: Tab, Shift+Tab, Enter, Space and Escape, and
 * never a click. A cooperative's office computer may have a mouse that has stopped working, and a
 * screen-reader user never had one; either way the sign-in, the register and the registration
 * form have to be reachable and completable without it.
 *
 * `docs/ui-system.md` §9 lists the flows a person also walks through by hand before a release;
 * these are the ones a test can walk.
 */
vi.mock('../src/features/auth/auth.api', () => ({
  login: vi.fn(),
  logout: vi.fn(),
  fetchSession: vi.fn(),
  updateProfile: vi.fn(),
  changePassword: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
  listSessions: vi.fn(),
  revokeSession: vi.fn(),
}))

const authApi = vi.mocked(await import('../src/features/auth/auth.api'))

const MEMBER_ID = '7c9e6679-7425-40de-944b-e07fc1f90ae7'

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

interface Call {
  url: string
  method: string
  body: unknown
}

let calls: Call[] = []

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/** A register with one member, which accepts a second. Anything else is refused. */
function stubMembersApi() {
  calls = []
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      calls.push({ url, method, body })

      if (url.includes('/members/stats')) {
        return Promise.resolve(
          json({ data: { total: 1, byStatus: { ACTIVE: 1 }, newThisMonth: 0, withoutPhone: 1 } }),
        )
      }
      if (url.includes('/members/form-options')) {
        return Promise.resolve(json({ data: { incomeCategories: [] } }))
      }
      if (url.includes('/members') && method === 'POST') {
        const posted = body as Record<string, unknown>
        return Promise.resolve(
          json(
            {
              data: {
                ...MEMBER_ROW,
                id: 'new',
                firstName: posted.firstName,
                lastName: posted.lastName,
                fullName: `${String(posted.firstName)} ${String(posted.lastName)}`,
              },
            },
            201,
          ),
        )
      }
      if (url.includes('/members')) {
        return Promise.resolve(
          json({ data: [MEMBER_ROW], meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 } }),
        )
      }
      return Promise.resolve(
        json(
          { error: { code: 'NOT_FOUND', messageKey: 'errors.notFound', message: 'no stub' } },
          404,
        ),
      )
    }),
  )
}

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
  return { ...view, router }
}

/** Presses Tab until the focused element satisfies the test, or gives up after a page's worth. */
async function tabUntil(
  user: ReturnType<typeof userEvent.setup>,
  matches: (element: Element) => boolean,
  limit = 60,
): Promise<HTMLElement> {
  for (let i = 0; i < limit; i += 1) {
    await user.tab()
    const active = document.activeElement
    if (active && active !== document.body && matches(active)) return active as HTMLElement
  }
  throw new Error(`Nothing matching was reached in ${limit} presses of Tab`)
}

function openDialog(): HTMLElement | null {
  return document.querySelector('[role="dialog"]')
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
  resetSession()
})

describe('signing in by keyboard', () => {
  it('reaches both fields and submits with Enter', async () => {
    signOutForTests()
    authApi.login.mockResolvedValue({
      accessToken: 'typed-in',
      expiresIn: 900,
      user: {
        id: 'u1',
        email: 'a@example.test',
        fullName: 'Aline Ingabire',
        phone: null,
        locale: 'EN',
        isPlatformAdmin: false,
        mustChangePassword: false,
        lastLoginAt: null,
      },
      memberships: [],
    })
    authApi.fetchSession.mockResolvedValue({
      user: {
        id: 'u1',
        email: 'a@example.test',
        fullName: 'Aline Ingabire',
        phone: null,
        locale: 'EN',
        isPlatformAdmin: false,
        mustChangePassword: false,
        lastLoginAt: null,
      },
      memberships: [],
      cooperative: null,
      roleKey: null,
      permissions: [],
    })

    const user = userEvent.setup()
    renderApp('/login')

    const email = await tabUntil(user, (el) => el === screen.getByLabelText('Email address'))
    await user.keyboard('a@example.test')

    const password = await tabUntil(user, (el) => el === screen.getByLabelText('Password'))
    // The password field is the very next stop after the email — nothing focusable lies between
    // them that a person would have to Tab past.
    expect(email.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await user.keyboard('a-good-long-passphrase')

    // Enter in a field submits the form; a keyboard user never has to find the button.
    await user.keyboard('{Enter}')

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('typed-in'))
    expect(authApi.login).toHaveBeenCalledWith('a@example.test', 'a-good-long-passphrase')
  })
})

describe('the member register by keyboard', () => {
  beforeEach(() => {
    signInAs('MANAGER')
    stubMembersApi()
  })

  it('offers a skip link first, and it lands on the content', async () => {
    const user = userEvent.setup()
    renderApp('/members')
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument())

    await user.tab()
    expect(document.activeElement).toHaveTextContent('Skip to main content')
    await user.keyboard('{Enter}')

    // Focus is on the content landmark itself, so the next Tab a browser sends lands inside the
    // screen rather than back at the top of the navigation. (The browser's own rule — Tab from a
    // script-focused element continues from its place in the document — is not one user-event
    // models, so the test stops at the landmark.)
    expect(document.activeElement).toBe(screen.getByRole('main'))
  })

  it('registers a member with no mouse: open, fill, submit, and focus comes back', async () => {
    const user = userEvent.setup()
    renderApp('/members')

    const addMember = await waitFor(() => screen.getByRole('button', { name: 'Add member' }))
    await tabUntil(user, (el) => el === addMember)
    await user.keyboard('{Enter}')

    // The dialog opens and puts focus on its first field, so the next keystroke is the first
    // letter of the name — not a press of the close cross, and nothing behind the dialog.
    await waitFor(() => expect(openDialog()).not.toBeNull())
    const dialog = openDialog() as HTMLElement
    await waitFor(() =>
      expect(document.activeElement).toBe(within(dialog).getByLabelText('First name')),
    )
    await user.keyboard('Jean')
    const familyName = await tabUntil(
      user,
      (el) => el === within(dialog).getByLabelText('Family name'),
    )
    await user.keyboard('Bizimana')

    // A browser submits the form on Enter from any of its fields when the form owns a submit
    // button — and this one does, though the button sits in the dialog's footer rather than
    // inside the `<form>` element. user-event only looks inside the element, so that contract is
    // asserted on the DOM directly, and the walk continues the other way a person would go: Tab
    // to the button and press it.
    const form = (familyName as HTMLInputElement).form as HTMLFormElement
    expect(form).not.toBeNull()
    expect(
      [...form.elements].some((el) => el instanceof HTMLButtonElement && el.type === 'submit'),
    ).toBe(true)

    const submit = within(dialog).getByRole('button', { name: 'Add member' })
    await tabUntil(user, (el) => el === submit)
    await user.keyboard('{Enter}')

    await waitFor(() => expect(calls.some((call) => call.method === 'POST')).toBe(true))
    const posted = calls.find((call) => call.method === 'POST')?.body as Record<string, unknown>
    expect(posted.firstName).toBe('Jean')
    expect(posted.lastName).toBe('Bizimana')
    expect(posted.phone).toBeUndefined()

    // The dialog closes on success and focus returns to the button that opened it, so the person
    // is where they were and can register the next member with the same keystroke.
    await waitFor(() => expect(openDialog()).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(addMember))
  })

  it('closes the form with Escape and loses nothing that was already on the register', async () => {
    const user = userEvent.setup()
    renderApp('/members')

    const addMember = await waitFor(() => screen.getByRole('button', { name: 'Add member' }))
    await tabUntil(user, (el) => el === addMember)
    await user.keyboard(' ')
    await waitFor(() => expect(openDialog()).not.toBeNull())

    await user.keyboard('{Escape}')
    await waitFor(() => expect(openDialog()).toBeNull())
    await waitFor(() => expect(document.activeElement).toBe(addMember))
    expect(calls.some((call) => call.method === 'POST')).toBe(false)
    expect(screen.getByText('Chantal Mukamana')).toBeInTheDocument()
  })

  it('keeps Tab inside the open form rather than wandering into the page behind', async () => {
    const user = userEvent.setup()
    renderApp('/members')

    const addMember = await waitFor(() => screen.getByRole('button', { name: 'Add member' }))
    await tabUntil(user, (el) => el === addMember)
    await user.keyboard('{Enter}')
    await waitFor(() => expect(openDialog()).not.toBeNull())
    const dialog = openDialog() as HTMLElement

    // More presses than the form has controls: focus must have cycled, never escaped.
    for (let i = 0; i < 40; i += 1) {
      await user.tab()
      expect(dialog, `after ${i + 1} presses`).toContainElement(
        document.activeElement as HTMLElement,
      )
    }
    await user.keyboard('{Escape}')
    await waitFor(() => expect(openDialog()).toBeNull())
  })
})

describe('shortcuts', () => {
  it('gives every screen a different letter', () => {
    const letters = ALL_NAV_ITEMS.map((item) => item.shortcut).filter(Boolean)
    expect(letters.length).toBe(ALL_NAV_ITEMS.length)
    expect(new Set(letters).size).toBe(letters.length)
    for (const letter of letters) expect(letter).toMatch(/^[a-z]$/)
  })

  it('goes to a screen on g then its letter', async () => {
    signInAs('MANAGER')
    stubMembersApi()
    const user = userEvent.setup()
    const { router } = renderApp('/')
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument())

    await user.keyboard('g')
    await user.keyboard('m')
    await waitFor(() => expect(router.state.location.pathname).toBe('/members'))
  })

  it('does not fire while somebody is typing', async () => {
    signInAs('MANAGER')
    stubMembersApi()
    const user = userEvent.setup()
    const { router } = renderApp('/')
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument())

    const search = screen.getByRole('combobox')
    search.focus()
    await user.keyboard('gm')
    expect(search).toHaveValue('gm')
    expect(router.state.location.pathname).toBe('/')
  })

  it('reaches only the screens the reader can see', async () => {
    // An inventory officer has no finance permission: `g f` must be as inert for them as it is
    // invisible in the sidebar, rather than a way around it.
    signInAs('INVENTORY_OFFICER')
    stubMembersApi()
    const user = userEvent.setup()
    const { router } = renderApp('/')
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument())
    expect(screen.queryByRole('link', { name: 'Finance' })).toBeNull()

    await user.keyboard('g')
    await user.keyboard('f')
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(router.state.location.pathname).toBe('/')

    await user.keyboard('g')
    await user.keyboard('i')
    await waitFor(() => expect(router.state.location.pathname).toBe('/inventory'))
  })

  it('lists itself on ?, in the reader’s language, and closes on Escape', async () => {
    signInAs('MANAGER')
    stubMembersApi()
    const user = userEvent.setup()
    renderApp('/')
    await waitFor(() => expect(screen.getByRole('main')).toBeInTheDocument())

    await user.keyboard('?')
    await waitFor(() => expect(openDialog()).not.toBeNull())
    const dialog = openDialog() as HTMLElement
    expect(dialog).toHaveTextContent('Keyboard shortcuts')
    expect(dialog).toHaveTextContent('Members')
    expect(within(dialog).getAllByText('g').length).toBeGreaterThan(5)

    // A shortcut pressed inside the list is not a shortcut: the dialog has the keyboard.
    await user.keyboard('g')
    await user.keyboard('m')
    expect(openDialog()).not.toBeNull()

    await user.keyboard('{Escape}')
    await waitFor(() => expect(openDialog()).toBeNull())
  })
})
