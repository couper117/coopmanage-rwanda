import { NAMESPACES } from '@/i18n'

const KNOWN_NAMESPACES = new Set<string>(NAMESPACES as readonly string[])

/**
 * The backend sends translation keys in dotted form, `errors.forbidden` or
 * `validation.too_small`, because that is how they read in a log and in the API contract. i18next
 * addresses a namespace with a colon. This converts the first segment when it names a real
 * namespace, and leaves anything else alone so an unknown key still falls back to its own text.
 */
export function toI18nKey(key: string): string {
  const separator = key.indexOf('.')
  if (separator <= 0) return key
  const head = key.slice(0, separator)
  if (!KNOWN_NAMESPACES.has(head)) return key
  return `${head}:${key.slice(separator + 1)}`
}

/**
 * Resolves any parameter whose value names a translation key.
 *
 * The backend sends an enum inside an audit entry as a key rather than as its raw value, because
 * `SAVINGS` in the middle of a Kinyarwanda sentence is not a translation. Anything that does not
 * name a real namespace is left exactly as it arrived, which is what keeps a member's name, an
 * amount or a reference untouched.
 */
export function translateParams(
  params: Record<string, unknown> | null | undefined,
  translate: (key: string) => string,
): Record<string, unknown> {
  if (!params) return {}
  const resolved: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(params)) {
    if (typeof value !== 'string') {
      resolved[name] = value
      continue
    }
    const key = toI18nKey(value)
    resolved[name] = key === value ? value : translate(key)
  }
  return resolved
}
