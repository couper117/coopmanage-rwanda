import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Membership } from '@coopmanage/shared'
import { routes } from '../src/app/routes'
import { CooperativeSwitcher } from '../src/components/CooperativeSwitcher'
import { TooltipProvider } from '../src/components/ui'
import { changeLanguage } from '../src/i18n'
import { useAuthStore } from '../src/stores/authStore'
import { resetSession, signInAs, TEST_COOPERATIVE_ID } from './session'

/**
 * The Phase 3 screens, mounted for real against a stubbed network.
 *
 * Routes, the permission guard, the module-filtered navigation and the forms all run; only `fetch`
 * is faked. Queries are asserted by text and selector rather than by `byRole` with a name, which
 * jsdom computes so slowly against a portal that the suite times out.
 */

const PROFILE = {
  id: TEST_COOPERATIVE_ID,
  code: 'ABAHUZA-HUYE',
  name: 'Abahuzamugambi Coffee',
  type: { key: 'COFFEE', nameEn: 'Coffee', nameRw: 'Ikawa' },
  registrationNumber: 'RCA/2019/0412',
  tinNumber: null,
  province: 'SOUTHERN',
  district: 'Huye',
  sector: 'Ngoma',
  cell: 'Butare',
  village: 'Rango',
  addressLine: null,
  phone: '+250788123456',
  email: null,
  logoUrl: null,
  foundedOn: '2019-04-01',
  status: 'ACTIVE',
  isDemo: false,
  currency: 'RWF',
  timezone: 'Africa/Kigali',
  defaultLocale: 'RW' as const,
  memberCodePrefix: 'ABAH',
  fiscalYearStartMonth: 1,
  createdAt: '2026-01-01T00:00:00.000Z',
}

const ALL_MODULES = [
  'contributions',
  'inventory',
  'products',
  'sales',
  'buyers',
  'meetings',
  'documents',
  'announcements',
  'assistant',
]

const ROLES = [
  {
    key: 'MANAGER',
    nameEn: 'Manager',
    nameRw: 'Umuyobozi',
    descriptionEn: 'Full access',
    descriptionRw: 'Ashobora byose',
    permissions: [],
  },
  {
    key: 'SECRETARY',
    nameEn: 'Secretary',
    nameRw: 'Umunyamabanga',
    descriptionEn: 'Members and meetings',
    descriptionRw: 'Abanyamuryango n’inama',
    permissions: [],
  },
]

function staffRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'staff-1',
    user: {
      id: 'user-2',
      email: 'habimana.eric@example.test',
      fullName: 'Eric Habimana',
      status: 'ACTIVE',
      lastLoginAt: null,
    },
    roleKey: 'SECRETARY',
    roleName: { en: 'Secretary', rw: 'Umunyamabanga' },
    jobTitle: 'Umunyamabanga',
    status: 'ACTIVE',
    invitedAt: '2026-02-01T00:00:00.000Z',
    joinedAt: '2026-02-02T00:00:00.000Z',
    deactivatedAt: null,
    isSelf: false,
    overrideCount: 0,
    ...overrides,
  }
}

/** Routes each stubbed endpoint by path, so a screen's several parallel queries all resolve. */
function stubApi(handlers: Record<string, unknown>, options: { settings?: string[] } = {}) {
  const settings = { enabledModules: options.settings ?? ALL_MODULES }
  const table: Record<string, unknown> = {
    '/settings': settings,
    '/cooperatives/current': PROFILE,
    '/cooperatives/mine': [],
    '/roles': ROLES,
    '/permissions': [],
    ...handlers,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
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
      const data = typeof value === 'function' ? (value as (m: string) => unknown)(method) : value
      return Promise.resolve(
        new Response(JSON.stringify({ data }), {
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
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

/** The switcher on its own, for the cases that do not need the routing around it. */
function renderSwitcher() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <CooperativeSwitcher />
      </TooltipProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  signInAs('MANAGER')
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  await changeLanguage('en')
})

describe('cooperative switcher', () => {
  it('shows the cooperative name as plain text when there is only one', () => {
    stubApi({})
    renderSwitcher()

    expect(screen.getByText('Abahuzamugambi Coffee')).toBeInTheDocument()
    // One cooperative is the common case and must not look like a menu that does nothing.
    expect(
      document.querySelector('[aria-haspopup="menu"][aria-label="Switch cooperative"]'),
    ).toBeNull()
  })

  it('becomes a menu when the user serves more than one cooperative', () => {
    const second: Membership = {
      cooperativeId: '8a7b6c5d-4e3f-4a2b-9c8d-7e6f5a4b3c2d',
      cooperativeName: 'Twizerane Dairy',
      cooperativeCode: 'TWIZ-MUSANZE',
      isDemo: false,
      roleKey: 'ACCOUNTANT',
      roleNameEn: 'Accountant',
      roleNameRw: 'Umubaruramari',
      jobTitle: null,
    }
    useAuthStore.setState((state) => ({ memberships: [...state.memberships, second] }))
    stubApi({})

    // The switcher alone, not the whole shell. An open Radix menu inside the full application
    // tree survives the unmount well enough to slow every query in the test that follows, and
    // what is under test here is the switcher rather than the routing around it.
    const { unmount } = renderSwitcher()

    const trigger = screen.getByLabelText('Switch cooperative')
    fireEvent.pointerDown(trigger, { button: 0, pointerType: 'mouse' })

    const items = [...document.querySelectorAll('[role="menuitem"]')].map(
      (item) => item.textContent,
    )
    expect(items.some((text) => text?.includes('Twizerane Dairy'))).toBe(true)
    expect(items.some((text) => text?.includes('Abahuzamugambi Coffee'))).toBe(true)
    // The active cooperative is marked, so the menu says where you already are.
    expect(document.querySelectorAll('[role="menuitem"] svg')).toHaveLength(1)

    unmount()
  })

  it('labels a demonstration cooperative wherever its name appears', () => {
    resetSession()
    signInAs('MANAGER', { isDemo: true })
    stubApi({})
    renderSwitcher()

    expect(screen.getByText('Abahuzamugambi Coffee')).toBeInTheDocument()
    expect(screen.getByText('Demonstration data')).toBeInTheDocument()
  })
})

describe('cooperative profile screen', () => {
  it('shows the registered identity as facts, not as editable fields', async () => {
    stubApi({})
    renderAt('/settings/cooperative')

    await waitFor(() => {
      expect(screen.getByText('ABAHUZA-HUYE')).toBeInTheDocument()
    })
    expect(screen.getByText('RWF')).toBeInTheDocument()
    // The code has no input, because the platform owns it.
    expect(screen.queryByLabelText('Cooperative code')).toBeNull()
  })

  it('fills the form from the stored record', async () => {
    stubApi({})
    renderAt('/settings/cooperative')

    await waitFor(() => {
      expect(screen.getByLabelText('Cooperative name')).toHaveValue('Abahuzamugambi Coffee')
    })
    expect(screen.getByLabelText('District')).toHaveValue('Huye')
    expect(screen.getByLabelText(/Office phone/)).toHaveValue('+250788123456')
  })

  it('marks the optional fields as optional', async () => {
    stubApi({})
    renderAt('/settings/cooperative')
    await waitFor(() => {
      expect(screen.getByLabelText(/RCA registration number/)).toBeInTheDocument()
    })
    // "(optional)" is part of the accessible label, which is how a screen reader hears it.
    expect(screen.getByLabelText(/RCA registration number.*optional/)).toBeInTheDocument()
    expect(screen.getByLabelText(/Office phone.*optional/)).toBeInTheDocument()
  })

  it('refuses a phone number that is not Rwandan, before submitting', async () => {
    stubApi({})
    renderAt('/settings/cooperative')

    const phone = await waitFor(() => screen.getByLabelText(/Office phone/))
    fireEvent.change(phone, { target: { value: '12345' } })
    fireEvent.submit(phone.closest('form') as HTMLFormElement)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a valid phone number.')
    })
  })

  it('tells a viewer they may read but not change', async () => {
    resetSession()
    signInAs('VIEWER')
    stubApi({})
    renderAt('/settings/cooperative')

    await waitFor(() => {
      expect(screen.getByText(/see these details but not change them/)).toBeInTheDocument()
    })
    expect(screen.getByLabelText('Cooperative name')).toBeDisabled()
    expect(screen.queryByText('Save changes')).toBeNull()
  })
})

describe('preferences screen', () => {
  it('lists every optional module with a switch', async () => {
    stubApi({})
    renderAt('/settings/preferences')

    await waitFor(() => {
      expect(screen.getByText('Modules')).toBeInTheDocument()
    })
    const switches = document.querySelectorAll('input[role="switch"]')
    expect(switches).toHaveLength(ALL_MODULES.length)
    for (const input of switches) expect((input as HTMLInputElement).checked).toBe(true)
  })

  it('names the modules that cannot be switched off', async () => {
    stubApi({})
    renderAt('/settings/preferences')
    await waitFor(() => {
      expect(screen.getByText('Always available')).toBeInTheDocument()
    })
    const alwaysOn = screen.getByText('Always available').closest('section') as HTMLElement
    expect(within(alwaysOn).getByText('Members')).toBeInTheDocument()
    expect(within(alwaysOn).getByText('Finance')).toBeInTheDocument()
  })

  it('shows a module as off when the cooperative has switched it off', async () => {
    stubApi({}, { settings: ['sales'] })
    renderAt('/settings/preferences')

    await waitFor(() => {
      expect(screen.getByText('Modules')).toBeInTheDocument()
    })
    const on = [...document.querySelectorAll('input[role="switch"]')].filter(
      (input) => (input as HTMLInputElement).checked,
    )
    expect(on).toHaveLength(1)
  })

  it('tells a secretary they may read but not change', async () => {
    resetSession()
    signInAs('SECRETARY')
    stubApi({})
    renderAt('/settings/preferences')

    await waitFor(() => {
      expect(screen.getByText(/see these preferences but not change them/)).toBeInTheDocument()
    })
    for (const input of document.querySelectorAll('input[role="switch"]')) {
      expect(input).toBeDisabled()
    }
  })
})

describe('module-aware navigation', () => {
  it('hides a module the cooperative has switched off', async () => {
    stubApi({}, { settings: ALL_MODULES.filter((module) => module !== 'inventory') })
    renderAt('/profile')

    const nav = await waitFor(() => screen.getByRole('navigation', { name: 'Main navigation' }))
    await waitFor(() => {
      expect(within(nav).queryByText('Inventory')).toBeNull()
    })
    // Sales is still on, so this is not hiding everything.
    expect(within(nav).getByText('Sales')).toBeInTheDocument()
  })

  it('never hides a module the product cannot work without', async () => {
    stubApi({}, { settings: [] })
    renderAt('/profile')

    const nav = await waitFor(() => screen.getByRole('navigation', { name: 'Main navigation' }))
    await waitFor(() => {
      expect(within(nav).queryByText('Sales')).toBeNull()
    })
    expect(within(nav).getByText('Members')).toBeInTheDocument()
    expect(within(nav).getByText('Finance')).toBeInTheDocument()
    expect(within(nav).getByText('Reports')).toBeInTheDocument()
  })

  it('still hides a module the caller has no permission for, even when it is switched on', async () => {
    resetSession()
    signInAs('INVENTORY_OFFICER')
    stubApi({})
    renderAt('/profile')

    const nav = await waitFor(() => screen.getByRole('navigation', { name: 'Main navigation' }))
    expect(within(nav).getByText('Inventory')).toBeInTheDocument()
    // An inventory officer holds no finance permission, so the module being on changes nothing.
    expect(within(nav).queryByText('Finance')).toBeNull()
  })
})

describe('staff screen', () => {
  it('lists the roster with roles and status', async () => {
    stubApi({ '/staff': [staffRow()] })
    renderAt('/settings/staff')

    await waitFor(() => {
      expect(screen.getByText('Eric Habimana')).toBeInTheDocument()
    })
    expect(screen.getByText('habimana.eric@example.test')).toBeInTheDocument()

    // Scoped to the table: "Active" is also an option in the status filter above it.
    const table = document.querySelector('table') as HTMLElement
    expect(within(table).getByText('Active')).toBeInTheDocument()
    expect(within(table).getByText('Secretary')).toBeInTheDocument()
  })

  it('offers no controls on the caller’s own row, and says why', async () => {
    stubApi({ '/staff': [staffRow({ id: 'staff-self', isSelf: true })] })
    renderAt('/settings/staff')

    await waitFor(() => {
      expect(screen.getByText('(you)')).toBeInTheDocument()
    })
    // The role select is replaced by plain text, because nobody changes their own role.
    expect(document.querySelector('#role-staff-self')).toBeNull()

    // `aria-disabled` rather than `disabled`: a truly disabled button takes no pointer events, so
    // its tooltip never opens and it leaves the tab order, which would hide the explanation from
    // exactly the people who most need it.
    const deactivate = screen.getByLabelText('Deactivate')
    expect(deactivate).toHaveAttribute('aria-disabled', 'true')
    expect(deactivate).not.toBeDisabled()
  })

  it('does nothing when a blocked action is clicked', async () => {
    stubApi({ '/staff': [staffRow({ id: 'staff-self', isSelf: true })] })
    renderAt('/settings/staff')

    const deactivate = await waitFor(() => screen.getByLabelText('Deactivate'))
    fireEvent.click(deactivate)

    // No confirmation opens, because the action is not available to them.
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })

  it('shows the empty state with an invitation when nobody else is here', async () => {
    stubApi({ '/staff': [] })
    renderAt('/settings/staff')

    await waitFor(() => {
      expect(screen.getByText('You are the only person here')).toBeInTheDocument()
    })
    // The action is offered twice on purpose: in the page header and in the empty state.
    expect(screen.getAllByText('Invite staff')).toHaveLength(2)
  })

  it('distinguishes no results from no staff at all', async () => {
    stubApi({ '/staff': [] })
    renderAt('/settings/staff')

    await waitFor(() => {
      expect(screen.getByText('You are the only person here')).toBeInTheDocument()
    })

    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'INACTIVE' } })

    await waitFor(() => {
      expect(screen.getByText('Nobody matches these filters')).toBeInTheDocument()
    })
    // Once in the filter toolbar, once as the empty state's own way out.
    expect(screen.getAllByText('Clear filters')).toHaveLength(2)
  })

  it('opens the invitation dialog with a role picker', async () => {
    stubApi({ '/staff': [] })
    renderAt('/settings/staff')

    const invite = await waitFor(() => screen.getAllByText('Invite staff')[0] as HTMLElement)
    fireEvent.click(invite)

    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    })
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement
    expect(within(dialog).getByLabelText('Name')).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Email address/)).toBeInTheDocument()
    expect(within(dialog).getByText('Choose a role')).toBeInTheDocument()
  })

  it('hides the invite action from someone who cannot invite', async () => {
    resetSession()
    signInAs('SECRETARY', { permissions: ['staff:view', 'dashboard:view', 'cooperative:view'] })
    stubApi({ '/staff': [staffRow()] })
    renderAt('/settings/staff')

    await waitFor(() => {
      expect(screen.getByText('Eric Habimana')).toBeInTheDocument()
    })
    expect(screen.queryByText('Invite staff')).toBeNull()
    // And the row controls explain that they are a manager's to use.
    expect(screen.getByLabelText('Deactivate')).toHaveAttribute('aria-disabled', 'true')
  })

  it('asks for confirmation before deactivating, naming the person and the consequence', async () => {
    stubApi({ '/staff': [staffRow()] })
    renderAt('/settings/staff')

    const button = await waitFor(() => screen.getByLabelText('Deactivate'))
    fireEvent.click(button)

    await waitFor(() => {
      expect(screen.getByText('Deactivate Eric Habimana?')).toBeInTheDocument()
    })
    expect(screen.getByText(/Their history stays/)).toBeInTheDocument()
  })

  it('renders the whole screen in Kinyarwanda', async () => {
    await changeLanguage('rw')
    stubApi({ '/staff': [staffRow()] })
    renderAt('/settings/staff')

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: 'Abakozi' })).toBeInTheDocument()
    })
    expect(screen.getByText('Arakora')).toBeInTheDocument()
    expect(screen.getAllByText('Tumira umukozi').length).toBeGreaterThan(0)
    // No English left behind on the screen.
    expect(screen.queryByText('Invite staff')).toBeNull()
    expect(screen.queryByText('Active')).toBeNull()
  })
})
