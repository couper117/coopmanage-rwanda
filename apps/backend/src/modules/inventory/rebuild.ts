import { toWire, type Money } from '../../lib/money.js'
import { prisma } from '../../lib/prisma.js'

/**
 * Rebuilding the running balances from the movement history.
 *
 * `StockLevel` is a cache. Every screen reads it, every sale checks it, and the whole module is
 * built so that it can never drift — but "can never drift" is a claim, and this is what makes it
 * checkable. The levels are recomputed from `InventoryTransaction`, which is immutable, and any
 * disagreement is reported rather than silently papered over.
 *
 * Run as a command after a restore, after a migration that touched these tables, or whenever
 * somebody has reason to doubt a figure. A Phase 6 test runs it against a database full of
 * movements and asserts it changes nothing, which is the exit criterion for this phase.
 */

export interface RebuildDifference {
  productId: string
  warehouseId: string
  sku: string
  productName: string
  warehouseName: string
  /** What the cache said. */
  stored: string
  /** What the history adds up to. */
  computed: string
}

export interface RebuildReport {
  /** Product and warehouse pairs the history knows about. */
  pairs: number
  differences: RebuildDifference[]
  /** True only when every stored level already matched the history. */
  agrees: boolean
}

/**
 * Computes what every level should be, and compares.
 *
 * `apply` is deliberately separate from the comparison. Reading the report is how somebody finds
 * out that something is wrong; writing the correction is a decision, and a command that silently
 * fixed a discrepancy would destroy the evidence of whatever caused it.
 */
export async function rebuildStockLevels(
  cooperativeId: string,
  options: { apply?: boolean } = {},
): Promise<RebuildReport> {
  // Summed in the database, over the immutable history, in `numeric` the whole way. A reversal is
  // a movement of its own with its own direction, so it is counted like any other: nothing here
  // needs to know which rows correct which.
  const computed = await prisma.$queryRaw<
    {
      product_id: string
      warehouse_id: string
      quantity: Money
      sku: string
      product_name: string
      warehouse_name: string
    }[]
  >`
    SELECT t.product_id,
           t.warehouse_id,
           sum(CASE WHEN t.direction = 'IN' THEN t.quantity ELSE -t.quantity END) AS quantity,
           p.sku,
           p.name AS product_name,
           w.name AS warehouse_name
      FROM inventory_transactions t
      JOIN products p ON p.id = t.product_id
      JOIN warehouses w ON w.id = t.warehouse_id
     WHERE t.cooperative_id = ${cooperativeId}::uuid
     GROUP BY t.product_id, t.warehouse_id, p.sku, p.name, w.name
  `

  const stored = await prisma.stockLevel.findMany({
    where: { cooperativeId },
    select: { productId: true, warehouseId: true, quantity: true },
  })
  const storedByKey = new Map(
    stored.map((row) => [`${row.productId}:${row.warehouseId}`, row.quantity]),
  )

  const differences: RebuildDifference[] = []

  for (const row of computed) {
    const key = `${row.product_id}:${row.warehouse_id}`
    const current = storedByKey.get(key)
    storedByKey.delete(key)

    if (current !== undefined && current.equals(row.quantity)) continue

    differences.push({
      productId: row.product_id,
      warehouseId: row.warehouse_id,
      sku: row.sku,
      productName: row.product_name,
      warehouseName: row.warehouse_name,
      stored: current === undefined ? 'missing' : toWire(current, 3),
      computed: toWire(row.quantity, 3),
    })

    if (options.apply) {
      await prisma.stockLevel.upsert({
        where: {
          productId_warehouseId: {
            productId: row.product_id,
            warehouseId: row.warehouse_id,
          },
        },
        create: {
          cooperativeId,
          productId: row.product_id,
          warehouseId: row.warehouse_id,
          quantity: row.quantity,
        },
        update: { quantity: row.quantity },
      })
    }
  }

  // Anything left is a level the history knows nothing about, which should be impossible: a level
  // is only ever created by a movement. Reported rather than ignored, because if it happens the
  // cause matters more than the number.
  for (const [key, quantity] of storedByKey) {
    const [productId = '', warehouseId = ''] = key.split(':')
    differences.push({
      productId,
      warehouseId,
      sku: '',
      productName: '',
      warehouseName: '',
      stored: toWire(quantity, 3),
      computed: 'no movements',
    })

    if (options.apply && quantity.isZero()) {
      await prisma.stockLevel.deleteMany({ where: { productId, warehouseId } })
    }
  }

  return { pairs: computed.length, differences, agrees: differences.length === 0 }
}
