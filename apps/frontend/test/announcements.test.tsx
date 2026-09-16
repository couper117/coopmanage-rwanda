import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { announcementRoutes } from '../src/features/announcements/announcementRoutes'
import type {
  AnnouncementRow,
  AudiencePreview,
  SmsLogRow,
} from '../src/features/announcements/announcements.api'
import { changeLanguage } from '../src/i18n'
import { resetSession, signInAs } from './session'

/**
 * Phase 12 on the screen: announcements, and the log of what was sent.
 *
 * Four things this file holds in place, in order of what it would cost to get wrong:
 *
 * **The publish dialog tells the truth before the button.** How many members can be reached, how
 * many cannot, what it costs, and — while the mock provider is live — that nothing will actually be
 * delivered. A screen that reported "78 sent" from a provider that delivers nothing would be the
 * most damaging screen in the application.
 *
 * **A published announcement offers no edit.** The server refuses either way; the screen must not
 * offer an action that will fail.
 *
 * **A partial send is reported, not swallowed.** The dialog stays open and says which messages were
 * refused, because forty-nine delivered and one not is the case a cooperative has to act on.
 *
 * **The cost is quoted as it is typed**, from the same rule the server bills by.
 */

interface StubRequest {
  url: string
  method: string
  body: unknown
}

let calls: StubRequest[] = []

const DRAFT: AnnouncementRow = {
  id: 'ann-1',
  title: 'The assembly has moved to Saturday',
  titleRw: 'Inteko rusange yimuriwe ku wa gatandatu',
  body: 'The general assembly is now on Saturday at nine.',
  bodyRw: 'Inteko rusange ubu ni ku wa gatandatu saa tatu.',
  audience: 'ACTIVE_MEMBERS',
  status: 'DRAFT',
  publishedAt: null,
  archivedAt: null,
  archiveReason: null,
  createdBy: 'Claudine Uwimana',
  publishedBy: null,
  messageCount: 0,
  segments: 1,
  unicode: false,
  createdAt: '2026-09-15T08:00:00.000Z',
  updatedAt: '2026-09-15T08:00:00.000Z',
}

const PUBLISHED: AnnouncementRow = {
  ...DRAFT,
  id: 'ann-2',
  title: 'Coffee cherry price for this week',
  titleRw: null,
  status: 'PUBLISHED',
  publishedAt: '2026-09-14T08:00:00.000Z',
  publishedBy: 'Claudine Uwimana',
  messageCount: 78,
}

const AUDIENCE: AudiencePreview = {
  audience: 'ACTIVE_MEMBERS',
  total: 120,
  withPhone: 78,
  withoutPhone: 42,
  segments: 1,
  unicode: false,
  delivers: false,
}

const MESSAGE: SmsLogRow = {
  id: 'sms-1',
  toPhone: '+250788123456',
  body: 'Inteko rusange ubu ni ku wa gatandatu saa tatu.',
  status: 'SENT',
  provider: 'mock',
  failureReason: null,
  sentAt: '2026-09-15T08:05:00.000Z',
  createdAt: '2026-09-15T08:05:00.000Z',
  memberId: 'mem-1',
  memberName: 'Mukamana Chantal',
  memberCode: 'ABAH-0001',
  announcementId: 'ann-2',
  announcementTitle: 'Coffee cherry price for this week',
}

const FAILED_MESSAGE: SmsLogRow = {
  ...MESSAGE,
  id: 'sms-2',
  toPhone: '+250781000000',
  status: 'FAILED',
  failureReason: 'The number is not in service.',
  sentAt: null,
  memberName: 'Utagerwaho Numero',
  memberCode: 'ABAH-0002',
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
    meta: { page: 1, pageSize: 25, total: items.length, totalPages: 1 },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

function stubFetch(handlers: Record<string, unknown> = {}): void {
  const table: Record<string, unknown> = {
    '/cooperatives/current': { id: 'coop', code: 'ABAH', name: 'Abahuzamugambi Coffee' },
    '/settings': { enabledModules: ['announcements'] },
    '/sms/provider': { provider: 'mock', delivers: false },
    '/sms/messages': paged([MESSAGE, FAILED_MESSAGE]),
    '/announcements/ann-1/audience': AUDIENCE,
    '/announcements/ann-1/publish': { announcement: { ...DRAFT, status: 'PUBLISHED' }, sms: null },
    '/announcements': paged([DRAFT, PUBLISHED]),
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

function renderAt(path: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const routes: RouteObject[] = announcementRoutes
  const router = createMemoryRouter(routes, { initialEntries: [path] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

function lastCallTo(fragment: string, method: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment) && call.method === method)
}

beforeEach(() => {
  calls = []
  signInAs('SECRETARY')
  stubFetch()
})

afterEach(async () => {
  vi.unstubAllGlobals()
  resetSession()
  await changeLanguage('en')
})

describe('the list', () => {
  it('shows drafts, published notices and who each one is for', async () => {
    renderAt('/announcements')
    await waitFor(() =>
      expect(screen.getAllByText('The assembly has moved to Saturday').length).toBeGreaterThan(0),
    )

    expect(screen.getAllByText('Draft').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Published').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Active members').length).toBeGreaterThan(0)
  })

  it('says at the top that nothing is being delivered yet', async () => {
    renderAt('/announcements')
    // A cooperative looking at this list should know before it writes anything that no gateway is
    // connected. Saying it only inside the publish dialog would be saying it too late.
    await waitFor(() =>
      expect(screen.getByText('Messages are recorded, not delivered')).toBeInTheDocument(),
    )
  })

  it('offers no edit on a published announcement', async () => {
    renderAt('/announcements')
    await waitFor(() =>
      expect(screen.getAllByText('Coffee cherry price for this week').length).toBeGreaterThan(0),
    )

    const draftRow = screen.getByText('The assembly has moved to Saturday').closest('tr')
    const publishedRow = screen.getByText('Coffee cherry price for this week').closest('tr')

    // The server refuses either way. The screen must not offer an action that will fail.
    expect(
      within(draftRow as HTMLElement).getByRole('button', { name: /Edit/ }),
    ).toBeInTheDocument()
    expect(within(publishedRow as HTMLElement).queryByRole('button', { name: /Edit/ })).toBeNull()
  })

  it('links a published announcement to the messages it sent', async () => {
    renderAt('/announcements')
    await waitFor(() => expect(screen.getAllByText('78').length).toBeGreaterThan(0))
    const link = screen.getAllByText('78')[0]?.closest('a')
    expect(link).toHaveAttribute('href', '/announcements/messages?announcementId=ann-2')
  })
})

describe('writing one', () => {
  it('quotes what it will cost as the text is typed', async () => {
    renderAt('/announcements')
    await waitFor(() => expect(screen.getByText('Write an announcement')).toBeInTheDocument())
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Write an announcement' })[0] as HTMLElement,
    )

    const dialog = await screen.findByRole('dialog')
    const body = within(dialog).getByLabelText('Message')
    fireEvent.change(body, { target: { value: 'Short notice about Saturday.' } })

    await waitFor(() =>
      expect(within(dialog).getByText(/28 characters, one message per member/)).toBeInTheDocument(),
    )

    // Past the 160th character the price doubles, and the reader is told before they send.
    fireEvent.change(body, { target: { value: 'a'.repeat(200) } })
    await waitFor(() =>
      expect(within(dialog).getByText(/200 characters, 2 messages per member/)).toBeInTheDocument(),
    )

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('asks for both languages and insists on neither', async () => {
    renderAt('/announcements')
    await waitFor(() => expect(screen.getByText('Write an announcement')).toBeInTheDocument())
    fireEvent.click(
      screen.getAllByRole('button', { name: 'Write an announcement' })[0] as HTMLElement,
    )

    const dialog = await screen.findByRole('dialog')
    // A cooperative writing one sentence must not be made to write it twice.
    // "(optional)" is part of the accessible label, which is how a screen reader hears it.
    expect(within(dialog).getByLabelText(/Title in Kinyarwanda.*optional/)).toBeInTheDocument()
    expect(within(dialog).getByLabelText(/Message in Kinyarwanda.*optional/)).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })
})

describe('the publish dialog', () => {
  async function openPublish() {
    renderAt('/announcements')
    await waitFor(() =>
      expect(screen.getAllByText('The assembly has moved to Saturday').length).toBeGreaterThan(0),
    )
    const row = screen.getByText('The assembly has moved to Saturday').closest('tr')
    fireEvent.click(within(row as HTMLElement).getByRole('button', { name: /Publish/ }))
    return screen.findByRole('dialog')
  }

  it('says how many members cannot be reached at all', async () => {
    const dialog = await openPublish()
    await waitFor(() => expect(within(dialog).getByText('120')).toBeInTheDocument())

    expect(within(dialog).getByText('78')).toBeInTheDocument()
    // A phone number is never required of a member, so this is the ordinary case and the committee
    // has to decide how the other 42 are told.
    expect(
      within(dialog).getByText(/42 members have no phone number and will not receive the message/),
    ).toBeInTheDocument()

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('quotes the total cost of the send', async () => {
    const dialog = await openPublish()
    await waitFor(() =>
      expect(within(dialog).getByText(/One message each, so 78 in total/)).toBeInTheDocument(),
    )

    fireEvent.keyDown(document.body, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('does not send unless sending is switched on', async () => {
    const dialog = await openPublish()
    await waitFor(() => expect(within(dialog).getByText('120')).toBeInTheDocument())

    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish it' }))

    await waitFor(() => expect(lastCallTo('/publish', 'POST')).toBeDefined())
    // Sending costs money and reaches people who have no other way of being told, so it is asked
    // for explicitly rather than defaulted on.
    expect(lastCallTo('/publish', 'POST')?.body).toEqual({ sendSms: false })
  })

  it('reports a partial send instead of closing on it', async () => {
    stubFetch({
      '/announcements/ann-1/publish': {
        announcement: { ...DRAFT, status: 'PUBLISHED', messageCount: 78 },
        sms: {
          sent: 77,
          failed: 1,
          alreadySent: 0,
          withoutPhone: 42,
          segments: 1,
          delivered: false,
        },
      },
    })

    const dialog = await openPublish()
    await waitFor(() => expect(within(dialog).getByText('120')).toBeInTheDocument())

    fireEvent.click(within(dialog).getByLabelText(/Send it to the members by SMS/))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Publish and send' }))

    // Forty-nine delivered and one not is the case a cooperative has to act on, so the dialog
    // stays open and says so rather than reporting success and closing.
    await waitFor(() => expect(within(dialog).getByText('77')).toBeInTheDocument())
    expect(
      within(dialog).getByText(/One message was refused. The log says which member and why/),
    ).toBeInTheDocument()
    expect(
      within(dialog).getByText(/42 members have no phone number and were not sent anything/),
    ).toBeInTheDocument()
    expect(within(dialog).getByText(/recorded and not delivered/)).toBeInTheDocument()
  })
})

describe('the message log', () => {
  it('names the member, the number as sent, and why a message failed', async () => {
    renderAt('/announcements/messages')
    await waitFor(() => expect(screen.getAllByText('Mukamana Chantal').length).toBeGreaterThan(0))

    // The number is shown the way it is read aloud, from the canonical form that was sent.
    expect(screen.getAllByText(/0788 123 456/).length).toBeGreaterThan(0)
    expect(screen.getAllByText('The number is not in service.').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Refused').length).toBeGreaterThan(0)
  })

  it('opens on one announcement when it was reached from that announcement', async () => {
    renderAt('/announcements/messages?announcementId=ann-2')
    await waitFor(() => expect(screen.getAllByText('Mukamana Chantal').length).toBeGreaterThan(0))
    // The filter is applied on the request rather than in the page, so the count and the rows agree.
    expect(lastCallTo('/sms/messages', 'GET')?.url).toContain('announcementId=ann-2')
  })
})

describe('in Kinyarwanda', () => {
  it('reads without a key or an English word on the list', async () => {
    await changeLanguage('rw')
    renderAt('/announcements')

    // Waits for a row rather than for the heading: the heading is on screen while the list is
    // still coming.
    await waitFor(() =>
      expect(screen.getAllByText('Inteko rusange yimuriwe ku wa gatandatu').length).toBeGreaterThan(
        0,
      ),
    )
    expect(screen.getByText('Amatangazo')).toBeInTheDocument()
    expect(screen.getAllByText('Umushinga').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Abanyamuryango bakora').length).toBeGreaterThan(0)
    expect(screen.getByText('Ubutumwa bwandikwa, ntibutangwa')).toBeInTheDocument()

    expect(document.body.textContent).not.toMatch(/announcements\.[a-z]/i)
  })
})
