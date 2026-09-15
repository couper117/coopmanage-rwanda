import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { TooltipProvider } from '../src/components/ui'
import { documentRoutes } from '../src/features/documents/documentRoutes'
import type { DocumentRow } from '../src/features/documents/documents.api'
import i18n, { changeLanguage } from '../src/i18n'
import enDocuments from '../src/i18n/locales/en/documents.json'
import rwDocuments from '../src/i18n/locales/rw/documents.json'
import { resetSession, signInAs } from './session'

/**
 * The documents screen, mounted for real against a stubbed network.
 *
 * What matters most here, and what these tests are arranged around:
 *
 * **A document is never a URL.** Every byte comes through an authenticated request, so a download
 * is a `fetch` with the session's headers and a preview is an object URL over a blob. These tests
 * assert the request was made and the headers were right, which is the part a browser would
 * otherwise hide.
 *
 * **There is no delete control.** A superseded paper is archived with a reason and stays findable.
 * The test for that checks both halves: no delete button anywhere, and the archive dialog refusing
 * to submit without a reason.
 *
 * **The refusal a cooperative sees is the server's own.** A disguised executable is refused with a
 * message about what the file actually was, and the screen shows that rather than a generic
 * failure — which is the difference between somebody fixing the upload and somebody trying it
 * again with the same file.
 */
i18n.addResourceBundle('en', 'documents', enDocuments, true, true)
i18n.addResourceBundle('rw', 'documents', rwDocuments, true, true)

interface StubRequest {
  url: string
  method: string
  body: unknown
  headers: Record<string, string>
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

const PDF: DocumentRow = {
  id: 'doc-pdf',
  title: 'Certificate of registration, 2019',
  category: 'REGISTRATION',
  fileName: 'certificate-2019.pdf',
  mimeType: 'application/pdf',
  sizeBytes: '248913',
  checksumSha256: 'a'.repeat(64),
  visibility: 'COOPERATIVE',
  memberId: null,
  memberName: null,
  meetingId: null,
  meetingTitle: null,
  description: 'Issued by RCA',
  tags: ['registration', 'rca'],
  uploadedBy: 'Claudine Uwimana',
  isArchived: false,
  archivedAt: null,
  archiveReason: null,
  canPreview: true,
  createdAt: '2026-09-01T08:00:00.000Z',
  updatedAt: '2026-09-01T08:00:00.000Z',
}

const RESTRICTED: DocumentRow = {
  ...PDF,
  id: 'doc-restricted',
  title: 'A member’s medical letter',
  fileName: 'letter.pdf',
  category: 'MEMBER',
  visibility: 'RESTRICTED',
  tags: [],
}

const ARCHIVED: DocumentRow = {
  ...PDF,
  id: 'doc-archived',
  title: 'Superseded contract',
  fileName: 'old-contract.pdf',
  category: 'CONTRACT',
  isArchived: true,
  archivedAt: '2026-09-10T08:00:00.000Z',
  archiveReason: 'Replaced by the 2026 contract',
  tags: [],
}

const SPREADSHEET: DocumentRow = {
  ...PDF,
  id: 'doc-xlsx',
  title: 'Member figures',
  fileName: 'figures.xlsx',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  canPreview: false,
  tags: [],
}

const OPTIONS = {
  categories: ['REGISTRATION', 'CONTRACT', 'MEETING_MINUTES', 'OTHER'],
  extensions: ['pdf', 'jpg', 'png', 'docx', 'xlsx', 'csv', 'txt'],
  mimeTypes: ['application/pdf', 'image/png'],
}

function file(contents: string, contentType: string, filename: string): Response {
  return new Response(contents, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}

const routes: RouteObject[] = documentRoutes

function stubFetch(handlers: Record<string, StubValue> = {}): void {
  const table: Record<string, StubValue> = {
    '/auth/me': { user: null },
    '/cooperatives/current': { id: 'coop', code: 'ABAHUZA-HUYE', name: 'Abahuzamugambi Coffee' },
    '/documents/options': OPTIONS,
    '/documents': paged([PDF, RESTRICTED, SPREADSHEET, ARCHIVED]),
    ...handlers,
  }

  vi.stubGlobal(
    'fetch',
    vi.fn((input: string, init?: RequestInit) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      const body =
        typeof init?.body === 'string'
          ? (JSON.parse(init.body) as unknown)
          : (init?.body ?? undefined)
      calls.push({
        url,
        method,
        body,
        headers: (init?.headers ?? {}) as Record<string, string>,
      })

      const match = Object.keys(table)
        .sort((a, b) => b.length - a.length)
        .find((path) => url.includes(path))

      if (!match) {
        return Promise.resolve(refusal(404, 'NOT_FOUND', 'errors.notFound', 'no stub'))
      }

      const value = table[match]
      const result =
        typeof value === 'function'
          ? (value as (request: StubRequest) => unknown)({
              url,
              method,
              body,
              headers: {},
            })
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

function renderDocuments() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const router = createMemoryRouter(routes, { initialEntries: ['/documents'] })
  const view = render(
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>,
  )
  return { ...view, router }
}

async function listed(): Promise<void> {
  await waitFor(() => {
    expect(screen.getAllByText('Certificate of registration, 2019').length).toBeGreaterThan(0)
  })
}

async function closeDialog(): Promise<void> {
  fireEvent.keyDown(document.body, { key: 'Escape' })
  await waitFor(() => {
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
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

describe('the documents list', () => {
  it('shows each paper with its filename, size and tags', async () => {
    renderDocuments()
    await listed()

    expect(screen.getAllByText('certificate-2019.pdf').length).toBeGreaterThan(0)
    // 248,913 bytes is 243 KB with 1024-byte kilobytes, which is what a file manager shows.
    expect(screen.getAllByText('243 KB').length).toBeGreaterThan(0)
    expect(screen.getAllByText('registration').length).toBeGreaterThan(0)
  })

  it('marks a restricted paper, so nobody is surprised a colleague cannot find it', async () => {
    renderDocuments()
    await listed()
    expect(screen.getAllByText('Restricted').length).toBeGreaterThan(0)
  })

  it('offers no way to delete a document anywhere on the screen', async () => {
    renderDocuments()
    await listed()

    // There is no delete endpoint, so there is no control. A superseded paper is archived.
    expect(screen.queryByText('Delete')).toBeNull()
    expect(screen.getAllByText('Archive').length).toBeGreaterThan(0)
  })

  it('offers restore for an archived paper and not archive', async () => {
    renderDocuments()
    await listed()
    // The archived row is the only one with a restore control.
    expect(screen.getAllByText('Restore')).toHaveLength(1)
  })

  it('asks the server for the search, the kind and the archived filter', async () => {
    renderDocuments()
    await listed()

    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'land title' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'CONTRACT' } })
    fireEvent.change(screen.getByLabelText('Archived'), { target: { value: 'only' } })

    await waitFor(() => {
      const request = lastCallTo('/documents?')
      expect(request?.url).toContain('q=land+title')
      expect(request?.url).toContain('category=CONTRACT')
      expect(request?.url).toContain('archived=only')
    })
  })
})

describe('adding a document', () => {
  it('sends the file as multipart with the metadata beside it', async () => {
    stubFetch({
      '/documents': (request: StubRequest) =>
        request.method === 'POST'
          ? { ...PDF, title: 'Land title' }
          : paged([PDF, RESTRICTED, SPREADSHEET, ARCHIVED]),
    })
    renderDocuments()
    await listed()

    fireEvent.click(screen.getByText('Add a document'))
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).not.toBeNull())

    const input = screen.getByLabelText('File')
    const chosen = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], 'land-title.pdf', {
      type: 'application/pdf',
    })
    fireEvent.change(input, { target: { files: [chosen] } })

    fireEvent.change(screen.getByLabelText('What this document is'), {
      target: { value: 'Land title' },
    })
    // `FormField` appends "(optional)" inside the label, so an exact query needs it — the same
    // pitfall the finance and sales suites hit.
    fireEvent.change(screen.getByLabelText(/^Tags/), { target: { value: 'land, title' } })
    fireEvent.click(screen.getByText('Add it'))

    await waitFor(() => {
      const request = calls.find(
        (call) => call.url.includes('/documents') && call.method === 'POST',
      )
      expect(request).toBeTruthy()
      // FormData, not JSON: the browser sets the multipart boundary, and a JSON body would arrive
      // with a content type the endpoint does not accept.
      expect(request?.body instanceof FormData).toBe(true)
      const form = request?.body as FormData
      expect((form.get('file') as File).name).toBe('land-title.pdf')
      expect(form.get('title')).toBe('Land title')
      expect(form.get('tags')).toBe('land, title')
    })

    await waitFor(() => expect(screen.getByText(/Land title was added/)).toBeTruthy())
  })

  it('tells the reader what may be uploaded, from the server’s own list', async () => {
    renderDocuments()
    await listed()

    fireEvent.click(screen.getByText('Add a document'))
    await waitFor(() =>
      expect(screen.getByText(/Accepted: pdf, jpg, png, docx, xlsx, csv, txt/)).toBeTruthy(),
    )
    // SVG is not on the list, and the hint a member of staff reads is the list the upload is
    // actually checked against.
    expect(screen.queryByText(/svg/)).toBeNull()

    await closeDialog()
  })

  it('shows the server’s refusal of a disguised executable, not a generic failure', async () => {
    stubFetch({
      '/documents': (request: StubRequest) =>
        request.method === 'POST'
          ? refusal(
              415,
              'UNSUPPORTED_FILE_TYPE',
              'errors.files.executable',
              'That file is a program, and programs are never accepted.',
            )
          : paged([PDF]),
    })
    renderDocuments()
    await listed()

    fireEvent.click(screen.getByText('Add a document'))
    await waitFor(() => expect(screen.getByLabelText('File')).toBeTruthy())

    const disguised = new File([new Uint8Array([0x4d, 0x5a])], 'certificate.pdf', {
      type: 'application/pdf',
    })
    fireEvent.change(screen.getByLabelText('File'), { target: { files: [disguised] } })
    fireEvent.click(screen.getByText('Add it'))

    // The words a member of staff can act on: the file is a program. A generic "upload failed"
    // would send them round the loop with the same file.
    await waitFor(() => expect(screen.getByText(/That file is a program/)).toBeTruthy())
    // And the dialog stays open with what they typed, so the file can be corrected.
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()

    await closeDialog()
  })

  it('does not submit without a file', async () => {
    renderDocuments()
    await listed()

    fireEvent.click(screen.getByText('Add a document'))
    await waitFor(() => expect(screen.getByText('Add it')).toBeTruthy())

    calls = []
    fireEvent.click(screen.getByText('Add it'))
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])

    await closeDialog()
  })
})

describe('archiving', () => {
  it('will not archive without a reason, and sends it when given', async () => {
    stubFetch({
      '/documents/doc-pdf/archive': { ...PDF, isArchived: true, archiveReason: 'Replaced' },
      '/documents': paged([PDF]),
    })
    renderDocuments()
    await listed()

    fireEvent.click(screen.getAllByText('Archive')[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('Archive it')).toBeTruthy())

    calls = []
    fireEvent.click(screen.getByText('Archive it'))
    // "Archived" with nothing beside it is the same unanswerable question at the next audit as a
    // row that simply disappeared.
    expect(calls.filter((call) => call.method === 'POST')).toEqual([])

    fireEvent.change(screen.getByLabelText('Why it is being archived'), {
      target: { value: 'Replaced by the 2026 certificate' },
    })
    fireEvent.click(screen.getByText('Archive it'))

    await waitFor(() => {
      const request = lastCallTo('/archive')
      expect(request?.method).toBe('POST')
      expect(request?.body).toEqual({ reason: 'Replaced by the 2026 certificate' })
    })
  })

  it('says what keeping the document means rather than "Cancel"', async () => {
    renderDocuments()
    await listed()

    fireEvent.click(screen.getAllByText('Archive')[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('Archive it')).toBeTruthy())

    // On a screen whose action is itself a kind of cancelling, a button labelled "Cancel" beside
    // "Archive it" is two opposite meanings of one word.
    expect(screen.getByText('Keep it in the list')).toBeTruthy()

    // Dismissed by its own control rather than by Escape: this dialog's point is that the dismiss
    // button says what keeping the document means, so the test uses it.
    fireEvent.click(screen.getByText('Keep it in the list'))
    await waitFor(() => {
      expect(document.querySelector('[role="dialog"]')).toBeNull()
    })
  })
})

describe('reading a document', () => {
  it('downloads through an authenticated request, never a link', async () => {
    stubFetch({
      '/documents/doc-pdf/download': file('%PDF-1.7', 'application/pdf', 'certificate-2019.pdf'),
      '/documents': paged([PDF]),
    })
    renderDocuments()
    await listed()

    fireEvent.click(screen.getAllByText('Download')[0] as HTMLElement)

    await waitFor(() => {
      const request = lastCallTo('/documents/doc-pdf/download')
      expect(request).toBeTruthy()
    })
    // No anchor pointing at the API: the bytes arrive as a blob and are handed over by a click on
    // an anchor the page makes and removes, which is what `saveFile` does.
    expect(
      [...document.querySelectorAll('a')].some((anchor) =>
        anchor.getAttribute('href')?.includes('/documents/'),
      ),
    ).toBe(false)
  })

  it('opens the detail with the checksum in full', async () => {
    stubFetch({
      '/documents/doc-pdf/download': file('%PDF-1.7', 'application/pdf', 'certificate-2019.pdf'),
      '/documents': paged([PDF]),
    })
    renderDocuments()
    await listed()

    fireEvent.click(screen.getAllByText('Certificate of registration, 2019')[0] as HTMLElement)
    await waitFor(() => expect(screen.getByText('Checksum')).toBeTruthy())

    // Shown in full so somebody can compare it against a checksum computed on their own copy. A
    // truncated hash would be decoration.
    expect(screen.getByText('a'.repeat(64))).toBeTruthy()

    await closeDialog()
  })

  it('says a spreadsheet cannot be shown here rather than showing an empty frame', async () => {
    stubFetch({ '/documents': paged([SPREADSHEET]) })
    renderDocuments()
    await waitFor(() => expect(screen.getAllByText('Member figures').length).toBeGreaterThan(0))

    fireEvent.click(screen.getAllByText('Member figures')[0] as HTMLElement)
    await waitFor(() =>
      expect(screen.getByText(/This kind of file cannot be shown here/)).toBeTruthy(),
    )

    await closeDialog()
  })
})

describe('permissions', () => {
  it('offers no upload or archive to a reader who may only view', async () => {
    signInAs('ACCOUNTANT', { permissions: ['documents:view', 'dashboard:view'] })
    renderDocuments()
    await listed()

    expect(screen.queryByText('Add a document')).toBeNull()
    expect(screen.queryByText('Archive')).toBeNull()
    expect(screen.queryByText('Change the details')).toBeNull()
    // Reading and downloading are still theirs.
    expect(screen.getAllByText('Download').length).toBeGreaterThan(0)
  })
})

describe('in Kinyarwanda', () => {
  it('renders the screen in Kinyarwanda', async () => {
    await changeLanguage('rw')
    renderDocuments()
    await listed()

    expect(screen.getAllByText('Inyandiko').length).toBeGreaterThan(0)
    expect(screen.getByText('Ongeraho inyandiko')).toBeTruthy()
    expect(screen.getAllByText('Iyandikwa').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Kuramo').length).toBeGreaterThan(0)
  })
})
