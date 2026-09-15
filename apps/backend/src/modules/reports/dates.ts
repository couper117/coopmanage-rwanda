import { reportDate, type Locale } from '@coopmanage/shared'

/**
 * Period arithmetic for reports.
 *
 * The month names themselves live in `packages/shared/src/reports.ts`, because the screen and the
 * server-rendered PDF have to write a date the same way. What is here is only the arithmetic a
 * report needs to turn two dates into a window the database can be queried with.
 */

/** The inclusive start of a date-only day, as a timestamp. */
export function startOfDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`)
}

/** The inclusive end of a date-only day, for a timestamp column. */
export function endOfDay(iso: string): Date {
  return new Date(`${iso}T23:59:59.999Z`)
}

/** The day before a period starts, which is where an opening balance is measured. */
export function dayBefore(iso: string): string {
  const date = new Date(`${iso}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() - 1)
  return date.toISOString().slice(0, 10)
}

/**
 * The moment a report was produced, to the minute, in Kigali time.
 *
 * Kigali has kept a fixed offset of two hours and does not observe daylight saving, so the shift is
 * arithmetic rather than a timezone lookup. That keeps the footer identical on a developer's
 * machine, on a server in Europe and on the machine in the cooperative's office — which matters,
 * because two copies of the same report with different times on them is a document nobody trusts.
 */
export function kigaliDateTime(when: Date, locale: Locale): string {
  const iso = new Date(when.getTime() + 2 * 60 * 60 * 1000).toISOString()
  return `${reportDate(iso.slice(0, 10), locale)}, ${iso.slice(11, 16)}`
}
