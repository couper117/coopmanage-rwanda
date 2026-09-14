import type { RequestContext } from '../../lib/context.js'
import { logger } from '../../lib/logger.js'
import { toWire } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'

/**
 * The low-stock watch.
 *
 * A cooperative runs out of fertiliser in the middle of planting and nobody notices until a member
 * asks for it. This raises a notification the moment a movement takes a product to or below the
 * minimum somebody set for it, so the storekeeper is told rather than having to remember to look.
 *
 * Two rules keep it from becoming noise, which is the only way an alert stops being read.
 *
 * It raises **one** notification per product, not one per scan: `(cooperative_id, dedupe_key)` is
 * unique and the key names the product, so running the watch after every movement cannot pile up
 * duplicates. And when a receipt brings the level back above the minimum the notification is
 * **removed**, so the next dip raises a fresh one. Removing rather than marking it read is
 * deliberate: an alert that has been resolved is not history a cooperative needs, and leaving the
 * row would hold the key and silence the warning for good.
 *
 * Phase 12 builds the notification centre. This phase only writes the rows.
 */

function dedupeKeyFor(productId: string): string {
  return `low-stock:${productId}`
}

/**
 * Reviews the products a movement touched and brings their notifications into line.
 *
 * Failures are logged and swallowed. A storekeeper's receipt must not fail because an alert could
 * not be written; the stock is recorded and the watch will catch it on the next movement or on the
 * next scheduled scan.
 */
export async function reviewLowStock(ctx: RequestContext, productIds: string[]): Promise<void> {
  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId || productIds.length === 0) return

  try {
    await reviewProducts(cooperativeId, productIds)
  } catch (error) {
    logger.error({ err: error, productIds }, 'could not review low stock')
  }
}

/**
 * The whole catalogue, for a scheduled run.
 *
 * Reads only the products that asked to be watched, which the partial index in M6 is there for,
 * and returns what it changed so the job that calls it can say something useful in a log.
 */
export async function scanLowStock(
  cooperativeId: string,
): Promise<{ raised: number; cleared: number }> {
  const watched = await prisma.product.findMany({
    where: {
      cooperativeId,
      isActive: true,
      trackInventory: true,
      minStockLevel: { not: null },
    },
    select: { id: true },
  })
  return reviewProducts(
    cooperativeId,
    watched.map((row) => row.id),
  )
}

async function reviewProducts(
  cooperativeId: string,
  productIds: string[],
): Promise<{ raised: number; cleared: number }> {
  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      cooperativeId,
      isActive: true,
      trackInventory: true,
      minStockLevel: { not: null },
    },
    select: {
      id: true,
      name: true,
      sku: true,
      minStockLevel: true,
      unit: { select: { symbol: true } },
    },
  })
  if (products.length === 0) return { raised: 0, cleared: 0 }

  // The level is the total across every store: a cooperative with fertiliser in the second store
  // has not run out, and warning it would teach the storekeeper to ignore the warnings.
  const totals = await prisma.stockLevel.groupBy({
    by: ['productId'],
    where: { cooperativeId, productId: { in: products.map((row) => row.id) } },
    _sum: { quantity: true },
  })
  const held = new Map(totals.map((row) => [row.productId, row._sum.quantity]))

  let raised = 0
  let cleared = 0

  for (const product of products) {
    const minimum = product.minStockLevel
    if (minimum === null) continue
    const quantity = held.get(product.id)
    const level = quantity ?? null

    // A product that has never been in the store has no level to compare. Warning that the
    // cooperative is short of something it has never stocked would be noise on day one.
    if (level === null) continue

    const isLow = level.lte(minimum)
    const dedupeKey = dedupeKeyFor(product.id)

    if (isLow) {
      const isEmpty = level.isZero()
      const severity = isEmpty ? 'CRITICAL' : 'WARNING'
      const messageKey = isEmpty ? 'notifications.lowStock.empty' : 'notifications.lowStock.low'
      const messageParams = {
        product: product.name,
        sku: product.sku,
        quantity: toWire(level, 3),
        minimum: toWire(minimum, 3),
        unit: product.unit.symbol,
      }

      const existing = await prisma.notification.findUnique({
        where: { cooperativeId_dedupeKey: { cooperativeId, dedupeKey } },
        select: { id: true, severity: true, readAt: true },
      })

      if (!existing) {
        await prisma.notification.create({
          data: {
            cooperativeId,
            // Null means every member of staff, which is what a store warning is for.
            userId: null,
            type: 'LOW_STOCK',
            severity,
            messageKey,
            messageParams,
            entityType: 'Product',
            entityId: product.id,
            actionUrl: `/inventory/products/${product.id}`,
            dedupeKey,
          },
        })
        raised += 1
        continue
      }

      // Running low and having run out are different situations, and the second is the one that
      // stops the cooperative selling at all. An alert that stayed at "low" after the shelf went
      // empty would understate what happened, so the severity escalates and the alert resurfaces
      // as unread — but only when it has genuinely got worse, never on every movement.
      const escalated = existing.severity !== severity && severity === 'CRITICAL'
      await prisma.notification.update({
        where: { id: existing.id },
        data: {
          severity,
          messageKey,
          messageParams,
          ...(escalated ? { createdAt: new Date(), readAt: null } : {}),
        },
      })
      if (escalated) raised += 1
      continue
    }

    const removed = await prisma.notification.deleteMany({
      where: { cooperativeId, dedupeKey, type: 'LOW_STOCK' },
    })
    cleared += removed.count
  }

  return { raised, cleared }
}
