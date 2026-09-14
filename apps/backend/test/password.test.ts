import argon2 from 'argon2'
import { describe, expect, it } from 'vitest'
import {
  hashPassword,
  needsRehash,
  PRODUCTION_HASH_OPTIONS,
  verifyPassword,
} from '../src/lib/password.js'

describe('password hashing', () => {
  /**
   * The suite runs argon2 at the library's minimum cost so that thirteen parallel worker
   * processes do not starve each other of CPU. This is the check that stops that reduction from
   * reaching a deployment: the parameters used everywhere except NODE_ENV=test are pinned here.
   */
  it('uses the parameter set RFC 9106 recommends for a memory-constrained server', () => {
    expect(PRODUCTION_HASH_OPTIONS.type).toBe(argon2.argon2id)
    expect(PRODUCTION_HASH_OPTIONS.memoryCost).toBe(19_456)
    expect(PRODUCTION_HASH_OPTIONS.timeCost).toBe(3)
  })

  it('never stores the password itself', async () => {
    const hash = await hashPassword('correct-horse-battery-staple')
    expect(hash).not.toContain('correct-horse')
    expect(hash.startsWith('$argon2id$')).toBe(true)
  })

  it('gives two identical passwords different hashes', async () => {
    const [first, second] = await Promise.all([hashPassword('same-one'), hashPassword('same-one')])
    // Each hash carries its own salt, so a stolen table cannot be attacked once for every account
    // that happens to share a password.
    expect(first).not.toBe(second)
  })

  it('verifies the right password and refuses the wrong one', async () => {
    const hash = await hashPassword('the-right-one')
    expect(await verifyPassword(hash, 'the-right-one')).toBe(true)
    expect(await verifyPassword(hash, 'the-wrong-one')).toBe(false)
  })

  it('reads a corrupt stored hash as a wrong password, not as a server fault', async () => {
    // A 500 here would tell an attacker they had found an interesting account.
    expect(await verifyPassword('not-a-hash', 'anything')).toBe(false)
    expect(await verifyPassword('', 'anything')).toBe(false)
  })

  it('leaves a hash alone when it was made with the parameters in force', async () => {
    const current = await hashPassword('legacy')
    expect(needsRehash(current)).toBe(false)
  })

  it('asks for a replacement when the stored parameters are not the current ones', async () => {
    // A hash carries the cost it was made with, so raising the parameters is safe: an old hash
    // keeps verifying and is replaced at the owner's next sign-in.
    const different = await argon2.hash('legacy', {
      ...PRODUCTION_HASH_OPTIONS,
      timeCost: PRODUCTION_HASH_OPTIONS.timeCost + 1,
    })
    expect(needsRehash(different)).toBe(true)
  })

  it('treats a stored hash it cannot read as one needing to be replaced', () => {
    expect(needsRehash('not-a-hash')).toBe(true)
  })
})
