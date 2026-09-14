import { describe, expect, it } from 'vitest'
import { AppError } from '../src/lib/errors.js'
import {
  add,
  balanceOf,
  compare,
  Decimal,
  equals,
  isNegative,
  isPositive,
  isZero,
  max,
  MONEY_SCALE,
  multiply,
  parseMoney,
  parseQuantity,
  round,
  subtract,
  sum,
  toMoney,
  toWire,
  ZERO,
} from '../src/lib/money.js'

/**
 * The money module's own tests, which the roadmap makes a precondition for anything that writes a
 * monetary value. They are more thorough than the module is long, on purpose: this arithmetic is
 * what a cooperative's books rest on, and an error here is invisible until the figures stop
 * reconciling months later.
 */

describe('exactness', () => {
  it('adds the classic float failure exactly', () => {
    // 0.1 + 0.2 is 0.30000000000000004 in a float. A ledger summing thousands of rows
    // accumulates that error until it shows in a total.
    expect(add('0.1', '0.2').toString()).toBe('0.3')
  })

  it('stays exact over a long column of awkward values', () => {
    const values = Array.from({ length: 1000 }, () => '0.01')
    expect(sum(values).toString()).toBe('10')
  })

  it('handles amounts beyond the safe integer range', () => {
    expect(add('9007199254740993', '1').toString()).toBe('9007199254740994')
  })

  it('subtracts without drift', () => {
    expect(subtract('1000000.10', '0.10').toString()).toBe('1000000')
    expect(subtract('0.3', '0.1').toString()).toBe('0.2')
  })

  it('sums an empty column to zero rather than to nothing', () => {
    expect(sum([]).toString()).toBe('0')
    expect(add().toString()).toBe('0')
  })
})

describe('parseMoney', () => {
  it('accepts the forms a request body actually carries', () => {
    expect(parseMoney('250000', { field: 'amount' }).toString()).toBe('250000')
    expect(parseMoney('250000.50', { field: 'amount' }).toString()).toBe('250000.5')
    expect(parseMoney(' 1200 ', { field: 'amount' }).toString()).toBe('1200')
    // A JSON number is tolerated on the way in, because a client will send one eventually.
    expect(parseMoney(120000, { field: 'amount' }).toString()).toBe('120000')
  })

  it('rejects a value with more decimal places than the column holds, rather than rounding it', () => {
    // Rounding here would mean the number the cooperative typed is not the number stored, and
    // they would have no way to know.
    expect(() => parseMoney('1000.005', { field: 'amount' })).toThrow(AppError)
    try {
      parseMoney('1000.005', { field: 'body.amount' })
    } catch (error) {
      const details = (error as AppError).details ?? []
      expect(details[0]?.field).toBe('body.amount')
      expect(details[0]?.messageKey).toBe('validation.decimalScale')
    }
  })

  it('rejects zero unless zero is meaningful', () => {
    expect(() => parseMoney('0', { field: 'amount' })).toThrow(AppError)
    expect(parseMoney('0', { field: 'amount', allowZero: true }).toString()).toBe('0')
  })

  it('rejects a negative amount, because direction lives in the kind and never in the sign', () => {
    expect(() => parseMoney('-500', { field: 'amount' })).toThrow(AppError)
    expect(parseMoney('-500', { field: 'adjustment', allowNegative: true }).toString()).toBe('-500')
  })

  it('rejects anything that is not a decimal string', () => {
    for (const input of [
      '',
      '   ',
      'abc',
      '1e5',
      '1,000',
      '1 000',
      '0x10',
      '--5',
      '1.2.3',
      '.5',
      '5.',
      null,
      undefined,
      {},
      [],
      true,
      Number.NaN,
      Number.POSITIVE_INFINITY,
    ]) {
      expect(() => parseMoney(input, { field: 'amount' }), JSON.stringify(input)).toThrow(AppError)
    }
  })

  it('rejects an amount larger than the column can hold', () => {
    expect(() => parseMoney('1000000000000', { field: 'amount' })).toThrow(AppError)
    expect(parseMoney('999999999999.99', { field: 'amount' }).toString()).toBe('999999999999.99')
  })

  it('names the field it rejected, so a form can highlight it', () => {
    try {
      parseMoney('rubbish', { field: 'body.items.0.unitPrice' })
      expect.unreachable('should have thrown')
    } catch (error) {
      expect((error as AppError).details?.[0]?.field).toBe('body.items.0.unitPrice')
    }
  })

  it('reports a validation failure, not a server error', () => {
    try {
      parseMoney('rubbish', { field: 'amount' })
    } catch (error) {
      expect((error as AppError).status).toBe(422)
      expect((error as AppError).code).toBe('VALIDATION_FAILED')
    }
  })
})

describe('parseQuantity', () => {
  it('allows three decimal places, for litres and kilograms', () => {
    expect(parseQuantity('1240.500', 'quantity').toString()).toBe('1240.5')
    expect(parseQuantity('0.125', 'quantity').toString()).toBe('0.125')
  })

  it('still rejects a fourth', () => {
    expect(() => parseQuantity('1.0001', 'quantity')).toThrow(AppError)
  })
})

describe('rounding', () => {
  it('rounds half-up, the way a person doing the sum on paper would', () => {
    expect(round('0.125').toString()).toBe('0.13')
    expect(round('0.135').toString()).toBe('0.14')
    expect(round('2.675').toString()).toBe('2.68')
    // Half-even, the default in many libraries, would give 0.12 for the first of those.
  })

  it('rounds negative values away from zero at the halfway point', () => {
    expect(round('-0.125').toString()).toBe('-0.13')
  })

  it('leaves an exact value alone', () => {
    expect(round('1000').toString()).toBe('1000')
    expect(round('1000.5').toString()).toBe('1000.5')
  })

  it('rounds once at the end, not per line', () => {
    // Three lines of 0.334 each. Rounding per line gives 0.33 × 3 = 0.99; rounding the sum gives
    // 1.00, which is what the cooperative actually owes.
    const perLine = sum([round('0.334'), round('0.334'), round('0.334')])
    const atTheEnd = round(sum(['0.334', '0.334', '0.334']))
    expect(perLine.toString()).toBe('0.99')
    expect(atTheEnd.toString()).toBe('1')
  })
})

describe('multiply', () => {
  it('computes a sale line and rounds it to a bankable figure', () => {
    // 500 kg at 600 RWF/kg.
    expect(multiply('600', '500').toString()).toBe('300000')
    // 3 units at 333.333 each.
    expect(multiply('333.333', 3).toString()).toBe('1000')
  })

  it('keeps a fractional quantity exact before rounding', () => {
    // 1.5 kg at 1,250 RWF/kg.
    expect(multiply('1250', '1.5').toString()).toBe('1875')
  })

  it('accepts a quantity as a number, as a form will send it', () => {
    expect(multiply('1000', 2).toString()).toBe('2000')
  })
})

describe('comparison', () => {
  it('compares without coercing to a float', () => {
    expect(compare('0.3', add('0.1', '0.2'))).toBe(0)
    expect(compare('1000.01', '1000')).toBe(1)
    expect(compare('999.99', '1000')).toBe(-1)
  })

  it('answers the questions a stock or balance check asks', () => {
    expect(isZero('0.00')).toBe(true)
    expect(isZero('0.01')).toBe(false)
    expect(isNegative('-0.01')).toBe(true)
    expect(isNegative('0')).toBe(false)
    expect(isPositive('0.01')).toBe(true)
    expect(isPositive('0')).toBe(false)
    expect(equals('1000.00', '1000')).toBe(true)
  })

  it('picks the larger of several amounts', () => {
    expect(max('100', '2000', '30').toString()).toBe('2000')
  })
})

describe('the wire form', () => {
  it('always carries both decimal places, so a client never has to guess', () => {
    expect(toWire('1000')).toBe('1000.00')
    expect(toWire('1000.5')).toBe('1000.50')
    expect(toWire(ZERO)).toBe('0.00')
  })

  it('survives a round trip through JSON unchanged', () => {
    const original = parseMoney('1234567.89', { field: 'amount' })
    const wire = toWire(original)
    const parsed = JSON.parse(JSON.stringify({ amount: wire })) as { amount: string }
    expect(equals(toMoney(parsed.amount), original)).toBe(true)
  })

  it('does not lose precision on a value a float would mangle', () => {
    expect(toWire('9007199254740993.00', 2)).toBe('9007199254740993.00')
  })
})

describe('balanceOf', () => {
  it('is income minus expenses', () => {
    expect(balanceOf({ income: ['500000', '120000'], expenses: ['80000'] }).toString()).toBe(
      '540000',
    )
  })

  it('can be negative, because a cooperative can be overdrawn', () => {
    expect(balanceOf({ income: ['1000'], expenses: ['2500'] }).toString()).toBe('-1500')
  })

  it('is zero for a cooperative that has recorded nothing', () => {
    expect(balanceOf({ income: [], expenses: [] }).toString()).toBe('0')
  })
})

/**
 * The property test the Phase 5 exit criterion calls for, run here because it is the money module
 * it is really testing. A thousand random transactions, summed by the module and again
 * independently, must agree exactly.
 */
describe('property: a thousand random transactions balance exactly', () => {
  function randomAmount(seed: number): string {
    // Deterministic, so a failure can be reproduced from the seed alone.
    const whole = (seed * 7919) % 5_000_000
    const cents = (seed * 31) % 100
    return `${whole}.${String(cents).padStart(2, '0')}`
  }

  it('agrees with an independent sum computed in integer cents', () => {
    const income: string[] = []
    const expenses: string[] = []
    let centsIn = 0n
    let centsOut = 0n

    for (let seed = 1; seed <= 1000; seed += 1) {
      const amount = randomAmount(seed)
      const cents = BigInt(amount.replace('.', ''))
      if (seed % 3 === 0) {
        expenses.push(amount)
        centsOut += cents
      } else {
        income.push(amount)
        centsIn += cents
      }
    }

    const balance = balanceOf({ income, expenses })

    // The independent calculation never leaves integer arithmetic, so it cannot share a rounding
    // mistake with the module under test.
    const expectedCents = centsIn - centsOut
    const expected = new Decimal(expectedCents.toString()).dividedBy(100)

    expect(balance.toFixed(MONEY_SCALE)).toBe(expected.toFixed(MONEY_SCALE))
    expect(income.length + expenses.length).toBe(1000)
  })

  it('is unaffected by the order the transactions are summed in', () => {
    const values = Array.from({ length: 500 }, (_, index) => randomAmount(index + 1))
    const forwards = sum(values)
    const backwards = sum([...values].reverse())
    expect(forwards.toFixed(MONEY_SCALE)).toBe(backwards.toFixed(MONEY_SCALE))
  })

  it('returns to its prior value when a transaction is reversed', () => {
    const before = balanceOf({ income: ['500000'], expenses: ['120000'] })

    // A correction is a reversal of the opposite kind and the same amount, never a deletion.
    const after = balanceOf({
      income: ['500000', '120000'],
      expenses: ['120000', '120000'],
    })

    expect(after.toFixed(MONEY_SCALE)).toBe(before.toFixed(MONEY_SCALE))
  })
})
