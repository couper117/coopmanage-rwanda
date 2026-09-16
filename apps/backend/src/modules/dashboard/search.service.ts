import type { PermissionKey } from '@coopmanage/shared'
import type { RequestContext } from '../../lib/context.js'
import { AppError } from '../../lib/errors.js'
import { toWire, fromDatabase } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'

/**
 * Search across the cooperative.
 *
 * Two rules, and the first is the one that matters.
 *
 * **A resource the caller may not read is never queried.** Not filtered out of the results, not
 * ranked down — not asked for at all. Filtering after the fact is how a search box becomes the way
 * to find out that a member called Mukamana exists, or that a document is named "Disciplinary
 * letter", without ever being allowed to open either. So the permission is checked before the
 * query is built, and the tenant is in every `where` clause beside it.
 *
 * **Ranking is by how well the term matches, then by recency.** A member whose code is exactly what
 * was typed comes before one whose name merely contains it, because somebody typing `UMU-00042` has
 * a particular person in mind. Within a kind, the most recent wins, because the thing somebody is
 * looking for is far more often the thing that just happened.
 */

export interface SearchHit {
  kind: 'member' | 'product' | 'buyer' | 'sale' | 'document' | 'meeting'
  id: string
  title: string
  /** The second line: a code, a date, a state. Never a sentence. */
  subtitle: string | null
  href: string
  /** Higher is better. Exposed so the interface can group by kind without losing the order. */
  score: number
}

export interface SearchResults {
  query: string
  hits: SearchHit[]
  /** Kinds this reader's role does not cover, so the interface can say so rather than imply none. */
  withheld: string[]
  /** True when a kind had more matches than were returned. */
  truncated: boolean
}

/** How many of each kind, so one noisy resource cannot crowd out the rest. */
const PER_KIND = 5

function can(ctx: RequestContext, permission: PermissionKey): boolean {
  return ctx.permissions.has(permission)
}

/**
 * How well a row matches.
 *
 * An exact code beats a prefix beats a substring. The numbers are arbitrary but their order is not:
 * somebody who types a member number wants that member, not the forty whose notes mention it.
 */
function score(term: string, ...fields: (string | null | undefined)[]): number {
  const needle = term.toLowerCase()
  let best = 0
  for (const field of fields) {
    if (!field) continue
    const value = field.toLowerCase()
    if (value === needle) best = Math.max(best, 100)
    else if (value.startsWith(needle)) best = Math.max(best, 70)
    else if (value.includes(needle)) best = Math.max(best, 40)
  }
  return best
}

export async function search(ctx: RequestContext, query: string): Promise<SearchResults> {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()

  const term = query.trim()
  const withheld: string[] = []
  if (term.length === 0) return { query: term, hits: [], withheld, truncated: false }

  const contains = { contains: term, mode: 'insensitive' as const }
  const scope = { cooperativeId }

  // Only the resources this reader may see are asked for. A kind they may not see is named in
  // `withheld` so the interface can say "not searched" rather than leave them to conclude there
  // are no results.
  const wanted = {
    member: can(ctx, 'members:view'),
    product: can(ctx, 'products:view'),
    buyer: can(ctx, 'buyers:view'),
    sale: can(ctx, 'sales:view'),
    document: can(ctx, 'documents:view'),
    meeting: can(ctx, 'meetings:view'),
  }
  for (const [kind, allowed] of Object.entries(wanted)) {
    if (!allowed) withheld.push(kind)
  }

  const [members, products, buyers, sales, documents, meetings] = await Promise.all([
    wanted.member
      ? prisma.member.findMany({
          where: {
            ...scope,
            OR: [
              { memberCode: contains },
              { firstName: contains },
              { lastName: contains },
              { phone: contains },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND + 1,
          select: {
            id: true,
            memberCode: true,
            firstName: true,
            lastName: true,
            phone: true,
            status: true,
          },
        })
      : [],
    wanted.product
      ? prisma.product.findMany({
          where: { ...scope, OR: [{ sku: contains }, { name: contains }, { nameRw: contains }] },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND + 1,
          select: { id: true, sku: true, name: true, nameRw: true, isActive: true },
        })
      : [],
    wanted.buyer
      ? prisma.buyer.findMany({
          where: {
            ...scope,
            OR: [{ name: contains }, { organization: contains }, { phone: contains }],
          },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND + 1,
          select: { id: true, name: true, organization: true, isActive: true },
        })
      : [],
    wanted.sale
      ? prisma.sale.findMany({
          where: { ...scope, OR: [{ reference: contains }, { buyer: { name: contains } }] },
          orderBy: { saleDate: 'desc' },
          take: PER_KIND + 1,
          select: {
            id: true,
            reference: true,
            total: true,
            status: true,
            saleDate: true,
            buyer: { select: { name: true } },
          },
        })
      : [],
    wanted.document
      ? prisma.document.findMany({
          where: {
            ...scope,
            // The same visibility rule the documents module applies. A restricted paper is not
            // findable by somebody who may not open it: the existence of a member's medical letter
            // is itself the sensitive part.
            ...(can(ctx, 'documents:archive')
              ? {}
              : { OR: [{ visibility: 'COOPERATIVE' as const }, { uploadedById: ctx.user.id }] }),
            AND: [
              {
                OR: [
                  { title: contains },
                  { fileName: contains },
                  { tags: { has: term.toLowerCase() } },
                ],
              },
            ],
          },
          orderBy: { createdAt: 'desc' },
          take: PER_KIND + 1,
          select: { id: true, title: true, fileName: true, category: true, isArchived: true },
        })
      : [],
    wanted.meeting
      ? prisma.meeting.findMany({
          where: {
            ...scope,
            OR: [{ reference: contains }, { title: contains }, { location: contains }],
          },
          orderBy: { scheduledFor: 'desc' },
          take: PER_KIND + 1,
          select: { id: true, reference: true, title: true, status: true, scheduledFor: true },
        })
      : [],
  ])

  let truncated = false
  const trim = <T>(rows: T[]): T[] => {
    if (rows.length > PER_KIND) truncated = true
    return rows.slice(0, PER_KIND)
  }

  const hits: SearchHit[] = [
    ...trim(members).map((row) => ({
      kind: 'member' as const,
      id: row.id,
      title: `${row.lastName} ${row.firstName}`,
      subtitle: row.memberCode,
      href: `/members/${row.id}`,
      score: score(term, row.memberCode, row.firstName, row.lastName, row.phone),
    })),
    ...trim(products).map((row) => ({
      kind: 'product' as const,
      id: row.id,
      title: row.name,
      subtitle: row.sku,
      href: `/inventory/products`,
      score: score(term, row.sku, row.name, row.nameRw),
    })),
    ...trim(buyers).map((row) => ({
      kind: 'buyer' as const,
      id: row.id,
      title: row.name,
      subtitle: row.organization,
      href: `/buyers/${row.id}`,
      score: score(term, row.name, row.organization),
    })),
    ...trim(sales).map((row) => ({
      kind: 'sale' as const,
      id: row.id,
      title: row.reference,
      subtitle: `${row.buyer.name} · ${toWire(fromDatabase(row.total))}`,
      href: `/sales/${row.id}`,
      score: score(term, row.reference, row.buyer.name),
    })),
    ...trim(documents).map((row) => ({
      kind: 'document' as const,
      id: row.id,
      title: row.title,
      subtitle: row.fileName,
      href: `/documents`,
      score: score(term, row.title, row.fileName),
    })),
    ...trim(meetings).map((row) => ({
      kind: 'meeting' as const,
      id: row.id,
      title: row.title,
      subtitle: row.reference,
      href: `/meetings/${row.id}`,
      score: score(term, row.reference, row.title),
    })),
  ]

  // Best match first; the per-kind queries already ordered by recency, and a stable sort keeps
  // that order within an equal score.
  hits.sort((a, b) => b.score - a.score)

  return { query: term, hits, withheld, truncated }
}
