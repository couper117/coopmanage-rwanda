/**
 * Reading a PostgreSQL constraint failure out of a Prisma error.
 *
 * The code (`P2002` for a unique violation) is stable, but where the offending constraint is named
 * is not. Prisma 5 put it in `meta.target`; Prisma 7 with the pg driver adapter nests it at
 * `meta.driverAdapterError.cause.constraint.index`, alongside the raw PostgreSQL message. Rather
 * than hard-code one of those paths and break on the next change, this walks the metadata and
 * collects every constraint name it can find.
 *
 * The alternative is what this module replaced: a service guessing the shape, missing, and turning
 * a 409 the user could act on into an opaque 500.
 */

const UNIQUE_VIOLATION = 'P2002'
const FOREIGN_KEY_VIOLATION = 'P2003'
const NOT_FOUND = 'P2025'

/** Keys whose string values name a column, an index or a constraint. */
const NAME_KEYS = new Set(['target', 'index', 'fields', 'constraint_name', 'originalMessage'])

/**
 * Walks the error metadata and returns every constraint or column name mentioned anywhere in it,
 * at any depth. Depth is bounded so a cyclic or pathological object cannot hang the handler.
 */
function constraintNames(value: unknown, depth = 0): string[] {
  if (depth > 6 || value === null || value === undefined) return []

  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.flatMap((entry) => constraintNames(entry, depth + 1))
  if (typeof value !== 'object') return []

  const names: string[] = []
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    if (NAME_KEYS.has(key)) {
      names.push(...constraintNames(nested, depth + 1))
    } else if (typeof nested === 'object') {
      names.push(...constraintNames(nested, depth + 1))
    }
  }
  return names
}

function codeOf(error: unknown): string | undefined {
  // Reading a property off null throws, and an error handler is the last place that should be
  // the thing that fails.
  if (error === null || typeof error !== 'object') return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

/**
 * True when the error is a unique violation on any of the given columns or indexes. Matching is by
 * substring, so `registration_number` matches the index `cooperatives_registration_number_key`
 * without every caller having to know PostgreSQL's naming convention.
 *
 * Called with no columns, it matches any unique violation.
 */
export function isUniqueViolation(error: unknown, ...columns: string[]): boolean {
  if (codeOf(error) !== UNIQUE_VIOLATION) return false
  if (columns.length === 0) return true

  const names = constraintNames((error as { meta?: unknown }).meta)
  return columns.some((column) => names.some((name) => name.includes(column)))
}

export function isForeignKeyViolation(error: unknown): boolean {
  return codeOf(error) === FOREIGN_KEY_VIOLATION
}

/** Prisma's "record required but not found", raised by `update` and `delete` on a missing row. */
export function isRecordNotFound(error: unknown): boolean {
  return codeOf(error) === NOT_FOUND
}
