import { createHash } from 'node:crypto'
import type { Request } from 'express'
import { HEADERS } from '@coopmanage/shared'
import type { RequestContext } from './context.js'
import { isUniqueViolation } from './dbErrors.js'
import { AppError } from './errors.js'
import { logger } from './logger.js'
import { prisma } from './prisma.js'

/**
 * Safe retries for the requests where a repeat would cost real money.
 *
 * The situation this exists for is ordinary and unavoidable: a treasurer on a slow connection in a
 * district office presses "Record" and the page hangs. They press it again. Without this, the
 * cooperative's books now hold the same 50,000 francs twice, and somebody has to work out which
 * of two identical entries is the real one.
 *
 * The client sends `Idempotency-Key` with a value it keeps for the life of one attempt. The first
 * request through claims the key and runs; a repeat of the same request gets the first one's
 * response back without doing the work again. A *different* request reusing the key is a client
 * bug that would otherwise be answered with somebody else's receipt, so it is refused outright.
 *
 * Deliberately not a cache. The stored response is keyed to the cooperative, the user and a hash
 * of the request, and it expires, because its only job is to make a retry safe rather than to make
 * a repeat fast.
 */

/** How long a key is honoured. Long enough for a retry, short enough not to become a store. */
const RETENTION_HOURS = 24

export interface IdempotentResult<T> {
  data: T
  status: number
  /** True when this response came from the stored first attempt rather than from fresh work. */
  replayed: boolean
}

function hashRequest(req: Request): string {
  // The method and path are part of the hash, so the same key on a different endpoint is caught
  // as reuse rather than replaying an unrelated response.
  const body: unknown = req.body
  const payload = JSON.stringify({
    method: req.method,
    path: req.originalUrl.split('?')[0],
    body: body ?? null,
  })
  return createHash('sha256').update(payload).digest('hex')
}

export function idempotencyKeyOf(req: Request): string | null {
  const raw = req.header(HEADERS.idempotencyKey)
  if (!raw) return null
  const key = raw.trim()
  if (key.length === 0) return null
  if (key.length > 200) {
    throw AppError.validationFailed([
      { field: `header.${HEADERS.idempotencyKey}`, messageKey: 'validation.too_big' },
    ])
  }
  return key
}

/**
 * Runs `work` at most once per key.
 *
 * The claim is an insert, not a read followed by an insert: two requests arriving together would
 * both pass a check and both do the work. The unique constraint on `(cooperative_id, key)` is what
 * actually decides which one goes first, and the loser reads what the winner stored.
 */
export async function withIdempotency<T>(
  req: Request,
  ctx: RequestContext,
  endpoint: string,
  status: number,
  work: () => Promise<T>,
): Promise<IdempotentResult<T>> {
  const key = idempotencyKeyOf(req)
  if (!key) {
    // No key means the caller is not asking for a safe retry, and inventing one would make a
    // deliberate second entry impossible. Two identical contributions on the same day are a
    // normal thing for a cooperative to record.
    return { data: await work(), status, replayed: false }
  }

  const cooperativeId = ctx.cooperative?.id
  if (!cooperativeId) throw AppError.noCooperativeAccess()

  const requestHash = hashRequest(req)
  const expiresAt = new Date(Date.now() + RETENTION_HOURS * 60 * 60 * 1000)

  let claimed = true
  await prisma.idempotencyKey
    .create({
      data: {
        cooperativeId,
        userId: ctx.user.id,
        key,
        endpoint,
        requestHash,
        state: 'IN_PROGRESS',
        expiresAt,
      },
      select: { id: true },
    })
    .catch((error: unknown) => {
      if (isUniqueViolation(error, 'key', 'cooperative_id')) {
        claimed = false
        return
      }
      throw error
    })

  if (claimed) {
    let data: T
    try {
      data = await work()
    } catch (error) {
      // The work failed, so nothing was recorded and the key is holding a claim over nothing. A
      // user who fixes the category and presses Record again sends the same key, and leaving the
      // claim in place would answer that with "still being processed" for the next 24 hours.
      // Releasing it lets the corrected request through, which is the only useful behaviour.
      await prisma.idempotencyKey
        .delete({ where: { cooperativeId_key: { cooperativeId, key } } })
        .catch((cleanupError: unknown) => {
          logger.error({ err: cleanupError, key }, 'could not release a failed idempotency claim')
        })
      throw error
    }

    await prisma.idempotencyKey
      .update({
        where: { cooperativeId_key: { cooperativeId, key } },
        data: { state: 'COMPLETED', responseStatus: status, responseBody: data as never },
      })
      .catch((error: unknown) => {
        // The work is done and committed. Failing to record that would turn a successful entry
        // into an error the client retries, which is the opposite of what this function is for.
        logger.error({ err: error, key }, 'could not store an idempotent response')
      })
    return { data, status, replayed: false }
  }

  return replay<T>(cooperativeId, key, requestHash)
}

async function replay<T>(
  cooperativeId: string,
  key: string,
  requestHash: string,
): Promise<IdempotentResult<T>> {
  const existing = await prisma.idempotencyKey.findUnique({
    where: { cooperativeId_key: { cooperativeId, key } },
    select: {
      requestHash: true,
      state: true,
      responseStatus: true,
      responseBody: true,
      expiresAt: true,
    },
  })

  // Expired, or removed between the failed insert and this read. Treating it as absent is wrong —
  // the first attempt may have succeeded — so the caller is told to use a fresh key.
  if (!existing || existing.expiresAt <= new Date()) {
    throw AppError.conflict(
      'errors.idempotency.expired',
      'That retry key is no longer held. Check whether the entry was recorded, then use a new key.',
    )
  }

  if (existing.requestHash !== requestHash) {
    throw new AppError({
      status: 409,
      code: 'IDEMPOTENCY_KEY_REUSED',
      messageKey: 'errors.idempotency.reused',
      message: 'That retry key has already been used for a different request.',
    })
  }

  if (existing.state === 'IN_PROGRESS' || existing.responseBody === null) {
    // The first attempt is still running. Answering now would mean guessing what it will return.
    throw AppError.conflict(
      'errors.idempotency.inProgress',
      'That request is still being processed. Please wait a moment and check the result.',
    )
  }

  return {
    data: existing.responseBody as T,
    status: existing.responseStatus ?? 200,
    replayed: true,
  }
}
