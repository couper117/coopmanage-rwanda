import { describe, expect, it } from 'vitest'
import { formatMoney, formatQuantity, isValidDecimal, parseFormattedNumber } from '../src/format.js'

describe('formatMoney', () => {
  it('prints whole francs without decimals', () => {
    expect(formatMoney('250000.00')).toBe('250,000 RWF')
    expect(formatMoney('0.00')).toBe('0 RWF')
    expect(formatMoney('999.00')).toBe('999 RWF')
    expect(formatMoney('1000.00')).toBe('1,000 RWF')
  })

  it('keeps decimals when the stored value is not whole', () => {
    expect(formatMoney('250000.50')).toBe('250,000.5 RWF')
    expect(formatMoney('0.05')).toBe('0.05 RWF')
  })

  it('groups large amounts correctly', () => {
    expect(formatMoney('1234567890.00')).toBe('1,234,567,890 RWF')
  })

  it('formats exactly beyond the safe integer range', () => {
    expect(formatMoney('9007199254740993.00')).toBe('9,007,199,254,740,993 RWF')
  })

  it('handles negatives and negative zero', () => {
    expect(formatMoney('-1500.00')).toBe('-1,500 RWF')
    expect(formatMoney('-0.00')).toBe('0 RWF')
  })

  it('can omit the currency', () => {
    expect(formatMoney('250000.00', { withCurrency: false })).toBe('250,000')
  })

  it('rejects anything that is not a decimal string', () => {
    expect(() => formatMoney('abc')).toThrow()
    expect(() => formatMoney('1e5')).toThrow()
    expect(() => formatMoney('')).toThrow()
  })
})

describe('formatQuantity', () => {
  it('trims trailing zeros and appends the unit', () => {
    expect(formatQuantity('1240.500', 'kg')).toBe('1,240.5 kg')
    expect(formatQuantity('150.000', 'units')).toBe('150 units')
    expect(formatQuantity('0.125', 'litres')).toBe('0.125 litres')
  })

  it('works without a unit', () => {
    expect(formatQuantity('2450.000')).toBe('2,450')
  })
})

describe('parseFormattedNumber', () => {
  it('strips grouping separators', () => {
    expect(parseFormattedNumber('1,234,567')).toBe('1234567')
    expect(parseFormattedNumber(' 250,000.50 ')).toBe('250000.50')
  })
})

describe('isValidDecimal', () => {
  it('accepts values within scale', () => {
    expect(isValidDecimal('250000.00', 2)).toBe(true)
    expect(isValidDecimal('250000', 2)).toBe(true)
    expect(isValidDecimal('1240.500', 3)).toBe(true)
  })

  it('rejects values beyond scale so nothing is silently rounded', () => {
    expect(isValidDecimal('250000.005', 2)).toBe(false)
    expect(isValidDecimal('1.0001', 3)).toBe(false)
  })

  it('rejects non-decimal input', () => {
    expect(isValidDecimal('1,000', 2)).toBe(false)
    expect(isValidDecimal('abc', 2)).toBe(false)
  })
})
