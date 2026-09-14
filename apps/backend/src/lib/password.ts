import argon2 from 'argon2'
import { checkPassword, MIN_PASSWORD_LENGTH, type PasswordProblem } from '@coopmanage/shared'
import { isTest } from '../config/env.js'
import { AppError } from './errors.js'

/**
 * Argon2id with tuned cost. One hash per password with its own salt, which `argon2` generates;
 * there is no shared salt and no pepper to lose.
 *
 * 19 MiB and three passes is the parameter set RFC 9106 recommends for a memory-constrained
 * server, which is what a cooperative's hosting budget buys. Raising it later is safe: the cost is
 * encoded in the stored hash, so old hashes keep verifying and are re-hashed on next login.
 */
export const PRODUCTION_HASH_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 3,
  parallelism: 1,
} as const

/**
 * The suite signs hundreds of sessions in, and the cost is deliberate work: thirteen test files
 * run in parallel worker processes and each hash asks for 19 MiB and three passes over it, which
 * on an eight-core machine is enough contention to push an ordinary test past a five-second
 * timeout. The failures that produced looked like anything but their cause, appearing in a
 * different file on each run.
 *
 * The minimum the library accepts is used instead, and only under NODE_ENV=test. The parameter set
 * everything else uses is asserted in `password.test.ts`, so weakening this cannot leak into a
 * deployment without that test failing.
 */
const HASH_OPTIONS = isTest
  ? ({ type: argon2.argon2id, memoryCost: 8, timeCost: 1, parallelism: 1 } as const)
  : PRODUCTION_HASH_OPTIONS

export async function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, HASH_OPTIONS)
}

/**
 * Never throws on a malformed stored hash. A corrupt row must read as "wrong password" rather than
 * as a 500 that tells an attacker they found an interesting account.
 */
export async function verifyPassword(hash: string, plain: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, plain)
  } catch {
    return false
  }
}

/**
 * True when the stored hash was not made with the parameters in force, in either direction. That
 * is what the library reports, and in a deployment the options are fixed, so any mismatch is a
 * hash from an older setting and is replaced at the owner's next sign-in.
 */
export function needsRehash(hash: string): boolean {
  try {
    return argon2.needsRehash(hash, HASH_OPTIONS)
  } catch {
    return true
  }
}

const PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  tooShort: `Choose a password of at least ${MIN_PASSWORD_LENGTH} characters.`,
  tooLong: 'That password is too long.',
  tooCommon: 'That password is too easy to guess. Choose something less common.',
}

/**
 * Re-checks the rule the interface already applied, because no frontend check is trusted. The
 * field name is passed in so the error lands on the right input on whichever form called.
 */
export function assertPasswordAcceptable(password: string, field: string): void {
  const problem = checkPassword(password)
  if (!problem) return
  throw new AppError({
    status: 422,
    code: 'VALIDATION_FAILED',
    messageKey: `validation.password.${problem}`,
    messageParams: { min: MIN_PASSWORD_LENGTH },
    message: PROBLEM_MESSAGES[problem],
    details: [
      {
        field,
        messageKey: `validation.password.${problem}`,
        messageParams: { min: MIN_PASSWORD_LENGTH },
      },
    ],
  })
}

/**
 * A hash of a password nobody holds. Verifying against it when the email is unknown keeps the
 * response time of a failed login the same whether or not the account exists, so login cannot be
 * used to discover which addresses are registered.
 */
export const DUMMY_PASSWORD_HASH = await hashPassword(
  'timing-equalisation-only-never-a-real-password',
)
