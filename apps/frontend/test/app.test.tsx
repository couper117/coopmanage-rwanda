import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it } from 'vitest'
import { Providers } from '../src/app/Providers'
import { routes } from '../src/app/routes'
import { changeLanguage } from '../src/i18n'

function renderApp(path = '/') {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

afterEach(async () => {
  await changeLanguage('en')
})

/**
 * The Phase 1 exit criterion: the shell renders, navigates, and reads correctly in both languages.
 */
describe('application shell', () => {
  it('renders the dashboard with a single page heading', () => {
    renderApp()
    expect(screen.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
  })

  it('shows the empty state a brand new cooperative should see', () => {
    renderApp()
    expect(screen.getByText(/figures will appear here/i)).toBeInTheDocument()
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
    renderApp('/members')
    expect(screen.getByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument()
    expect(screen.getByText('Members is not available yet')).toBeInTheDocument()
    expect(screen.getByText(/arrives in phase 4/i)).toBeInTheDocument()
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

    expect(screen.getByRole('heading', { level: 1, name: 'Incamake' })).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: "Ibyerekezo by'ingenzi" })
    expect(within(nav).getByRole('link', { name: 'Abanyamuryango' })).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Ububiko' })).toBeInTheDocument()
    expect(within(nav).getByText('Imari')).toBeInTheDocument()
    expect(within(nav).getByRole('link', { name: 'Amafaranga' })).toBeInTheDocument()
  })

  it('translates the pending module page too', async () => {
    await changeLanguage('rw')
    renderApp('/sales')
    expect(screen.getByRole('heading', { level: 1, name: 'Amagurisha' })).toBeInTheDocument()
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
