import { describe, expect, it } from 'vitest'
import { formatRwandanPhone, isRwandanPhone, normalizeRwandanPhone } from '../src/phone.js'

/**
 * Staff type numbers the way they are written down, and the first version of this validator
 * refused `+250 788 123 456` because of where the spaces fell. These cases are the ones a
 * cooperative office actually produces.
 */
describe('normalizeRwandanPhone', () => {
  it('accepts every common way of writing the same number', () => {
    const expected = '+250788123456'
    for (const input of [
      '0788123456',
      '0788 123 456',
      '+250788123456',
      '+250 788 123 456',
      '+250-788-123-456',
      '250788123456',
      '250 788 123 456',
      '(0788) 123-456',
      ' 0788123456 ',
      '0788.123.456',
    ]) {
      expect(normalizeRwandanPhone(input), input).toBe(expected)
    }
  })

  it('accepts every mobile prefix in service', () => {
    for (const prefix of ['072', '073', '078', '079']) {
      expect(normalizeRwandanPhone(`${prefix}1234567`), prefix).not.toBeNull()
    }
  })

  it('treats nothing given as nothing given, not as an error', () => {
    expect(normalizeRwandanPhone('')).toBeNull()
    expect(normalizeRwandanPhone('   ')).toBeNull()
    expect(normalizeRwandanPhone(null)).toBeNull()
    expect(normalizeRwandanPhone(undefined)).toBeNull()
  })

  it('rejects what is not a Rwandan mobile number', () => {
    for (const input of [
      '12345',
      '078812345',
      '07881234567',
      '+254788123456',
      '0688123456',
      'not a number',
      '+250',
    ]) {
      expect(normalizeRwandanPhone(input), input).toBeNull()
    }
  })

  it('is idempotent, so re-saving a stored number changes nothing', () => {
    const once = normalizeRwandanPhone('0788123456')
    expect(normalizeRwandanPhone(once)).toBe(once)
  })
})

describe('isRwandanPhone', () => {
  it('agrees with the normaliser', () => {
    expect(isRwandanPhone('0788123456')).toBe(true)
    expect(isRwandanPhone('12345')).toBe(false)
    expect(isRwandanPhone('')).toBe(false)
  })
})

describe('formatRwandanPhone', () => {
  it('displays a stored number the way it is read aloud', () => {
    expect(formatRwandanPhone('+250788123456')).toBe('0788 123 456')
  })

  it('returns an empty string for a member with no phone, which is the common case', () => {
    expect(formatRwandanPhone(null)).toBe('')
    expect(formatRwandanPhone(undefined)).toBe('')
    expect(formatRwandanPhone('rubbish')).toBe('')
  })
})
