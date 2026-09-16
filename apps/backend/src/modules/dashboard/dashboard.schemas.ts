import { z } from 'zod'

/**
 * The dashboard takes no parameters at all: it is the cooperative's position now, for this reader.
 * A period selector would be a second screen pretending to be this one, and the finance and sales
 * overviews already answer "over what period".
 */

export const searchSchema = z
  .object({
    /**
     * Two characters at least. A single letter matches most of a register and would make the
     * search box a way to page through the whole cooperative one keystroke at a time.
     */
    q: z.string().trim().min(2).max(120),
  })
  .strict()

export type SearchQuery = z.infer<typeof searchSchema>
