/**
 * Demonstration ledger entries.
 *
 * Phase 4 seeded contributions and share purchases, which are all income. A finance overview with
 * no expenses at all reads as broken rather than as empty: the balance equals the income, the
 * expense column is nil, and nobody looking at it can tell whether the screen works. These are
 * the entries a real agricultural cooperative in Musanze posts over a year, so the overview shows
 * money in, money out and a balance that means something.
 *
 * Deterministic, like the rest of the demonstration data, so the same seed always produces the
 * same books and a screenshot taken today matches one taken next week.
 */

export interface DemoEntry {
  kind: 'INCOME' | 'EXPENSE'
  /** Matched by name against the cooperative's seeded categories. */
  category: string
  amount: string
  month: number
  day: number
  method: 'CASH' | 'MOBILE_MONEY' | 'BANK' | 'CHEQUE'
  description: string
}

/** What the cooperative spends every month, whatever the season. */
const MONTHLY: Omit<DemoEntry, 'month' | 'day'>[] = [
  {
    kind: 'EXPENSE',
    category: 'Salaries',
    amount: '320000.00',
    method: 'BANK',
    description: 'Salaries for the storekeeper and the secretary',
  },
  {
    kind: 'EXPENSE',
    category: 'Office and administration',
    amount: '45000.00',
    method: 'CASH',
    description: 'Stationery, airtime and cleaning',
  },
  {
    kind: 'EXPENSE',
    category: 'Bank charges',
    amount: '7500.00',
    method: 'BANK',
    description: 'Account maintenance and transfer charges',
  },
]

/**
 * What depends on the season. Planting in the first quarter, harvest and sales from June, and the
 * transport that goes with each. A flat monthly figure would make the trend line straight, which
 * is exactly what a manager judging this software would not recognise.
 */
const SEASONAL: DemoEntry[] = [
  {
    kind: 'EXPENSE',
    category: 'Seeds and seedlings',
    amount: '890000.00',
    month: 1,
    day: 14,
    method: 'BANK',
    description: 'Certified maize and bean seed for the season',
  },
  {
    kind: 'EXPENSE',
    category: 'Fertiliser',
    amount: '1250000.00',
    month: 2,
    day: 6,
    method: 'BANK',
    description: 'NPK and urea, delivered to the store',
  },
  {
    kind: 'EXPENSE',
    category: 'Labour',
    amount: '420000.00',
    month: 2,
    day: 20,
    method: 'CASH',
    description: 'Planting labour, eighteen people for six days',
  },
  {
    kind: 'EXPENSE',
    category: 'Pesticides',
    amount: '185000.00',
    month: 3,
    day: 11,
    method: 'CASH',
    description: 'Treatment against fall armyworm',
  },
  {
    kind: 'EXPENSE',
    category: 'Labour',
    amount: '360000.00',
    month: 4,
    day: 8,
    method: 'CASH',
    description: 'Weeding, second round',
  },
  {
    kind: 'EXPENSE',
    category: 'Packaging',
    amount: '240000.00',
    month: 5,
    day: 22,
    method: 'CASH',
    description: 'Fifty-kilogram sacks and twine',
  },

  {
    kind: 'INCOME',
    category: 'Sale of produce',
    amount: '2850000.00',
    month: 6,
    day: 12,
    method: 'BANK',
    description: 'Maize sold to the district buyer, first lot',
  },
  {
    kind: 'EXPENSE',
    category: 'Transport',
    amount: '310000.00',
    month: 6,
    day: 12,
    method: 'CASH',
    description: 'Two lorries to Musanze town',
  },
  {
    kind: 'INCOME',
    category: 'Sale of produce',
    amount: '3420000.00',
    month: 7,
    day: 9,
    method: 'BANK',
    description: 'Maize sold to the district buyer, second lot',
  },
  {
    kind: 'EXPENSE',
    category: 'Transport',
    amount: '295000.00',
    month: 7,
    day: 9,
    method: 'CASH',
    description: 'Two lorries to Musanze town',
  },
  {
    kind: 'INCOME',
    category: 'Sale of produce',
    amount: '1975000.00',
    month: 8,
    day: 4,
    method: 'MOBILE_MONEY',
    description: 'Beans sold at the cooperative store',
  },
  {
    kind: 'EXPENSE',
    category: 'Transport',
    amount: '140000.00',
    month: 8,
    day: 4,
    method: 'CASH',
    description: 'Collection from the collection points',
  },
  {
    kind: 'INCOME',
    category: 'Grants and support',
    amount: '1500000.00',
    month: 8,
    day: 26,
    method: 'BANK',
    description: 'District support for the drying shelter',
  },
  {
    kind: 'EXPENSE',
    category: 'Payments to members',
    amount: '4200000.00',
    month: 9,
    day: 2,
    method: 'MOBILE_MONEY',
    description: 'First payment to members for delivered maize',
  },
  {
    kind: 'EXPENSE',
    category: 'Rent',
    amount: '480000.00',
    month: 9,
    day: 5,
    method: 'BANK',
    description: 'Store rent, second half of the year',
  },
]

/** The whole demonstration ledger for one year, in date order. */
export function buildDemoFinance(year: number): DemoEntry[] {
  const entries: DemoEntry[] = []

  for (let month = 1; month <= 9; month += 1) {
    for (const [index, template] of MONTHLY.entries()) {
      entries.push({ ...template, month, day: 25 + index })
    }
  }
  entries.push(...SEASONAL)

  return entries
    .filter((entry) => new Date(Date.UTC(year, entry.month - 1, entry.day)) <= new Date())
    .sort((a, b) => a.month - b.month || a.day - b.day)
}
