import { describe, expect, it } from 'vitest'
import { checkPassword, MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '../src/auth.js'

/**
 * The password rule is checked twice — once in the interface so somebody learns why their choice
 * was refused before they submit it, and again in the API because no frontend check is trusted.
 * Both read this function, so this is the only place the rule needs testing.
 */
describe('password policy', () => {
  it('accepts a long passphrase made of ordinary words', () => {
    expect(checkPassword('umusaruro wacu wa 2026')).toBeNull()
    expect(checkPassword('correct horse battery staple')).toBeNull()
  })

  it('refuses anything shorter than the minimum', () => {
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1))).toBe('tooShort')
    expect(checkPassword('a'.repeat(MIN_PASSWORD_LENGTH))).not.toBe('tooShort')
  })

  it('refuses a password long enough to be a denial-of-service on the hash', () => {
    expect(checkPassword('a'.repeat(MAX_PASSWORD_LENGTH + 1))).toBe('tooLong')
  })

  it('refuses the passwords an attacker tries first, whatever the casing', () => {
    expect(checkPassword('password123')).toBe('tooCommon')
    expect(checkPassword('PassWord123')).toBe('tooCommon')
    expect(checkPassword('  coopmanage  ')).toBe('tooCommon')
  })

  it('imposes no composition rule', () => {
    // A rule demanding a capital, a digit and a symbol is what produces `Password1!`, which is on
    // every cracking list. Length and a common-password check do more for less irritation.
    expect(checkPassword('aaaaaaaaaaaaaaaaab')).toBeNull()
    expect(checkPassword('inzira ndende cyane')).toBeNull()
  })
})
