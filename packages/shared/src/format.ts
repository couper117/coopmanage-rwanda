import { DEFAULT_CURRENCY } from './enums.js'

/**
 * Formatting for values that cross the API as decimal strings.
 *
 * Grouping is done here rather than through `Intl.NumberFormat` on purpose. Kinyarwanda locale data
 * is not present in every JavaScript runtime, and a report rendered on the server must match the
 * screen exactly. These functions are pure and give the same output everywhere.
 *
 * They never parse a value into a JavaScript number. All work is on the string, so a figure larger
 * than `Number.MAX_SAFE_INTEGER` still formats exactly.
 */

const GROUP_SEPARATOR = ','
const DECIMAL_SEPARATOR = '.'

interface DecimalParts {
  negative: boolean
  whole: string
  fraction: string
}

function parseDecimalString(value: string): DecimalParts {
  const trimmed = value.trim()
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) {
    throw new Error(`Not a decimal string: ${value}`)
  }
  const negative = trimmed.startsWith('-')
  const unsigned = negative ? trimmed.slice(1) : trimmed
  const [whole = '0', fraction = ''] = unsigned.split(DECIMAL_SEPARATOR)
  return { negative, whole, fraction }
}

function group(whole: string): string {
  let out = ''
  for (let i = 0; i < whole.length; i += 1) {
    if (i > 0 && (whole.length - i) % 3 === 0) out += GROUP_SEPARATOR
    out += whole[i]
  }
  return out
}

function trimTrailingZeros(fraction: string): string {
  return fraction.replace(/0+$/, '')
}

/**
 * Rwandan francs have no circulating subunit, so whole amounts print without decimals. A stored
 * value that is not whole keeps its decimals rather than being silently rounded away.
 */
export function formatMoney(
  value: string,
  options: { currency?: string; withCurrency?: boolean } = {},
): string {
  const { currency = DEFAULT_CURRENCY, withCurrency = true } = options
  const { negative, whole, fraction } = parseDecimalString(value)
  const significant = trimTrailingZeros(fraction)
  const body =
    significant.length > 0 ? `${group(whole)}${DECIMAL_SEPARATOR}${significant}` : group(whole)
  const signed = negative && /[1-9]/.test(whole + fraction) ? `-${body}` : body
  return withCurrency ? `${signed} ${currency}` : signed
}

/** Quantities keep their unit and drop meaningless trailing zeros: `1,240.5 kg`. */
export function formatQuantity(value: string, unitSymbol?: string): string {
  const { negative, whole, fraction } = parseDecimalString(value)
  const significant = trimTrailingZeros(fraction)
  const body =
    significant.length > 0 ? `${group(whole)}${DECIMAL_SEPARATOR}${significant}` : group(whole)
  const signed = negative && /[1-9]/.test(whole + fraction) ? `-${body}` : body
  return unitSymbol ? `${signed} ${unitSymbol}` : signed
}

/** Strips grouping so a formatted field can be sent back to the API. */
export function parseFormattedNumber(value: string): string {
  return value.replaceAll(GROUP_SEPARATOR, '').trim()
}

/** True when the string is a decimal the API will accept at the given scale. */
export function isValidDecimal(value: string, scale: number): boolean {
  if (!/^-?\d+(\.\d+)?$/.test(value.trim())) return false
  const [, fraction = ''] = value.trim().replace('-', '').split(DECIMAL_SEPARATOR)
  return fraction.length <= scale
}

export const MONEY_SCALE = 2
export const QUANTITY_SCALE = 3
