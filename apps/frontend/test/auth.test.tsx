import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../src/app/Providers'
import { routes } from '../src/app/routes'
import { changeLanguage } from '../src/i18n'
import { ApiError } from '../src/lib/apiClient'
import { useAuthStore } from '../src/stores/authStore'
import { useSignOut } from '../src/features/auth/useSignOut'
import { resetSession, signInAs, signOutForTests, TEST_COOPERATIVE_ID } from './session'

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

vi.mock('../src/features/audit/audit.api', () => ({ fetchAuditPage: vi.fn() }))

const authApi = vi.mocked(await import('../src/features/auth/auth.api'))
const auditApi = vi.mocked(await import('../src/features/audit/audit.api'))

function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(async () => {
  await changeLanguage('en')
})

describe('the guard on every screen', () => {
  it('shows nothing decisive while the session is still being restored', () => {
    // A cold load always starts without an access token, because it is held in memory. Showing
    // the login form here would flash it past somebody who is in fact signed in.
    resetSession()
    renderApp('/')
    expect(screen.getByRole('status')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Sign in' })).not.toBeInTheDocument()
  })

  it('sends an anonymous visitor to the sign-in screen', async () => {
    signOutForTests()
    renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Sign in' })).toBeInTheDocument()
  })

  it('remembers where the visitor was going', async () => {
    signOutForTests()
    renderApp('/settings/audit')
    await screen.findByRole('heading', { level: 1, name: 'Sign in' })

    authApi.login.mockResolvedValue({
      accessToken: 'fresh-token',
      expiresIn: 900,
      user: {
        id: 'u1',
        email: 'uwimana.claudine@example.test',
        fullName: 'Claudine Uwimana',
        phone: null,
        locale: 'EN',
        isPlatformAdmin: false,
        mustChangePassword: false,
        lastLoginAt: null,
      },
      memberships: [],
    })
    authApi.fetchSession.mockImplementation(() => {
      signInAs('MANAGER')
      return Promise.resolve({
        user: useAuthStore.getState().user!,
        memberships: useAuthStore.getState().memberships,
        cooperative: null,
        roleKey: 'MANAGER' as const,
        permissions: [...useAuthStore.getState().permissions],
      })
    })
    auditApi.fetchAuditPage.mockResolvedValue({ items: [], meta: { limit: 25, nextCursor: null } })

    await userEvent.type(screen.getByLabelText('Email address'), 'uwimana.claudine@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'a-good-long-passphrase')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    // Straight to the page they asked for, not to the dashboard and a second navigation.
    expect(await screen.findByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument()
  })
})

describe('signing in', () => {
  beforeEach(() => {
    signOutForTests()
  })

  it('keeps the access token in memory only', async () => {
    authApi.login.mockResolvedValue({
      accessToken: 'in-memory-only',
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

    renderApp('/login')
    await userEvent.type(screen.getByLabelText('Email address'), 'a@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'a-good-long-passphrase')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    await waitFor(() => expect(useAuthStore.getState().accessToken).toBe('in-memory-only'))
    // Nothing that could be read by a script on the page.
    expect(JSON.stringify(window.localStorage)).not.toContain('in-memory-only')
  })

  it('explains a refusal in the user’s own language and keeps the email', async () => {
    authApi.login.mockRejectedValue(
      new ApiError({
        status: 401,
        code: 'INVALID_CREDENTIALS',
        messageKey: 'errors.invalidCredentials',
        message: 'That email address and password do not match an account.',
      }),
    )

    renderApp('/login')
    await userEvent.type(screen.getByLabelText('Email address'), 'a@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-one-entirely')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/do not match an account/i)
    expect(screen.getByLabelText('Email address')).toHaveValue('a@example.test')
    expect(screen.getByLabelText('Password')).toHaveValue('')
  })

  it('says how long an account is locked for', async () => {
    authApi.login.mockRejectedValue(
      new ApiError({
        status: 401,
        code: 'ACCOUNT_LOCKED',
        messageKey: 'errors.accountLocked',
        messageParams: { minutes: 8 },
        message: 'Too many failed attempts.',
      }),
    )

    renderApp('/login')
    await userEvent.type(screen.getByLabelText('Email address'), 'a@example.test')
    await userEvent.type(screen.getByLabelText('Password'), 'wrong-one-entirely')
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/8 minutes/)
  })

  it('reads entirely in Kinyarwanda', async () => {
    await changeLanguage('rw')
    renderApp('/login')
    expect(screen.getByRole('heading', { level: 1, name: 'Injira' })).toBeInTheDocument()
    expect(screen.getByLabelText('Ijambobanga')).toBeInTheDocument()
    expect(screen.queryByText('Password')).not.toBeInTheDocument()
  })
})

describe('forgot password', () => {
  beforeEach(() => {
    signOutForTests()
  })

  it('says the same thing whether or not the address is registered', async () => {
    authApi.requestPasswordReset.mockResolvedValue(undefined)
    renderApp('/forgot-password')

    // The password screens are fetched on demand, so the form arrives a tick after the render.
    await screen.findByLabelText('Email address')
    await userEvent.type(screen.getByLabelText('Email address'), 'nobody@example.test')
    await userEvent.click(screen.getByRole('button', { name: 'Send the reset link' }))

    const confirmation = await screen.findByText(/if that address belongs to an account/i)
    expect(confirmation).toBeInTheDocument()
    // No hint either way, or the form becomes a list of everybody with an account.
    expect(screen.queryByText(/no such account/i)).not.toBeInTheDocument()
  })
})

describe('choosing a new password', () => {
  beforeEach(() => {
    signOutForTests()
  })

  it('refuses a password the API would refuse, before sending it', async () => {
    renderApp('/reset-password/some-reset-token-value-here')

    await screen.findByLabelText('New password')
    await userEvent.type(screen.getByLabelText('New password'), 'password123')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'password123')
    await userEvent.click(screen.getByRole('button', { name: 'Save the new password' }))

    expect(await screen.findByText(/too easy to guess/i)).toBeInTheDocument()
    expect(authApi.resetPassword).not.toHaveBeenCalled()
  })

  it('catches two passwords that do not match', async () => {
    renderApp('/reset-password/some-reset-token-value-here')

    await screen.findByLabelText('New password')
    await userEvent.type(screen.getByLabelText('New password'), 'a-good-long-passphrase')
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'a-good-long-passphrasx')
    await userEvent.click(screen.getByRole('button', { name: 'Save the new password' }))

    expect(await screen.findByText(/do not match/i)).toBeInTheDocument()
    expect(authApi.resetPassword).not.toHaveBeenCalled()
  })
})

describe('what each role is shown', () => {
  it('omits navigation the role cannot reach', () => {
    signInAs('INVENTORY_OFFICER')
    renderApp('/')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })

    expect(within(nav).getByRole('link', { name: 'Inventory' })).toBeInTheDocument()
    // An inventory officer holds no finance or audit permission, so neither item is rendered.
    expect(within(nav).queryByRole('link', { name: 'Finance' })).not.toBeInTheDocument()
    expect(within(nav).queryByRole('link', { name: 'Audit log' })).not.toBeInTheDocument()
  })

  it('drops a navigation group entirely when nothing in it is visible', () => {
    // A DENY override can leave somebody with less than any role grants, which is the case a
    // group heading with no items under it would look broken in.
    signInAs('VIEWER', { permissions: ['dashboard:view'] })
    renderApp('/')
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })

    expect(within(nav).getByText('Overview')).toBeInTheDocument()
    for (const group of ['Cooperative', 'Operations', 'Money', 'Administration']) {
      expect(
        within(nav).queryByText(group),
        `${group} should not be rendered`,
      ).not.toBeInTheDocument()
    }
  })

  it('explains a refused screen rather than pretending it does not exist', async () => {
    signInAs('VIEWER')
    renderApp('/settings/audit')

    expect(
      await screen.findByRole('heading', { level: 1, name: 'You do not have access to this page' }),
    ).toBeInTheDocument()
    expect(screen.getByText(/audit:view/)).toBeInTheDocument()
  })

  it('shows the audit log to a role that holds the permission', async () => {
    signInAs('MANAGER')
    auditApi.fetchAuditPage.mockResolvedValue({
      items: [
        {
          id: 'a1',
          action: 'auth.login.succeeded',
          entityType: 'User',
          entityId: 'u1',
          actorLabel: 'Claudine Uwimana <uwimana.claudine@example.test>',
          messageKey: 'audit.auth.loginSucceeded',
          messageParams: { email: 'uwimana.claudine@example.test' },
          createdAt: '2026-09-10T07:15:00.000Z',
        },
      ],
      meta: { limit: 25, nextCursor: null },
    })

    renderApp('/settings/audit')

    expect(await screen.findByRole('heading', { level: 1, name: 'Audit log' })).toBeInTheDocument()
    // The server sends a key and its parameters; the interface renders the sentence.
    expect(await screen.findByText('uwimana.claudine@example.test signed in')).toBeInTheDocument()
  })

  it('renders the audit entry in Kinyarwanda from the same entry', async () => {
    await changeLanguage('rw')
    signInAs('MANAGER')
    auditApi.fetchAuditPage.mockResolvedValue({
      items: [
        {
          id: 'a1',
          action: 'auth.login.succeeded',
          entityType: 'User',
          entityId: 'u1',
          actorLabel: 'Claudine Uwimana <uwimana.claudine@example.test>',
          messageKey: 'audit.auth.loginSucceeded',
          messageParams: { email: 'uwimana.claudine@example.test' },
          createdAt: '2026-09-10T07:15:00.000Z',
        },
      ],
      meta: { limit: 25, nextCursor: null },
    })

    renderApp('/settings/audit')
    expect(await screen.findByText('uwimana.claudine@example.test yinjiye')).toBeInTheDocument()
  })
})

describe('the signed-in header', () => {
  it('names the cooperative and labels demonstration data', () => {
    signInAs('MANAGER', { isDemo: true })
    renderApp('/')
    expect(screen.getByText('Abahuzamugambi Coffee')).toBeInTheDocument()
    expect(screen.getByText('Demonstration data')).toBeInTheDocument()
  })

  it('offers the signed-in person their own name as the menu trigger', () => {
    signInAs('MANAGER')
    renderApp('/')
    expect(screen.getByRole('button', { name: /Claudine Uwimana/ })).toHaveAttribute(
      'aria-haspopup',
      'menu',
    )
  })
})

/**
 * Driving the menu itself is deliberately not attempted: it is a Radix portal, and under jsdom
 * every route into it is unusable, for the reasons set out in `languageSwitcher.test.tsx`. The
 * behaviour behind the item is tested directly instead.
 */
describe('signing out', () => {
  function SignOutProbe() {
    const { signOut } = useSignOut()
    return (
      <button type="button" onClick={() => void signOut()}>
        Sign out
      </button>
    )
  }

  function renderProbe() {
    const router = createMemoryRouter(
      [
        { path: '/', element: <SignOutProbe /> },
        { path: '/login', element: <p>Sign-in screen</p> },
      ],
      { initialEntries: ['/'] },
    )
    return render(
      <Providers>
        <RouterProvider router={router} />
      </Providers>,
    )
  }

  it('ends the session and returns to the sign-in screen', async () => {
    signInAs('MANAGER')
    authApi.logout.mockResolvedValue(undefined)
    renderProbe()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
    expect(useAuthStore.getState().accessToken).toBeNull()
    expect(await screen.findByText('Sign-in screen')).toBeInTheDocument()
  })

  it('ends the session locally even when the server cannot be reached', async () => {
    signInAs('MANAGER')
    authApi.logout.mockRejectedValue(ApiError.network())
    renderProbe()

    await userEvent.click(screen.getByRole('button', { name: 'Sign out' }))

    // Leaving somebody apparently signed in because the network dropped is the wrong way to fail.
    await waitFor(() => expect(useAuthStore.getState().status).toBe('anonymous'))
    expect(useAuthStore.getState().accessToken).toBeNull()
  })
})

describe('the remembered cooperative', () => {
  it('is ignored when the server no longer lists it', () => {
    useAuthStore.setState({ activeCooperativeId: 'a-cooperative-they-have-left' })
    useAuthStore.getState().applySession({
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
      memberships: [
        {
          cooperativeId: TEST_COOPERATIVE_ID,
          cooperativeName: 'Abahuzamugambi Coffee',
          cooperativeCode: 'ABAHUZA-HUYE',
          isDemo: false,
          roleKey: 'VIEWER',
          roleNameEn: 'Viewer',
          roleNameRw: 'Ureba gusa',
          jobTitle: null,
        },
      ],
      cooperative: null,
      roleKey: null,
      permissions: [],
    })

    expect(useAuthStore.getState().activeCooperativeId).toBe(TEST_COOPERATIVE_ID)
  })
})
