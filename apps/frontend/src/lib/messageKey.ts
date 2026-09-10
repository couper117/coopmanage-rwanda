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
