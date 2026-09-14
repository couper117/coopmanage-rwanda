import { describe, expect, it } from 'vitest'
import { isForeignKeyViolation, isRecordNotFound, isUniqueViolation } from '../src/lib/dbErrors.js'

/**
 * These are the error objects Prisma actually produces, captured from a live PostgreSQL. The first
 * version of the helper read `meta.target`, which Prisma 5 used; Prisma 7 with the pg driver
 * adapter nests the constraint three levels deeper, so the check silently never matched and a
 * duplicate registration number surfaced as a 500 instead of a 409. Both shapes are pinned here so
 * that cannot happen again unnoticed.
 */

/** Prisma 7 with @prisma/adapter-pg. */
const PRISMA_7_UNIQUE = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2002',
  meta: {
    driverAdapterError: {
      name: 'DriverAdapterError',
      cause: {
        originalCode: '23505',
        originalMessage:
          'duplicate key value violates unique constraint "cooperatives_registration_number_key"',
        kind: 'UniqueConstraintViolation',
        constraint: { index: 'cooperatives_registration_number_key' },
        table: 'cooperatives',
      },
    },
    modelName: 'Cooperative',
  },
}

/** The older shape, kept so a rollback or a different adapter still works. */
const PRISMA_5_UNIQUE = {
  name: 'PrismaClientKnownRequestError',
  code: 'P2002',
  meta: { target: ['registration_number'] },
}

const COMPOSITE_UNIQUE = {
  code: 'P2002',
  meta: { target: ['cooperative_id', 'user_id'] },
}

describe('isUniqueViolation', () => {
  it('finds the constraint in the Prisma 7 driver-adapter shape', () => {
    expect(isUniqueViolation(PRISMA_7_UNIQUE, 'registration_number')).toBe(true)
  })

  it('finds the constraint in the older target shape', () => {
    expect(isUniqueViolation(PRISMA_5_UNIQUE, 'registration_number')).toBe(true)
  })

  it('matches an index name by the column it contains', () => {
    // Callers should not have to know PostgreSQL's `table_column_key` convention.
    expect(isUniqueViolation(PRISMA_7_UNIQUE, 'code')).toBe(false)
    expect(isUniqueViolation(PRISMA_7_UNIQUE, 'registration')).toBe(true)
  })

  it('matches any of several candidate columns', () => {
    expect(isUniqueViolation(PRISMA_7_UNIQUE, 'code', 'registration_number')).toBe(true)
  })

  it('matches a composite constraint by either column', () => {
    expect(isUniqueViolation(COMPOSITE_UNIQUE, 'user_id')).toBe(true)
    expect(isUniqueViolation(COMPOSITE_UNIQUE, 'cooperative_id')).toBe(true)
  })

  it('matches any unique violation when no column is named', () => {
    expect(isUniqueViolation(PRISMA_7_UNIQUE)).toBe(true)
    expect(isUniqueViolation({ code: 'P2003' })).toBe(false)
  })

  it('says no for a different error code, whatever the metadata says', () => {
    expect(
      isUniqueViolation(
        { code: 'P2003', meta: { target: ['registration_number'] } },
        'registration_number',
      ),
    ).toBe(false)
  })

  it('survives anything that is not a Prisma error', () => {
    for (const value of [null, undefined, 'a string', 42, new Error('plain'), {}]) {
      expect(isUniqueViolation(value, 'anything')).toBe(false)
    }
  })

  it('does not recurse forever on a cyclic object', () => {
    const cyclic: Record<string, unknown> = { code: 'P2002' }
    const meta: Record<string, unknown> = {}
    meta.self = meta
    cyclic.meta = meta
    expect(() => isUniqueViolation(cyclic, 'anything')).not.toThrow()
  })
})

describe('other constraint failures', () => {
  it('recognises a foreign key violation', () => {
    expect(isForeignKeyViolation({ code: 'P2003' })).toBe(true)
    expect(isForeignKeyViolation({ code: 'P2002' })).toBe(false)
  })

  it('recognises a missing record on update or delete', () => {
    expect(isRecordNotFound({ code: 'P2025' })).toBe(true)
    expect(isRecordNotFound({ code: 'P2002' })).toBe(false)
  })
})
