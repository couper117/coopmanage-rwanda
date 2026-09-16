/**
 * Bar geometry, in exact integers.
 *
 * Shared by the finance overview and the dashboard, which is why it lives here rather than inside
 * either feature.
 *
 * A bar needs a height, and a height needs a ratio, which is the one thing a decimal string cannot
 * give on its own. Rather than putting an amount through a float — which is
 * how a cooperative's books end up a centime out — the string is converted to its exact number of
 * minor units as a `bigint`, the ratio is worked out by integer division to a tenth of a percent,
 * and only that small ratio ever becomes a JavaScript number. No figure shown to the reader comes
 * from any of this: every amount on screen is rendered by `Money` from the original string.
 */
export function toMinorUnits(value: string): bigint {
  const trimmed = value.trim()
  const negative = trimmed.startsWith('-')
  const [whole = '', fraction = ''] = (negative ? trimmed.slice(1) : trimmed).split('.')
  const digits = whole.replace(/\D/g, '') || '0'
  const cents = `${fraction.replace(/\D/g, '')}00`.slice(0, 2)
  const magnitude = BigInt(`${digits}${cents}`)
  return negative ? -magnitude : magnitude
}

function magnitudeOf(value: bigint): bigint {
  return value < 0n ? -value : value
}

/** The largest of a set of amounts, in minor units, which is what a chart scales against. */
export function largestMinorUnits(values: readonly string[]): bigint {
  return values.reduce<bigint>((largest, value) => {
    const candidate = magnitudeOf(toMinorUnits(value))
    return candidate > largest ? candidate : largest
  }, 0n)
}

/** A percentage of the largest bar, to one decimal place, for a CSS height. */
export function barPercent(value: string, largest: bigint): number {
  if (largest <= 0n) return 0
  const magnitude = magnitudeOf(toMinorUnits(value))
  if (magnitude <= 0n) return 0
  const tenths = (magnitude * 1000n) / largest
  return Number(tenths > 1000n ? 1000n : tenths) / 10
}

/** True when a decimal string holds nothing, so a screen can say "none" rather than show a zero. */
export function isZeroAmount(value: string): boolean {
  return toMinorUnits(value) === 0n
}
