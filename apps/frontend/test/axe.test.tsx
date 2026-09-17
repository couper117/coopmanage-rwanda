import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import axe, { type AxeResults, type RunOptions } from 'axe-core'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Providers } from '../src/app/Providers'
import { routes } from '../src/app/routes'
import { signInAs, signOutForTests } from './session'

/**
 * Automated accessibility checks, run over the screens a cooperative uses most.
 *
 * axe finds the mechanical failures — a control with no name, a form field with no label, an
 * image with no alternative, a landmark used twice, a heading order that jumps — and finds them
 * the same way every time, which is what makes it a gate rather than a review. It does not find
 * what only a person can: whether the name a control has is the right one, or whether the page
 * makes sense read aloud in order. `docs/ui-system.md` §9 records how those are checked.
 *
 * Under jsdom nothing has a size or a colour, so the contrast rule is switched off here; the
 * palette's contrast is stated in `docs/ui-system.md` §2 and was measured there.
 */
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

/**
 * Answers for a cooperative with one member on the books, so the list is a table with a row in it
 * and the profile is a screen with figures — the states with the most controls, and so the most
 * for axe to look at. Longest path wins, so `/members/stats` is never read as a member.
 */
const POPULATED: Record<string, unknown> = {
  '/members/stats': { total: 1, byStatus: { ACTIVE: 1 }, newThisMonth: 0, withoutPhone: 1 },
  '/members/form-options': { incomeCategories: [] },
  [`/members/${MEMBER_ID}/summary`]: {
    member: MEMBER_DETAIL,
    shares: { quantity: 12, value: '120000.00' },
    contributions: { count: 3, total: '45000.00' },
    payments: { total: '0.00' },
    unavailable: [],
    withheld: [],
  },
  [`/members/${MEMBER_ID}/timeline`]: [],
  [`/members/${MEMBER_ID}/shares`]: { items: [], holding: { quantity: 12, value: '120000.00' } },
  [`/members/${MEMBER_ID}/contributions`]: { items: [], total: 0, totalAmount: '0.00' },
}

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

const AXE_OPTIONS: RunOptions = {
  rules: { 'color-contrast': { enabled: false } },
  // Only the WCAG 2 A and AA rules, plus axe's best-practice checks for landmarks and headings.
  runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'] },
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * The network, answered from a table. The dashboard and the member screens are answered with
 * data; everything else is refused, so a screen that fetches on mount shows its error state —
 * which is a state too, and one axe should see.
 */
function stubApi(table: Record<string, unknown>) {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: string) => {
      const url = String(input)
      const match = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((path) => url.includes(path))
      if (match === undefined) {
        return Promise.resolve(
          json(
            { error: { code: 'NOT_FOUND', messageKey: 'errors.notFound', message: 'no stub' } },
            404,
          ),
        )
      }
      const value = table[match]
      const paged = value !== null && typeof value === 'object' && 'meta' in value
      return Promise.resolve(json(paged ? value : { data: value }))
    }),
  )
}

beforeEach(() => {
  stubApi({ '/dashboard': EMPTY_BOARD })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function renderApp(path: string) {
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  return render(
    <Providers>
      <RouterProvider router={router} />
    </Providers>,
  )
}

/** One line per violation, with the first offending node, so a failure reads without a debugger. */
function describeViolations(results: AxeResults): string[] {
  return results.violations.map(
    (violation) =>
      `${violation.id} (${violation.impact ?? 'unknown'}): ${violation.help} — ${
        violation.nodes[0]?.html ?? ''
      }`,
  )
}

async function expectNoViolations(
  path: string,
  settled: (container: HTMLElement) => void = () => undefined,
): Promise<void> {
  const { container, unmount } = renderApp(path)
  // Every screen is fetched on demand and settles once its heading is on the page — the success,
  // empty or error state alike, each of which axe then sees.
  await waitFor(() => {
    expect(container.querySelectorAll('h1'), `on ${path}`).toHaveLength(1)
  })
  // Every query has answered once the last shape-matched placeholder has gone; what stands in its
  // place is the state axe should see, whichever it is.
  await waitFor(() => {
    expect(container.querySelector('.animate-pulse'), `settled ${path}`).toBeNull()
    settled(container)
  })
  const results = await axe.run(container, AXE_OPTIONS)
  expect(describeViolations(results), `on ${path}`).toEqual([])
  unmount()
}

describe('the gate itself', () => {
  it('reports a control that has no name, so a pass below means something', async () => {
    const { container } = render(
      <main>
        <h1>Check</h1>
        <button type="button">
          <svg aria-hidden="true" />
        </button>
      </main>,
    )
    const results = await axe.run(container, AXE_OPTIONS)
    expect(results.violations.map((violation) => violation.id)).toContain('button-name')
  })
})

describe('axe finds no violations', () => {
  it('on the sign-in screen', async () => {
    signOutForTests()
    await expectNoViolations('/login')
  })

  it('on the password-reset request', async () => {
    signOutForTests()
    await expectNoViolations('/forgot-password')
  })

  describe('signed in as a manager', () => {
    beforeEach(() => {
      signInAs('MANAGER')
    })

    for (const path of [
      '/',
      '/members',
      '/contributions',
      '/finance',
      '/finance/transactions',
      '/inventory',
      '/sales',
      '/sales/new',
      '/buyers',
      '/meetings',
      '/documents',
      '/announcements',
      '/reports',
      '/assistant',
      '/notifications',
      '/profile',
      '/settings/preferences',
      '/settings/staff',
      '/settings/audit',
      '/no-such-page',
    ]) {
      it(`on ${path}`, async () => {
        await expectNoViolations(path)
      })
    }

    it('on a members list with a row in it', async () => {
      stubApi({
        ...POPULATED,
        '/members': {
          data: [MEMBER_ROW],
          meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        },
      })
      // Asserted so the check is of the table, not of an error state that arrived instead.
      await expectNoViolations('/members', (container) => {
        expect(container.querySelector('table')).toHaveTextContent('Chantal Mukamana')
      })
    })

    it('on the member registration form, open', async () => {
      stubApi({
        ...POPULATED,
        '/members': {
          data: [MEMBER_ROW],
          meta: { page: 1, pageSize: 25, total: 1, totalPages: 1 },
        },
      })
      const user = userEvent.setup()
      renderApp('/members')
      const addMember = await waitFor(() => screen.getByRole('button', { name: 'Add member' }))
      await user.click(addMember)
      const dialog = await waitFor(() => {
        const found = document.querySelector('[role="dialog"]')
        expect(found).not.toBeNull()
        return found as HTMLElement
      })
      // The dialog lives in a portal, so it is checked where it is rather than in the container.
      const results = await axe.run(dialog, AXE_OPTIONS)
      expect(describeViolations(results)).toEqual([])
    })

    it('on the list of keyboard shortcuts', async () => {
      const user = userEvent.setup()
      const { container } = renderApp('/')
      await waitFor(() => expect(container.querySelector('.animate-pulse')).toBeNull())
      await user.keyboard('?')
      const dialog = await waitFor(() => {
        const found = document.querySelector('[role="dialog"]')
        expect(found).not.toBeNull()
        return found as HTMLElement
      })
      const results = await axe.run(dialog, AXE_OPTIONS)
      expect(describeViolations(results)).toEqual([])
    })

    it('on a member profile with figures on it', async () => {
      stubApi(POPULATED)
      await expectNoViolations(`/members/${MEMBER_ID}`, (container) => {
        expect(container.querySelector('h1')).toHaveTextContent('Chantal Mukamana')
      })
    })
  })
})
