import type { Prisma } from '@prisma/client'

/**
 * Human-readable references.
 *
 * A cooperative works on paper as well as on screen. A member is `COOP-00452` on a card, a receipt
 * says `IN-2026-000123`, and somebody reads those aloud down a phone line. The primary key stays a
 * UUID, which is unguessable and safe in a URL; these are the readable handle beside it.
 *
 * Allocation is the interesting part. Every sequence is per cooperative, and every one is taken by
 * an atomic increment inside the caller's transaction, so two people registering a member at the
 * same moment cannot be handed the same code. Reading the current value and adding one would be a
 * check followed by an act, which is the same mistake that let two refresh tokens be minted from
 * one family in Phase 2.
 */

/** The subset of the client that a transaction and the base client both satisfy. */
export type Db = Prisma.TransactionClient

/**
 * Allocates the next member code for a cooperative, for example `COOP-00452`.
 *
 * `UPDATE ... RETURNING` is one statement, so the read and the write cannot be separated by
 * another transaction. The row lock it takes is released when the caller's transaction ends.
 */
export async function nextMemberCode(db: Db, cooperativeId: string): Promise<string> {
  const rows = await db.$queryRaw<{ member_code_prefix: string; member_code_sequence: number }[]>`
    UPDATE cooperatives
       SET member_code_sequence = member_code_sequence + 1
     WHERE id = ${cooperativeId}::uuid
    RETURNING member_code_prefix, member_code_sequence
  `
  const row = rows[0]
  if (!row) throw new Error(`Cooperative ${cooperativeId} not found while allocating a member code`)
  return `${row.member_code_prefix}-${String(row.member_code_sequence).padStart(5, '0')}`
}

/** `IN` for money coming in, `EX` for money going out. */
export type FinancePrefix = 'IN' | 'EX'

/**
 * Allocates the next finance reference, for example `IN-2026-000123`.
 *
 * The year is part of the reference because that is how a cooperative files paper, and the counter
 * is scoped to the cooperative and the year so it restarts each January rather than growing
 * forever. The count is taken with a lock on the cooperative row, which serialises allocation for
 * that cooperative and nobody else.
 */
export async function nextFinanceReference(
  db: Db,
  cooperativeId: string,
  prefix: FinancePrefix,
  occurredAt: Date,
): Promise<string> {
  const year = occurredAt.getUTCFullYear()

  // Locks this cooperative's row for the rest of the caller's transaction, so two concurrent
  // postings serialise here rather than racing to the same number.
  await db.$executeRaw`SELECT id FROM cooperatives WHERE id = ${cooperativeId}::uuid FOR UPDATE`

  const rows = await db.$queryRaw<{ used: bigint }[]>`
    SELECT count(*) AS used
      FROM finance_transactions
     WHERE cooperative_id = ${cooperativeId}::uuid
       AND reference LIKE ${`${prefix}-${year}-%`}
  `
  const used = Number(rows[0]?.used ?? 0)
  return `${prefix}-${year}-${String(used + 1).padStart(6, '0')}`
}

export function financePrefixFor(kind: 'INCOME' | 'EXPENSE'): FinancePrefix {
  return kind === 'INCOME' ? 'IN' : 'EX'
}

/**
 * Allocates the next stock movement reference, for example `STK-2026-000318`.
 *
 * Same shape and same guarantee as a finance reference: the year is part of it because that is how
 * a cooperative files paper, and the counter is scoped to the cooperative and the year so it
 * restarts each January. The lock on the cooperative row serialises allocation for that
 * cooperative and nobody else, which is also what makes twenty simultaneous issues against ten
 * sacks resolve to ten and ten rather than to a race.
 */
export async function nextInventoryReference(
  db: Db,
  cooperativeId: string,
  occurredAt: Date,
): Promise<string> {
  const year = occurredAt.getUTCFullYear()

  await db.$executeRaw`SELECT id FROM cooperatives WHERE id = ${cooperativeId}::uuid FOR UPDATE`

  const rows = await db.$queryRaw<{ used: bigint }[]>`
    SELECT count(*) AS used
      FROM inventory_transactions
     WHERE cooperative_id = ${cooperativeId}::uuid
       AND reference LIKE ${`STK-${year}-%`}
  `
  const used = Number(rows[0]?.used ?? 0)
  return `STK-${year}-${String(used + 1).padStart(6, '0')}`
}

/** Allocates the next sale reference, for example `SL-2026-000045`. */
export async function nextSaleReference(
  db: Db,
  cooperativeId: string,
  saleDate: Date,
): Promise<string> {
  const year = saleDate.getUTCFullYear()

  await db.$executeRaw`SELECT id FROM cooperatives WHERE id = ${cooperativeId}::uuid FOR UPDATE`

  const rows = await db.$queryRaw<{ used: bigint }[]>`
    SELECT count(*) AS used
      FROM sales
     WHERE cooperative_id = ${cooperativeId}::uuid
       AND reference LIKE ${`SL-${year}-%`}
  `
  const used = Number(rows[0]?.used ?? 0)
  return `SL-${year}-${String(used + 1).padStart(6, '0')}`
}
