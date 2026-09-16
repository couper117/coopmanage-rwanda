import { formatMoney } from '@coopmanage/shared'

/**
 * Turns a block's figures into the options a sentence is built from.
 *
 * The server never sends a finished sentence — it sends a key and the figures behind it, so the
 * words are the reader's language and the figures are exact. Two things then have to happen on the
 * way into `t()`, and both are easy to get wrong in each place they are needed, which is why they
 * are here once.
 *
 * **Money is formatted.** A raw `1234567.00` inside a sentence is not a figure a manager reads; it
 * has to be grouped, and it must be grouped by the same code that groups it in a table so the same
 * amount never appears two ways on one page.
 *
 * **`count` is a number.** i18next reserves that name for choosing a plural form, and it must be a
 * number for the choice to happen at all. So a count that arrived as a string is coerced, and the
 * translation files carry a `_one` variant beside each key that names one: "1 product is out of
 * stock" is not a sentence English can build by substitution.
 */

/** Parameters whose values are amounts of money, wherever a dashboard block sends them. */
const MONEY_PARAMS: ReadonlySet<string> = new Set([
  'amount',
  'balance',
  'income',
  'expenses',
  'outstanding',
])

export function sentenceParams(
  params: Readonly<Record<string, string | number>>,
): Record<string, string | number> {
  const options: Record<string, string | number> = {}

  for (const [name, value] of Object.entries(params)) {
    options[name] = MONEY_PARAMS.has(name)
      ? formatMoney(String(value), { withCurrency: false })
      : value
  }

  if (params.count !== undefined) options.count = Number(params.count)

  return options
}
