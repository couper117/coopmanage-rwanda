import { act, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { describe, expect, it } from 'vitest'
import { Providers } from '../src/app/Providers'
import { routes } from '../src/app/routes'
import { signInAs } from './session'
import { EmptyState, FormField, Input } from '../src/components/ui'
import { useUiStore } from '../src/stores/uiStore'
import { setViewportWidth } from './setup'

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

describe('heading structure', () => {
  it('never skips a level on a page with a header and an empty state', () => {
    renderApp()
    const levels = [...document.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((node) =>
      Number(node.tagName.slice(1)),
    )
    expect(levels[0]).toBe(1)
    for (let i = 1; i < levels.length; i += 1) {
      expect((levels[i] as number) - (levels[i - 1] as number)).toBeLessThanOrEqual(1)
    }
  })

  it('gives every route exactly one h1', () => {
    for (const path of ['/', '/members', '/no-such-page']) {
      const { unmount } = renderApp(path)
      expect(document.querySelectorAll('h1'), `on ${path}`).toHaveLength(1)
      unmount()
    }
  })

  it('lets an empty state carry the page heading when it is the whole page', () => {
    render(<EmptyState headingLevel={1} title="Page not found" description="It has moved." />)
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
  })
})

describe('form field errors', () => {
  it('announces the error rather than only linking it', () => {
    render(
      <FormField label="Amount" error="validation.positiveAmount">
        <Input />
      </FormField>,
    )
    const alert = screen.getByRole('alert')
    expect(alert).toHaveTextContent('Enter an amount greater than zero.')
    expect(screen.getByLabelText('Amount')).toHaveAttribute(
      'aria-describedby',
      alert.getAttribute('id'),
    )
  })
})

describe('mobile navigation drawer', () => {
  it('is a modal dialog with an accessible name when open', () => {
    renderApp()
    // Opened after mount: the shell closes the drawer whenever the route changes, and that effect
    // runs on the first render too.
    act(() => {
      useUiStore.setState({ mobileNavOpen: true })
    })

    // Queried by selector rather than by role: role queries against a Radix portal are
    // pathologically slow under jsdom. The attributes asserted are the ones that matter.
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()

    // It has an accessible name, so a screen reader announces what the dialog is.
    const labelId = dialog?.getAttribute('aria-labelledby') as string
    expect(labelId).toBeTruthy()
    expect(document.getElementById(labelId)).toHaveTextContent('Main navigation')

    // It is focusable as a unit, which is how focus is moved into it on open.
    expect(dialog).toHaveAttribute('tabindex', '-1')

    // And the application behind it is removed from the accessibility tree, so a screen-reader
    // user cannot wander into content they cannot see or click. Radix does this with aria-hidden
    // on the siblings rather than aria-modal on the dialog, which is the more reliable of the two.
    const dialogRoot = dialog?.closest('body > *')
    const siblings = [...document.body.children].filter((child) => child !== dialogRoot)
    expect(siblings.length).toBeGreaterThan(0)
    for (const sibling of siblings) {
      expect(sibling.getAttribute('aria-hidden'), sibling.tagName).toBe('true')
    }

    act(() => {
      useUiStore.setState({ mobileNavOpen: false })
    })
  })

  it('renders no dialog while closed', () => {
    useUiStore.setState({ mobileNavOpen: false })
    renderApp()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
})

describe('collapsed sidebar', () => {
  it('labels icon-only navigation links', () => {
    useUiStore.setState({ sidebarCollapsed: true })
    renderApp()

    const links = [...document.querySelectorAll('nav a')]
    expect(links.length).toBeGreaterThan(0)
    for (const link of links) {
      // With the label text hidden, an aria-label is the only real accessible name; `title`
      // alone is a last-resort fallback and invisible to touch users.
      expect(link.getAttribute('aria-label'), link.outerHTML.slice(0, 80)).toBeTruthy()
    }

    useUiStore.setState({ sidebarCollapsed: false })
  })

  it('relies on visible text when expanded', () => {
    useUiStore.setState({ sidebarCollapsed: false })
    renderApp()
    const dashboard = [...document.querySelectorAll('nav a')].find(
      (link) => link.textContent === 'Dashboard',
    )
    expect(dashboard).toBeDefined()
    expect(dashboard?.getAttribute('aria-label')).toBeNull()
  })
})

describe('responsive layouts', () => {
  /**
   * The three layouts specified in docs/ui-system.md section 5. The tablet rail had gone missing
   * entirely, so these assertions exist to keep each breakpoint honest.
   */
  function sidebarState() {
    const aside = document.querySelector('aside')
    const railWidth = aside?.className.includes('w-sidebar-rail') ?? false
    const labelVisible = [...document.querySelectorAll('nav a')].some(
      (link) => link.textContent === 'Dashboard',
    )
    return { hasAside: aside !== null, railWidth, labelVisible }
  }

  it('shows the full sidebar with labels at 1440px', () => {
    setViewportWidth(1440)
    renderApp()
    const state = sidebarState()
    expect(state.hasAside).toBe(true)
    expect(state.railWidth).toBe(false)
    expect(state.labelVisible).toBe(true)
  })

  it('collapses to an icon rail at 900px', () => {
    setViewportWidth(900)
    renderApp()
    const state = sidebarState()
    expect(state.hasAside).toBe(true)
    expect(state.railWidth).toBe(true)
    expect(state.labelVisible).toBe(false)
  })

  it('hides the collapse toggle where the rail is forced', () => {
    setViewportWidth(900)
    renderApp()
    expect(screen.queryByLabelText('Close menu')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Open menu')).toBeInTheDocument() // the drawer trigger only
  })

  it('offers the drawer trigger at every width, and the rail keeps names', () => {
    setViewportWidth(900)
    renderApp()
    for (const link of document.querySelectorAll('nav a')) {
      expect(link.getAttribute('aria-label')).toBeTruthy()
    }
  })
})
