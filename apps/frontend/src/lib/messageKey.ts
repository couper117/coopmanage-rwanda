import { currentLanguage, NAMESPACES } from '@/i18n'

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
 * Resolves a message's parameters into the reader's language.
 *
 * Two kinds of parameter need it, and both come from the same place: an audit entry or a
 * notification, written by the server, whose sentence the interface composes.
 *
 * **An enum arrives as a translation key.** `SAVINGS` in the middle of a Kinyarwanda sentence is
 * not a translation, so the server sends `contributions.type.SAVINGS` and this looks it up.
 * Anything that does not name a real namespace is left exactly as it arrived, which is what keeps
 * a member's name, an amount and a reference untouched.
 *
 * **A name the cooperative gave in two languages arrives twice.** A parameter `xRw` is the
 * Kinyarwanda rendering of `x`, recorded when the entry was written — see `AuditInput` on the
 * server. A Kinyarwanda reader is shown that one and an English reader is not, so a cooperative's
 * own expense category reads in the language of the page it is on rather than in the language it
 * happened to be created in. The `xRw` parameters are then dropped, because the sentence
 * interpolates `{{x}}` in both languages: a placeholder that existed in one language only would be
 * a different sentence, not a translation of the same one.
 *
 * An entry written before that convention carries only `x`, which is then what it gets. That is
 * the right answer for a trail — it shows what was recorded.
 */
export function translateParams(
  params: Record<string, unknown> | null | undefined,
  translate: (key: string) => string,
  language: string = currentLanguage(),
): Record<string, unknown> {
  if (!params) return {}

  const resolved: Record<string, unknown> = {}
  for (const [name, value] of Object.entries(params)) {
    if (name.endsWith('Rw') && name.length > 2) continue

    const preferred = language === 'rw' ? params[`${name}Rw`] : undefined
    const chosen = typeof preferred === 'string' && preferred.length > 0 ? preferred : value

    if (typeof chosen !== 'string') {
      resolved[name] = chosen
      continue
    }
    const key = toI18nKey(chosen)
    resolved[name] = key === chosen ? chosen : translate(key)
  }
  return resolved
}
