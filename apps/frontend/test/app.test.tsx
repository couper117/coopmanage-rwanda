import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../src/app/Providers'
import { routes } from '../src/app/routes'
import { signInAs } from './session'
import { changeLanguage } from '../src/i18n'

/**
 * The dashboard is the index route, and since Phase 10 it is a screen with figures on it rather
 * than a placeholder. These tests are about the shell — its heading, its navigation, its
 * languages — so the dashboard is answered with a cooperative that has nothing recorded yet: the
 * smallest true response, and the one whose empty state the shell tests already assert.
 */
const EMPTY_BOARD = {
  cooperative: { name: 'Abahuzamugambi Coffee', code: 'ABAHUZA-HUYE' },
  month: '2026-09',
  tiles: [],
  charts: [],
  lowStock: [],
  attention: [],
  activity: [],
  health: { rating: 'GOOD', signals: [] },
  withheld: [],
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) =>
      Promise.resolve(
        String(input).includes('/dashboard')
          ? new Response(JSON.stringify({ data: EMPTY_BOARD }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          : new Response(
              JSON.stringify({
                error: { code: 'NOT_FOUND', messageKey: 'errors.notFound', message: 'no stub' },
              }),
              { status: 404, headers: { 'Content-Type': 'application/json' } },
            ),
      ),
    ),
  )
})

function renderApp(path = '/') {
  // These screens live behind the session guard, so a test that wants to see one signs in first.
  signInAs('MANAGER')
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

afterEach(async () => {
  vi.unstubAllGlobals()
  await changeLanguage('en')
})

/**
 * The Phase 1 exit criterion: the shell renders, navigates, and reads correctly in both languages.
 */
describe('application shell', () => {
  it('renders the dashboard with a single page heading', async () => {
    renderApp()
    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument(),
    )
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows the empty state a brand new cooperative should see', async () => {
    renderApp()
    await waitFor(() => expect(screen.getByText(/figures will appear here/i)).toBeInTheDocument())
  })

  it('offers a skip link before the navigation for keyboard users', async () => {
    renderApp()
    await userEvent.tab()
    expect(document.activeElement).toHaveTextContent('Skip to main content')
  })

  it('renders the navigation grouped as the design system specifies', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    for (const group of ['Overview', 'Cooperative', 'Operations', 'Money', 'Administration']) {
      expect(within(nav).getByText(group)).toBeInTheDocument()
    }
    expect(within(nav).getByRole('link', { name: 'Members' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Finance' })).toBeInTheDocument()
  })

  it('marks the current page for assistive technology', () => {
    renderApp()
    const nav = screen.getByRole('navigation', { name: 'Main navigation' })
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })

  it('tells the truth about a module that is not built yet', () => {
    // A module reached before its phase says so and names the phase, rather than showing an
    // empty screen that reads as a fault. Once a module is built its placeholder disappears on
    // its own, because the pending route set is derived from the real routes — so this names a
    // module still ahead, and moves on when that phase lands. It was Announcements until Phase 12
    // built them.
    renderApp('/assistant')
    expect(screen.getByRole('heading', { level: 1, name: 'Ask CoopManage' })).toBeInTheDocument()
    expect(screen.getByText('Ask CoopManage is not available yet')).toBeInTheDocument()
    expect(screen.getByText(/arrives in phase 14/i)).toBeInTheDocument()
  })

  it('shows a real not-found page for an unknown route', () => {
    renderApp('/no-such-page')
    expect(screen.getByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('language switching', () => {
  it('translates the whole shell into Kinyarwanda', async () => {
    await changeLanguage('rw')
    renderApp()

    await waitFor(() =>
      expect(screen.getByRole('heading', { level: 1, name: 'Incamake' })).toBeInTheDocument(),
    )
    const nav = screen.getByRole('navigation', { name: "Ibyerekezo by'ingenzi" })
    expect(within(nav).getByRole('link', { name: 'Abanyamuryango' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Ububiko' })).toBeInTheDocument()
    expect(within(nav).getByText('Imari')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Amafaranga' })).toBeInTheDocument()
  })

  it('translates the pending module page too', async () => {
    await changeLanguage('rw')
    // The same module the English test uses, and for the same reason: a module still ahead, so
    // this does not have to move every time a phase lands.
    renderApp('/assistant')
    expect(screen.getByRole('heading', { level: 1, name: 'Baza CoopManage' })).toBeInTheDocument()
    expect(screen.getByText(/ntiraboneka/i)).toBeInTheDocument()
  })

  it('sets the document language so screen readers use the right voice', async () => {
    await changeLanguage('rw')
    expect(document.documentElement.lang).toBe('rw')
    await changeLanguage('en')
    expect(document.documentElement.lang).toBe('en')
  })

  it('leaves no English string in the Kinyarwanda shell', async () => {
    await changeLanguage('rw')
    renderApp()
    const nav = screen.getByRole('navigation', { name: "Ibyerekezo by'ingenzi" })
    for (const english of ['Members', 'Finance', 'Reports', 'Settings', 'Overview']) {
      expect(within(nav).queryByText(english)).not.toBeInTheDocument()
    }
  })
})
