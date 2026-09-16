import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { assistantRoutes } from '../src/features/assistant/assistantRoutes'
import type { AssistantAnswer, AssistantCatalogue } from '../src/features/assistant/assistant.api'
import { changeLanguage } from '../src/i18n'
import { resetSession, signInAs } from './session'

/**
 * Phase 14 on the screen.
 *
 * The thing worth testing is that **the page renders a sentence from a key and figures from rows**.
 * The server sends no prose: an answer is `answerKey`, `answerParams`, `figures` and an `href`. So
 * this file checks that the sentence comes out in both languages, that the figures are formatted
 * the way money and counts are formatted everywhere else, that a refusal reads as a refusal rather
 * than as a failure, and that the screen is honest about a planner that matches words.
 */

interface StubRequest {
  url: string
  method: string
  body: unknown
}

let calls: StubRequest[] = []

const CATALOGUE: AssistantCatalogue = {
  planner: 'rules',
  understandsLanguage: false,
  tools: [
    { key: 'countMembers', summaryKey: 'tools.countMembers' },
    { key: 'financeBalance', summaryKey: 'tools.financeBalance' },
  ],
}

const MEMBERS_ANSWER: AssistantAnswer = {
  conversationId: 'thread-1',
  messageId: 'msg-1',
  answerKey: 'answer.countMembers',
  answerParams: { total: 120, active: 109 },
  figures: [
    { labelKey: 'figure.members.total', value: '120', type: 'number' },
    { labelKey: 'figure.members.active', value: '109', type: 'number' },
  ],
  href: '/members',
  tool: 'countMembers',
}

const BALANCE_ANSWER: AssistantAnswer = {
  conversationId: 'thread-1',
  messageId: 'msg-2',
  answerKey: 'answer.financeBalance',
  answerParams: { balance: '9108000.00' },
  figures: [{ labelKey: 'figure.finance.balance', value: '9108000.00', type: 'money' }],
  href: '/finance',
  tool: 'financeBalance',
}

const REFUSAL: AssistantAnswer = {
  conversationId: 'thread-1',
  messageId: 'msg-3',
  answerKey: 'refusal.noToolFits',
  answerParams: {},
  figures: [],
  href: null,
  tool: null,
}

interface Paged {
  __paged: true
  items: unknown[]
  meta: Record<string, unknown>
}

function paged(items: unknown[]): Paged {
  return {
    __paged: true,
    items,
    meta: { page: 1, pageSize: 20, total: items.length, totalPages: 1 },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

function stubFetch(handlers: Record<string, unknown> = {}): void {
  const table: Record<string, unknown> = {
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/settings': { enabledModules: ['assistant'] },
    '/assistant/catalogue': CATALOGUE,
    '/assistant/threads': paged([]),
    '/assistant/ask': MEMBERS_ANSWER,
    ...handlers,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined
      calls.push({ url, method, body })

      const match = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((path) => url.includes(path))

      if (!match) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              error: { code: 'NOT_FOUND', messageKey: 'errors.notFound', message: 'no stub' },
            }),
            { status: 404, headers: { 'Content-Type': 'application/json' } },
          ),
        )
      }

      const value = table[match]
      const result =
        typeof value === 'function'
          ? (value as (request: StubRequest) => unknown)({ url, method, body })
          : value
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

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const routes: RouteObject[] = [
    ...assistantRoutes,
    { path: 'members', element: <p>member register</p> },
    { path: '*', element: <p>elsewhere</p> },
  ]
  const router = createMemoryRouter(routes, { initialEntries: ['/assistant'] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

/** The label and the button are in the reader's language, so the caller says which. */
async function askOnScreen(question: string, labels = { field: 'Your question', ask: 'Ask' }) {
  const box = await screen.findByLabelText(labels.field)
  fireEvent.change(box, { target: { value: question } })
  fireEvent.click(screen.getByRole('button', { name: labels.ask }))
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

describe('the screen before a question', () => {
  it('says the assistant matches words rather than understanding language', async () => {
    renderPage()
    // Said before the first question. A reader who knows this asks plainly; one who does not
    // phrases a question three ways and concludes the product is broken.
    await waitFor(() => expect(screen.getByText('Ask plainly')).toBeInTheDocument())
  })

  it('lists what this reader can ask, from their own catalogue', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('How many members do we have?')).toBeInTheDocument(),
    )
    expect(screen.getByText('What is our balance?')).toBeInTheDocument()
    // The summary under each, so the list explains itself rather than being a row of guesses.
    expect(
      screen.getByText('How many members are on the register, and how many are active'),
    ).toBeInTheDocument()
  })

  it('puts an example in the box when it is chosen', async () => {
    renderPage()
    await waitFor(() =>
      expect(screen.getByText('How many members do we have?')).toBeInTheDocument(),
    )
    fireEvent.click(screen.getByRole('button', { name: 'How many members do we have?' }))
    expect(screen.getByLabelText('Your question')).toHaveValue('How many members do we have?')
  })
})

describe('an answer', () => {
  it('renders the sentence from the key and the figures from the rows', async () => {
    renderPage()
    await askOnScreen('How many members do we have?')

    await waitFor(() =>
      expect(
        screen.getByText('The register holds 120 members, of whom 109 are active.'),
      ).toBeInTheDocument(),
    )
    // The figures, so a cooperative can check the sentence rather than take it on trust.
    expect(screen.getByText('On the register')).toBeInTheDocument()
    expect(screen.getByText('120')).toBeInTheDocument()
    expect(screen.getByText('Active')).toBeInTheDocument()
  })

  it('formats money the way money is formatted everywhere else', async () => {
    stubFetch({ '/assistant/ask': BALANCE_ANSWER })
    renderPage()
    await askOnScreen('What is our balance?')

    await waitFor(() =>
      expect(screen.getByText('The cooperative holds 9,108,000.')).toBeInTheDocument(),
    )
    // Grouped, and grouped by the same code that groups it in a table: the same amount never
    // appears two ways on one page.
    expect(screen.getByText('9,108,000')).toBeInTheDocument()
  })

  it('says which tool produced the figure', async () => {
    renderPage()
    await askOnScreen('How many members do we have?')

    await waitFor(() =>
      expect(
        screen.getByText(
          /This figure came from: How many members are on the register, and how many are active/,
        ),
      ).toBeInTheDocument(),
    )
  })

  it('leads to the screen that shows the same thing in full', async () => {
    const { router } = renderPage()
    await askOnScreen('How many members do we have?')

    const link = await screen.findByRole('link', { name: /See it on the screen/ })
    fireEvent.click(link)
    await waitFor(() => expect(router.state.location.pathname).toBe('/members'))
  })

  it('keeps the question above its answer', async () => {
    renderPage()
    await askOnScreen('How many members do we have?')
    await waitFor(() =>
      expect(screen.getByText(/The register holds 120 members/)).toBeInTheDocument(),
    )
    // Asked and answered together, so a thread of three questions reads as a conversation rather
    // than as three unlabelled figures.
    expect(screen.getAllByText('How many members do we have?').length).toBeGreaterThan(1)
  })

  it('continues the same thread on the next question', async () => {
    renderPage()
    await askOnScreen('How many members do we have?')
    await waitFor(() =>
      expect(screen.getByText(/The register holds 120 members/)).toBeInTheDocument(),
    )

    await askOnScreen('What is our balance?')
    await waitFor(() => expect(calls.filter((call) => call.url.includes('/ask')).length).toBe(2))

    const second = calls.filter((call) => call.url.includes('/ask'))[1]
    expect(second?.body).toMatchObject({ conversationId: 'thread-1' })
  })
})

describe('a refusal', () => {
  it('reads as an answer, not as a failure', async () => {
    stubFetch({ '/assistant/ask': REFUSAL })
    renderPage()
    await askOnScreen('What will the coffee price be next year?')

    await waitFor(() =>
      expect(
        screen.getByText("I cannot answer that from your cooperative's records."),
      ).toBeInTheDocument(),
    )
    // And it says why, and what can be asked instead.
    expect(screen.getByText('Nothing here answers that')).toBeInTheDocument()
    // No figures, and nothing that looks like one.
    expect(screen.queryByText('On the register')).toBeNull()
  })
})

describe('in Kinyarwanda', () => {
  it('composes the same answer in Kinyarwanda', async () => {
    await changeLanguage('rw')
    renderPage()
    await askOnScreen('Abanyamuryango bangahe dufite?', {
      field: 'Ikibazo cyawe',
      ask: 'Baza',
    })

    await waitFor(() =>
      expect(
        screen.getByText('Urutonde rurimo abanyamuryango 120, muri bo 109 bakora.'),
      ).toBeInTheDocument(),
    )
    expect(screen.getByText('Baza CoopManage')).toBeInTheDocument()
    // Nothing on the page is a key that failed to resolve.
    expect(document.body.textContent).not.toMatch(/answer\.[a-z]/i)
    expect(document.body.textContent).not.toMatch(/figure\.[a-z]/i)
  })
})
