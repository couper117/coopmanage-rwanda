import { Prisma } from '@prisma/client'
import { AppError } from './errors.js'

/**
 * Money.
 *
 * This module is the reason `docs/architecture.md` section 6 exists, and it is deliberately the
 * first thing Phase 4 delivers: nothing in this application writes a monetary value before the
 * arithmetic is proven. A cooperative's books are the whole point of the product, and a rounding
 * error in them is not a bug a manager can see until the figures no longer reconcile.
 *
 * Three rules hold everywhere:
 *
 * 1. **No `number` ever touches an amount.** Every value is a `Decimal`, backed by arbitrary
 *    precision arithmetic. `0.1 + 0.2` is `0.3` here and `0.30000000000000004` in a float, and a
 *    ledger that sums thousands of rows accumulates that error until it shows.
 * 2. **Amounts cross the API as strings.** Serialising a `Decimal` as a JSON number would push it
 *    through an IEEE-754 double on the way out and undo everything above.
 * 3. **Rounding happens once, at the end, half-up.** Rounding each line of a calculation and then
 *    summing gives a different answer from summing and then rounding, and the second is the one a
 *    person doing the same sum on paper would get.
 *
 * Rwandan francs have no circulating subunit, so amounts are usually whole. The scale is still two
 * decimal places, because a unit price or a per-kilogram rate genuinely can have them, and a
 * subtotal computed from such a rate must not be silently truncated.
 */

export type Money = Prisma.Decimal
export const Decimal = Prisma.Decimal

/** Monetary scale: `numeric(14,2)` in PostgreSQL. */
export const MONEY_SCALE = 2

/** Quantity scale: `numeric(14,3)`, so litres and kilograms with fractions stay exact. */
export const QUANTITY_SCALE = 3

/** The largest value `numeric(14,2)` can hold: twelve digits before the point. */
const MAX_MONEY = new Decimal('999999999999.99')

export const ZERO: Money = new Decimal(0)

/**
 * A decimal string, as it arrives from a request body or leaves in a response. Deliberately not a
 * number: see rule 2 above.
 */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/

export interface ParseOptions {
  /** Field name, so a rejection names the input the user actually filled in. */
  field: string
  /** Decimal places allowed. Defaults to the monetary scale. */
  scale?: number
  /** Whether zero is acceptable. An amount is usually required to be positive. */
  allowZero?: boolean
  /** Whether a negative value is acceptable. Almost never: direction lives in `kind`. */
  allowNegative?: boolean
}

/**
 * Parses an amount from untrusted input.
 *
 * A value with more decimal places than the column can hold is **rejected, not rounded**. Silently
 * turning `1000.005` into `1000.01` would mean the number the cooperative typed is not the number
 * stored, and they would have no way to know.
 */
export function parseMoney(input: unknown, options: ParseOptions): Money {
  const { field, scale = MONEY_SCALE, allowZero = false, allowNegative = false } = options

  const text =
    typeof input === 'string'
      ? input.trim()
      : typeof input === 'number' && Number.isFinite(input)
        ? String(input)
        : null

  if (text === null || text.length === 0 || !DECIMAL_STRING.test(text)) {
    throw reject(field, 'validation.amountFormat')
  }

  const [, fraction = ''] = text.replace('-', '').split('.')
  if (fraction.length > scale) {
    throw reject(field, 'validation.decimalScale', { scale })
  }

  const value = new Decimal(text)

  if (!value.isFinite()) throw reject(field, 'validation.amountFormat')
  if (!allowNegative && value.isNegative()) throw reject(field, 'validation.positiveAmount')
  if (!allowZero && value.isZero()) throw reject(field, 'validation.positiveAmount')
  if (value.abs().greaterThan(MAX_MONEY)) throw reject(field, 'validation.amountTooLarge')

  return value
}

/**
 * Parses a quantity. Same rules, three decimal places.
 *
 * Zero is refused by default, because a movement of nothing is not a movement. It is allowed only
 * where the input is a measurement rather than a movement: a storekeeper who counts an empty shelf
 * has counted zero, and that is a real answer the system has to accept.
 */
export function parseQuantity(
  input: unknown,
  field: string,
  options: { allowZero?: boolean } = {},
): Money {
  return parseMoney(input, {
    field,
    scale: QUANTITY_SCALE,
    ...(options.allowZero === undefined ? {} : { allowZero: options.allowZero }),
  })
}

function reject(field: string, messageKey: string, messageParams?: Record<string, number>) {
  return AppError.validationFailed([
    { field, messageKey, ...(messageParams ? { messageParams } : {}) },
  ])
}

/** Accepts anything Prisma hands back, including a value that has been through JSON. */
export function toMoney(value: Money | string | number): Money {
  return value instanceof Decimal ? value : new Decimal(String(value))
}

export function add(...values: (Money | string)[]): Money {
  return values.reduce<Money>((total, value) => total.plus(toMoney(value)), ZERO)
}

export function subtract(a: Money | string, b: Money | string): Money {
  return toMoney(a).minus(toMoney(b))
}

/**
 * Multiplies an amount by a quantity, as a sale line does.
 *
 * The result is rounded to the monetary scale here because a line total is a real amount that gets
 * stored, and `3 × 333.333` has to become a figure a cooperative can bank. Summing line totals
 * afterwards needs no further rounding.
 */
export function multiply(amount: Money | string, factor: Money | string | number): Money {
  const product = toMoney(amount).times(
    toMoney(typeof factor === 'number' ? String(factor) : factor),
  )
  return round(product)
}

/** Sums a column. The one function a balance, a total and a report subtotal all go through. */
export function sum(values: (Money | string)[]): Money {
  return values.reduce<Money>((total, value) => total.plus(toMoney(value)), ZERO)
}

/** Half-up to two decimal places, which is what a person doing the sum on paper would do. */
export function round(value: Money | string, scale: number = MONEY_SCALE): Money {
  return toMoney(value).toDecimalPlaces(scale, Decimal.ROUND_HALF_UP)
}

export function isZero(value: Money | string): boolean {
  return toMoney(value).isZero()
}

export function isNegative(value: Money | string): boolean {
  return toMoney(value).isNegative()
}

export function isPositive(value: Money | string): boolean {
  return toMoney(value).greaterThan(0)
}

/** -1, 0 or 1. Never compares amounts with `<`, which would coerce to a float. */
export function compare(a: Money | string, b: Money | string): -1 | 0 | 1 {
  return toMoney(a).comparedTo(toMoney(b)) as -1 | 0 | 1
}

export function equals(a: Money | string, b: Money | string): boolean {
  return compare(a, b) === 0
}

export function max(...values: (Money | string)[]): Money {
  return values.map(toMoney).reduce((best, value) => (value.greaterThan(best) ? value : best), ZERO)
}

/**
 * The wire form: a fixed-scale decimal string, always with both decimal places so a client never
 * has to guess whether `1000` means a thousand francs or a thousand and something.
 */
export function toWire(value: Money | string, scale: number = MONEY_SCALE): string {
  return toMoney(value).toFixed(scale)
}

/**
 * A balance: income minus expenses. The single definition, so a summary, a report and the
 * dashboard can never disagree about what the cooperative has.
 */
export function balanceOf(input: {
  income: (Money | string)[]
  expenses: (Money | string)[]
}): Money {
  return subtract(sum(input.income), sum(input.expenses))
}
