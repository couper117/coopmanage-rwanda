import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { meetingRoutes } from '../src/features/meetings/meetingRoutes'
import type { MeetingDetail, MeetingRow } from '../src/features/meetings/meetings.api'
import i18n, { changeLanguage } from '../src/i18n'
import enMeetings from '../src/i18n/locales/en/meetings.json'
import rwMeetings from '../src/i18n/locales/rw/meetings.json'
import { resetSession, signInAs } from './session'

/**
 * The meetings screens, mounted for real against a stubbed network.
 *
 * Three things these tests exist to hold in place, in order:
 *
 * **Quorum reads correctly in all three states.** Met, not met, and not required. The third is the
 * one a screen gets wrong: showing a cross for a committee meeting whose own rules set no quorum
 * would tell a cooperative its meeting was invalid.
 *
 * **A closed meeting offers no editing controls.** Hiding them is not the enforcement — the server
 * refuses either way — but a screen that offered them and then failed would teach a secretary that
 * the system is unreliable rather than that the record is final. The one control that survives is
 * marking an action done.
 *
 * **The agenda is edited as a list and sent once.** Reordering and removing are local, so the test
 * checks what finally reaches the server rather than a request per keystroke.
 */
i18n.addResourceBundle('en', 'meetings', enMeetings, true, true)
i18n.addResourceBundle('rw', 'meetings', rwMeetings, true, true)

interface StubRequest {
  url: string
  method: string
  body: unknown
}

type StubValue = unknown

interface Paged {
  __paged: true
  items: unknown[]
  meta: Record<string, unknown>
}

function paged(items: unknown[], extra: Record<string, unknown> = {}): Paged {
  return {
    __paged: true,
    items,
    meta: { page: 1, pageSize: 25, total: items.length, totalPages: 1, ...extra },
  }
}

function isPaged(value: unknown): value is Paged {
  return typeof value === 'object' && value !== null && '__paged' in value
}

let calls: StubRequest[] = []

function lastCallTo(fragment: string): StubRequest | undefined {
  return [...calls].reverse().find((call) => call.url.includes(fragment))
}

function refusal(status: number, code: string, messageKey: string, message: string): Response {
  return new Response(JSON.stringify({ error: { code, messageKey, message, requestId: 'test' } }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

const MEETING_ID = 'mtg-1'

const BASE: MeetingRow = {
  id: MEETING_ID,
  reference: 'MTG-2026-000007',
  title: 'Annual general assembly 2026',
  type: 'GENERAL_ASSEMBLY',
  scheduledFor: '2026-10-14T08:00:00.000Z',
  endsAt: null,
  location: 'Cooperative hall, Muhoza',
  status: 'IN_PROGRESS',
  quorumRequired: 60,
  notes: null,
  cancelReason: null,
  minutesDocumentId: null,
  minutesTitle: null,
  createdBy: 'Claudine Uwimana',
  presentCount: 74,
  // The figure quorum is measured against: members only, so the two guests in the room are not
  // part of it.
  memberPresentCount: 72,
  attendeeCount: 90,
  agendaCount: 3,
  decisionCount: 2,
  quorumMet: true,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
}

const DETAIL: MeetingDetail = {
  ...BASE,
  agenda: [
    {
      id: 'ag-1',
      position: 1,
      title: 'Opening and attendance',
      description: null,
      presenterStaffId: null,
      presenterName: null,
    },
    {
      id: 'ag-2',
      position: 2,
      title: 'The treasurer’s report',
      description: 'Figures for the year',
      presenterStaffId: 'staff-1',
      presenterName: 'Jean Bosco',
    },
  ],
  attendees: [
    {
      id: 'at-1',
      memberId: 'mem-1',
      staffId: null,
      guestName: null,
      name: 'Uwase Claudine (UMU-00001)',
      status: 'PRESENT',
      note: null,
    },
    {
      id: 'at-2',
      memberId: null,
      staffId: null,
      guestName: 'District cooperative officer',
      name: 'District cooperative officer',
      status: 'PRESENT',
      note: 'Observer',
    },
  ],
  decisions: [
    {
      id: 'dec-1',
      agendaItemId: 'ag-2',
      title: 'Buy a second maize dryer',
      description: 'Before the next harvest',
      decisionType: 'RESOLUTION',
      votesFor: 38,
      votesAgainst: 4,
      abstentions: 2,
      dueOn: null,
      responsibleStaffId: null,
      responsibleName: null,
      status: 'OPEN',
      createdAt: '2026-10-14T09:00:00.000Z',
    },
    {
      id: 'dec-2',
      agendaItemId: null,
      title: 'Repair the store roof',
      description: null,
      decisionType: 'ACTION',
      votesFor: null,
      votesAgainst: null,
      abstentions: null,
      dueOn: '2026-11-30',
      responsibleStaffId: 'staff-1',
      responsibleName: 'Jean Bosco',
      status: 'OPEN',
      createdAt: '2026-10-14T09:10:00.000Z',
    },
  ],
  documents: [
    { id: 'doc-1', title: 'Attendance sheet, scanned', fileName: 'sheet.pdf', category: 'OTHER' },
  ],
}

const OPTIONS = {
  members: [
    { id: 'mem-1', name: 'Uwase Claudine', memberCode: 'UMU-00001', position: 'MEMBER' },
    { id: 'mem-2', name: 'Nsengimana Alphonse', memberCode: 'UMU-00002', position: 'MEMBER' },
  ],
  staff: [{ id: 'staff-1', name: 'Jean Bosco', roleKey: 'SECRETARY' }],
}

const routes: RouteObject[] = meetingRoutes

function stubFetch(handlers: Record<string, StubValue> = {}): void {
  const table: Record<string, StubValue> = {
    '/auth/me': { user: null },
    '/cooperatives/current': { id: 'coop', code: 'ABAHUZA-HUYE', name: 'Abahuzamugambi Coffee' },
    '/meetings/options': OPTIONS,
    [`/meetings/${MEETING_ID}`]: DETAIL,
    '/meetings': paged([BASE]),
    '/documents': paged([]),
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
        return Promise.resolve(refusal(404, 'NOT_FOUND', 'errors.notFound', 'no stub'))
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

async function closeDialog(): Promise<void> {
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await waitFor(() => {
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
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

describe('the meetings list', () => {
  it('leads with the number and the date, the way a minute book is referenced', async () => {
    renderAt('/meetings')
    await waitFor(() => expect(screen.getAllByText('MTG-2026-000007').length).toBeGreaterThan(0))

    expect(screen.getAllByText('Annual general assembly 2026').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Under way').length).toBeGreaterThan(0)
  })

  it('shows the present count and whether the quorum was met', async () => {
    renderAt('/meetings')
    await waitFor(() => expect(screen.getAllByText('74').length).toBeGreaterThan(0))
    expect(screen.getAllByText('Quorum met').length).toBeGreaterThan(0)
  })

  it('shows nothing about quorum where none is set', async () => {
    stubFetch({
      '/meetings': paged([{ ...BASE, quorumRequired: null, quorumMet: null }]),
    })
    renderAt('/meetings')
    await waitFor(() => expect(screen.getAllByText('MTG-2026-000007').length).toBeGreaterThan(0))

    // "Not required" is not the same answer as "not met", and a cross beside a committee meeting
    // whose rules set no quorum would say the meeting was invalid.
    expect(screen.queryByText('Quorum met')).toBeNull()
    expect(screen.queryByText('Quorum not met')).toBeNull()
  })

  it('asks the server for the filters the reader chose', async () => {
    renderAt('/meetings')
    await waitFor(() => expect(screen.getByLabelText('Kind')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'BOARD' } })
    fireEvent.change(screen.getByLabelText('State'), { target: { value: 'COMPLETED' } })
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } })

    await waitFor(() => {
      const request = lastCallTo('/meetings?')
      expect(request?.url).toContain('type=BOARD')
      expect(request?.url).toContain('status=COMPLETED')
      expect(request?.url).toContain('from=2026-10-01')
    })
  })

  it('offers no scheduling to a reader who may only look', async () => {
    signInAs('ACCOUNTANT', { permissions: ['meetings:view', 'dashboard:view'] })
    renderAt('/meetings')
    await waitFor(() => expect(screen.getAllByText('MTG-2026-000007').length).toBeGreaterThan(0))
    expect(screen.queryByText('Schedule a meeting')).toBeNull()
  })
})

describe('scheduling a meeting', () => {
  it('sends the moment in UTC, from the local time that was typed', async () => {
    stubFetch({
      '/meetings': (request: StubRequest) => (request.method === 'POST' ? DETAIL : paged([BASE])),
    })
    renderAt('/meetings')
    await waitFor(() => expect(screen.getByText('Schedule a meeting')).toBeTruthy())

    fireEvent.click(screen.getByText('Schedule a meeting'))
    await waitFor(() => expect(screen.getByLabelText('What the meeting is called')).toBeTruthy())

    fireEvent.change(screen.getByLabelText('What the meeting is called'), {
      target: { value: 'Extraordinary assembly' },
    })
    fireEvent.change(screen.getByLabelText('Date and time'), {
      target: { value: '2026-12-01T14:00' },
    })
    fireEvent.change(screen.getByLabelText(/^Members needed for a quorum/), {
      target: { value: '60' },
    })
    fireEvent.click(screen.getByText('Save the meeting'))

    await waitFor(() => {
      const request = calls.find((call) => call.url.includes('/meetings') && call.method === 'POST')
      const body = request?.body as { title: string; scheduledFor: string; quorumRequired: number }
      expect(body.title).toBe('Extraordinary assembly')
      expect(body.quorumRequired).toBe(60)
      // What the secretary typed is the time in the room; what is sent is the same instant in UTC,
      // so it means the same thing on whatever machine reads it afterwards.
      expect(new Date(body.scheduledFor).toISOString()).toBe(body.scheduledFor)
      expect(new Date(body.scheduledFor).getHours()).toBe(14)
    })
  })

  it('leaves the quorum empty rather than inventing a number', async () => {
    renderAt('/meetings')
    await waitFor(() => expect(screen.getByText('Schedule a meeting')).toBeTruthy())
    fireEvent.click(screen.getByText('Schedule a meeting'))

    await waitFor(() => expect(screen.getByLabelText(/^Members needed for a quorum/)).toBeTruthy())
    expect(screen.getByLabelText<HTMLInputElement>(/^Members needed for a quorum/).value).toBe('')

    await closeDialog()
  })
})

describe('the meeting detail', () => {
  it('shows the agenda in order, the attendance and the decisions with their votes', async () => {
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText('Agenda')).toBeTruthy())

    expect(screen.getByText('Opening and attendance')).toBeTruthy()
    expect(screen.getByText('The treasurer’s report')).toBeTruthy()
    expect(screen.getByText('Presented by Jean Bosco')).toBeTruthy()

    expect(screen.getByText('Uwase Claudine (UMU-00001)')).toBeTruthy()
    expect(screen.getByText('District cooperative officer')).toBeTruthy()

    // Minutes have to show how a decision was carried, not merely that it was.
    expect(screen.getByText('38 for, 4 against, 2 abstained')).toBeTruthy()
    // And a decision reached without a vote says so rather than showing 0/0/0.
    expect(screen.getByText('No vote was taken')).toBeTruthy()
  })

  it('reports the quorum as met, with the figures behind it', async () => {
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText('72 of 60 members present')).toBeTruthy())
    expect(screen.getAllByText('Quorum met').length).toBeGreaterThan(0)
  })

  it('warns while the meeting is open that it is short of its quorum', async () => {
    stubFetch({
      [`/meetings/${MEETING_ID}`]: {
        ...DETAIL,
        presentCount: 12,
        memberPresentCount: 12,
        quorumMet: false,
      },
    })
    renderAt(`/meetings/${MEETING_ID}`)

    await waitFor(() => expect(screen.getByText(/so it cannot decide anything/)).toBeTruthy())
  })

  it('says no quorum is set rather than showing it as unmet', async () => {
    stubFetch({
      [`/meetings/${MEETING_ID}`]: { ...DETAIL, quorumRequired: null, quorumMet: null },
    })
    renderAt(`/meetings/${MEETING_ID}`)

    await waitFor(() => expect(screen.getByText('No quorum is set for this meeting')).toBeTruthy())
    expect(screen.queryByText('Quorum not met')).toBeNull()
  })
})

describe('a closed meeting', () => {
  beforeEach(() => {
    stubFetch({
      [`/meetings/${MEETING_ID}`]: { ...DETAIL, status: 'COMPLETED' },
    })
  })

  it('offers no editing controls at all', async () => {
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText(/This meeting is closed/)).toBeTruthy())

    for (const label of [
      'Change the details',
      'Set the agenda',
      'Take attendance',
      'Record a decision',
      'Close the meeting',
      'Call it off',
    ]) {
      expect(screen.queryByText(label), label).toBeNull()
    }
  })

  it('still lets an action be marked done', async () => {
    stubFetch({
      [`/meetings/${MEETING_ID}/decisions/dec-2`]: {
        ...DETAIL,
        status: 'COMPLETED',
        decisions: DETAIL.decisions.map((decision) =>
          decision.id === 'dec-2' ? { ...decision, status: 'DONE' } : decision,
        ),
      },
      [`/meetings/${MEETING_ID}`]: { ...DETAIL, status: 'COMPLETED' },
    })
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getAllByText('Done').length).toBeGreaterThan(0))

    // The control belongs to one decision, so it is found within that decision's own entry rather
    // than by text across the page — "Done" is both a decision's state and the label of the
    // control that sets it, and there is one control per open decision.
    const entry = [...document.querySelectorAll('li')].find((item) =>
      item.textContent?.includes('Repair the store roof'),
    )
    const button = [...(entry?.querySelectorAll('button') ?? [])].find(
      (candidate) => candidate.textContent?.trim() === 'Done',
    )
    expect(button).toBeTruthy()

    // An action recorded in March is marked done in June; a record that could not say so would be
    // useless within a year.
    fireEvent.click(button as HTMLElement)

    await waitFor(() => {
      const request = lastCallTo('/decisions/dec-2')
      expect(request?.method).toBe('PATCH')
      expect(request?.body).toEqual({ status: 'DONE' })
    })
  })
})

describe('the agenda editor', () => {
  it('reorders and removes locally, then sends the list once', async () => {
    stubFetch({
      [`/meetings/${MEETING_ID}/agenda`]: DETAIL,
      [`/meetings/${MEETING_ID}`]: DETAIL,
    })
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText('Set the agenda')).toBeTruthy())

    fireEvent.click(screen.getByText('Set the agenda'))
    await waitFor(() => expect(screen.getByText('Save the agenda')).toBeTruthy())

    calls = []
    // Move the second item up, so the order sent is the reverse of the order loaded.
    fireEvent.click(screen.getAllByLabelText('Move up')[1] as HTMLElement)
    // Nothing has been sent: this is array work on local state, which is why it is instant.
    expect(calls.filter((call) => call.method === 'PUT')).toEqual([])

    fireEvent.click(screen.getByText('Save the agenda'))

    await waitFor(() => {
      const request = lastCallTo('/agenda')
      expect(request?.method).toBe('PUT')
      const body = request?.body as { items: { title: string }[] }
      // Positions are not sent: the array order is the order, numbered by the server.
      expect(body.items.map((item) => item.title)).toEqual([
        'The treasurer’s report',
        'Opening and attendance',
      ])
      expect(JSON.stringify(body)).not.toContain('position')
    })
  })
})

describe('the attendance editor', () => {
  it('lists the register with a running count against the quorum', async () => {
    stubFetch({
      [`/meetings/${MEETING_ID}/attendance`]: DETAIL,
      [`/meetings/${MEETING_ID}`]: DETAIL,
    })
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText('Take attendance')).toBeTruthy())

    fireEvent.click(screen.getByText('Take attendance'))
    // The register arrives in its own request, so the wait is for a member rather than for the
    // dialog's save button, which is there from the first render.
    await waitFor(() => expect(screen.getByLabelText('Uwase Claudine')).toBeTruthy())

    // Every member of the register appears, so a member who is not in it cannot be marked present
    // — which is what makes the count provable.
    expect(screen.getByLabelText('Nsengimana Alphonse')).toBeTruthy()

    // One member already present in the loaded meeting, so the count starts at one — and the
    // guest who is also present is counted beside it rather than added in, because a quorum is a
    // number of members.
    expect(screen.getByText(/1 present of 2 members/)).toBeTruthy()
    expect(screen.getByText(/plus 1 guests/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('Nsengimana Alphonse'), {
      target: { value: 'PRESENT' },
    })
    await waitFor(() => expect(screen.getByText(/2 present of 2 members/)).toBeTruthy())

    fireEvent.click(screen.getByText('Save the attendance'))
    await waitFor(() => {
      const request = lastCallTo('/attendance')
      const body = request?.body as { entries: { memberId: string; status: string }[] }
      expect(request?.method).toBe('PUT')
      // Two members and the guest who was already recorded: the guest is kept, and counted
      // separately from the quorum rather than dropped.
      expect(body.entries).toHaveLength(3)
      expect(body.entries.every((entry) => entry.status === 'PRESENT')).toBe(true)
      expect(body.entries.filter((entry) => entry.memberId)).toHaveLength(2)
    })
  })

  it('marks everybody present in one action, for a full hall', async () => {
    stubFetch({
      [`/meetings/${MEETING_ID}/attendance`]: DETAIL,
      [`/meetings/${MEETING_ID}`]: DETAIL,
    })
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText('Take attendance')).toBeTruthy())
    fireEvent.click(screen.getByText('Take attendance'))
    await waitFor(() => expect(screen.getByLabelText('Uwase Claudine')).toBeTruthy())

    fireEvent.click(screen.getByText('Mark everybody present'))
    await waitFor(() => expect(screen.getByText(/2 present of 2 members/)).toBeTruthy())

    await closeDialog()
  })
})

describe('recording a decision', () => {
  it('sends the votes, and warns that the record cannot be edited afterwards', async () => {
    stubFetch({
      [`/meetings/${MEETING_ID}/decisions`]: DETAIL,
      [`/meetings/${MEETING_ID}`]: DETAIL,
    })
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText('Record a decision')).toBeTruthy())

    fireEvent.click(screen.getByText('Record a decision'))
    await waitFor(() => expect(screen.getByText('Record it')).toBeTruthy())

    // Said up front, because the update endpoint accepts only the follow-up. A form that let
    // somebody find that out by being refused would be worse.
    expect(screen.getByText(/cannot be edited afterwards/)).toBeTruthy()

    fireEvent.change(screen.getByLabelText('The decision'), {
      target: { value: 'Raise the membership fee' },
    })
    fireEvent.change(screen.getByLabelText(/^For/), { target: { value: '44' } })
    fireEvent.change(screen.getByLabelText(/^Against/), { target: { value: '6' } })
    fireEvent.click(screen.getByText('Record it'))

    await waitFor(() => {
      const request = lastCallTo('/decisions')
      const body = request?.body as { title: string; votesFor: number; abstentions: number | null }
      expect(body.title).toBe('Raise the membership fee')
      expect(body.votesFor).toBe(44)
      // Left empty, so sent as null rather than 0: no abstentions and "nobody abstained was not
      // recorded" are different facts.
      expect(body.abstentions).toBeNull()
    })
  })
})

describe('calling off a meeting', () => {
  it('will not send without a reason, and says what keeping it means', async () => {
    renderAt(`/meetings/${MEETING_ID}`)
    await waitFor(() => expect(screen.getByText('Call it off')).toBeTruthy())

    fireEvent.click(screen.getByText('Call it off'))
    await waitFor(() => expect(screen.getByText('Keep it scheduled')).toBeTruthy())

    calls = []
    const confirm = screen.getByText('Call off this meeting?')
    expect(confirm).toBeTruthy()
    // The confirm button is disabled until a reason is typed, because a cooperative's minute book
    // has no unexplained gaps.
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])

    fireEvent.click(screen.getByText('Keep it scheduled'))
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull())
  })
})

describe('in Kinyarwanda', () => {
  it('renders the detail in Kinyarwanda', async () => {
    await changeLanguage('rw')
    renderAt(`/meetings/${MEETING_ID}`)

    await waitFor(() => expect(screen.getByText("Ingingo z'inama")).toBeTruthy())
    expect(screen.getAllByText('Abitabiriye').length).toBeGreaterThan(0)
    expect(screen.getByText("Ibyemezo n'ibikorwa")).toBeTruthy()
    expect(screen.getAllByText('Umubare wa ngombwa wujujwe').length).toBeGreaterThan(0)
    expect(screen.getByText('Iragenda')).toBeTruthy()
  })
})
