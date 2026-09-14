import type { Prisma } from '@prisma/client'
import { AppError } from '../../lib/errors.js'
import { type Money } from '../../lib/money.js'

/**
 * The two operations every stock movement is built from.
 *
 * `StockLevel` is a running balance and a cache of `InventoryTransaction`; it is never the source
 * of truth, and `rebuild.ts` recomputes it from the history to prove so. But it has to be exactly
 * right while it is being used, because it is what the interface shows and what a sale checks
 * before it goes out.
 *
 * Both functions take the caller's transaction client rather than opening their own. A level that
 * moved without a movement row, or a movement row without the level moving, is the one failure
 * this whole module exists to prevent.
 */

export interface StockKey {
  cooperativeId: string
  productId: string
  warehouseId: string
}

/**
 * Adds stock.
 *
 * An upsert rather than a read followed by a write: the first receipt of a product into a
 * warehouse has no row yet, and two receipts arriving together would otherwise both find nothing
 * and both insert. The unique constraint on `(product_id, warehouse_id)` is what actually decides,
 * and `ON CONFLICT` turns the loser into an increment instead of an error.
 */
export async function increaseStock(
  db: Prisma.TransactionClient,
  key: StockKey,
  quantity: Money,
): Promise<void> {
  await db.$executeRaw`
    INSERT INTO stock_levels (id, cooperative_id, product_id, warehouse_id, quantity, updated_at)
    VALUES (
      gen_random_uuid(),
      ${key.cooperativeId}::uuid,
      ${key.productId}::uuid,
      ${key.warehouseId}::uuid,
      ${quantity.toString()}::numeric,
      now()
    )
    ON CONFLICT (product_id, warehouse_id)
    DO UPDATE SET quantity = stock_levels.quantity + ${quantity.toString()}::numeric,
                  updated_at = now()
  `
}

/**
 * Takes stock out, or refuses.
 *
 * This is the single most important statement in the module. The condition and the write are one
 * statement, so there is no moment between checking that there are ten sacks and taking ten sacks
 * in which somebody else can take them. Twenty simultaneous issues against a stock of ten produce
 * ten movements and ten refusals, and never a negative balance.
 *
 * A missing row means the product has never been in this warehouse, which is the same answer as a
 * quantity of nothing: an affected-row count of zero either way.
 */
export async function decreaseStock(
  db: Prisma.TransactionClient,
  key: StockKey,
  quantity: Money,
): Promise<void> {
  const affected = await db.$executeRaw`
    UPDATE stock_levels
       SET quantity = quantity - ${quantity.toString()}::numeric,
           updated_at = now()
     WHERE product_id = ${key.productId}::uuid
       AND warehouse_id = ${key.warehouseId}::uuid
       AND quantity >= ${quantity.toString()}::numeric
  `

  if (affected === 0) throw insufficientStock()
}

/**
 * What the caller is told when there is not enough.
 *
 * Deliberately does not say how much there is. The figure the caller read a moment ago may already
 * be wrong — that is the whole reason the check happens inside the write — and quoting a number
 * that is stale by the time it is read would invite the user to try again with exactly that
 * number. The interface reloads the level and shows what is there now.
 */
export function insufficientStock(): AppError {
  return new AppError({
    status: 409,
    code: 'INSUFFICIENT_STOCK',
    messageKey: 'errors.inventory.insufficientStock',
    message: 'There is not enough of that in the store. Check the quantity and try again.',
  })
}
