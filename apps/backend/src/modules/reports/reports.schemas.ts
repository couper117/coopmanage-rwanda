import { LOCALES, REPORT_FORMATS, REPORT_TYPES } from '@coopmanage/shared'
import { z } from 'zod'

/**
 * Report validators.
 *
 * Every report is asked for with a period, and the period is required rather than defaulted. A
 * report whose dates were guessed is a report somebody reads the wrong month out of at a general
 * assembly, so the caller has to say which month it wants and the answer prints that period at the
 * top of the page.
 *
 * The parameters are stored on the `ReportRun` row exactly as they were validated, which is what
 * lets a run be produced again months later and come back with the same figures.
 */

/** The report name in the path. Not an identifier, so it is never treated as one by the sweep. */
export const reportTypeParamSchema = z.object({ type: z.enum(REPORT_TYPES) }).strict()

const period = {
  from: z.iso.date(),
  to: z.iso.date(),
  /**
   * The language the report prints in. Defaults to the reader's own, because somebody who has
   * chosen Kinyarwanda for the interface almost never wants an English report — but it is a
   * parameter rather than a fixed rule, because a cooperative writing to a bank that reads English
   * has to be able to say so without changing their own language.
   */
  locale: z.enum(LOCALES).optional(),
  /** The member a membership report is about. Absent means the whole register. */
  memberId: z.uuid().optional(),
  /** Narrows a stock or sales report to one store. */
  warehouseId: z.uuid().optional(),
  /** Narrows a financial report to one category. */
  categoryId: z.uuid().optional(),
}

/** A period the wrong way round is a mistake, not an empty report. */
const orderedPeriod = <T extends z.ZodType<{ from: string; to: string }>>(schema: T) =>
  schema.refine((value) => value.from <= value.to, {
    message: 'from must not be after to',
    path: ['from'],
  })

export const reportParamsSchema = orderedPeriod(z.object(period).strict())
export type ReportParams = z.infer<typeof reportParamsSchema>

export const exportReportSchema = orderedPeriod(
  z.object({ ...period, format: z.enum(REPORT_FORMATS) }).strict(),
)
export type ExportReportInput = z.infer<typeof exportReportSchema>

export const reportRunIdSchema = z.object({ id: z.uuid() }).strict()

export const listReportRunsSchema = z
  .object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(25),
    type: z.enum(REPORT_TYPES).optional(),
  })
  .strict()
export type ListReportRunsQuery = z.infer<typeof listReportRunsSchema>
