import type { Db } from '../../lib/references.js'

/**
 * The categories a cooperative starts with.
 *
 * A treasurer opening the finance screen for the first time should be able to record what came in
 * this morning, not stop to invent a filing system. Every category here is one a Rwandan
 * cooperative actually uses, and each carries its Kinyarwanda name, because a cooperative that
 * works in Kinyarwanda should not have to translate its own books before it can use them.
 *
 * They are marked `isSystem`, which means they can be renamed and taken out of use but never
 * removed: an entry posted against one has to be able to say where the money went years later.
 * Nothing here is mandatory — a cooperative that wants its own set deactivates these and adds
 * them.
 */

export interface SeedCategory {
  name: string
  nameRw: string
}

/** What every cooperative gets, whatever it does. */
const COMMON_INCOME: SeedCategory[] = [
  { name: 'Membership fees', nameRw: 'Amafaranga yo kwinjira' },
  { name: 'Share capital', nameRw: "Imigabane y'igishoro" },
  { name: 'Savings deposits', nameRw: 'Ubwizigame' },
  { name: 'Grants and support', nameRw: 'Inkunga' },
  { name: 'Other income', nameRw: 'Andi yinjiye' },
]

const COMMON_EXPENSE: SeedCategory[] = [
  { name: 'Transport', nameRw: 'Ubwikorezi' },
  { name: 'Labour', nameRw: "Abakozi b'umunsi" },
  { name: 'Salaries', nameRw: 'Umushahara' },
  { name: 'Office and administration', nameRw: "Ibiro n'ubuyobozi" },
  { name: 'Rent', nameRw: 'Ubukode' },
  { name: 'Bank charges', nameRw: 'Amafaranga ya banki' },
  { name: 'Payments to members', nameRw: 'Kwishyura abanyamuryango' },
  { name: 'Other expenses', nameRw: 'Andi yasohotse' },
]

/**
 * What a cooperative gets because of what it does. A coffee cooperative sells cherry and buys
 * fertiliser; a transport cooperative buys fuel and spare parts. Offering a dairy cooperative a
 * "Packaging" category and no "Animal feed" would be the kind of detail that tells a manager this
 * software was not built for them.
 */
const BY_TYPE: Record<string, { income: SeedCategory[]; expense: SeedCategory[] }> = {
  AGRICULTURE: {
    income: [{ name: 'Sale of produce', nameRw: 'Kugurisha umusaruro' }],
    expense: [
      { name: 'Seeds and seedlings', nameRw: 'Imbuto' },
      { name: 'Fertiliser', nameRw: 'Ifumbire' },
      { name: 'Pesticides', nameRw: 'Imiti yica udukoko' },
      { name: 'Packaging', nameRw: 'Ibipfunyika' },
    ],
  },
  COFFEE: {
    income: [
      { name: 'Sale of coffee cherry', nameRw: 'Kugurisha ikawa y’umutobe' },
      { name: 'Sale of parchment coffee', nameRw: 'Kugurisha ikawa yumye' },
    ],
    expense: [
      { name: 'Fertiliser', nameRw: 'Ifumbire' },
      { name: 'Washing station running costs', nameRw: 'Ibiciro by’ikigo cy’imesa' },
      { name: 'Packaging', nameRw: 'Ibipfunyika' },
    ],
  },
  DAIRY: {
    income: [{ name: 'Sale of milk', nameRw: 'Kugurisha amata' }],
    expense: [
      { name: 'Animal feed', nameRw: 'Ibiribwa by’amatungo' },
      { name: 'Veterinary care', nameRw: 'Kuvuza amatungo' },
      { name: 'Cooling and collection', nameRw: 'Gukonjesha no gukusanya' },
    ],
  },
  LIVESTOCK: {
    income: [
      { name: 'Sale of livestock', nameRw: 'Kugurisha amatungo' },
      { name: 'Sale of animal products', nameRw: 'Kugurisha ibikomoka ku matungo' },
    ],
    expense: [
      { name: 'Animal feed', nameRw: 'Ibiribwa by’amatungo' },
      { name: 'Veterinary care', nameRw: 'Kuvuza amatungo' },
    ],
  },
  HANDICRAFTS: {
    income: [{ name: 'Sale of crafts', nameRw: 'Kugurisha ubukorikori' }],
    expense: [
      { name: 'Raw materials', nameRw: 'Ibikoresho fatizo' },
      { name: 'Packaging', nameRw: 'Ibipfunyika' },
    ],
  },
  MANUFACTURING: {
    income: [{ name: 'Sale of products', nameRw: 'Kugurisha ibicuruzwa' }],
    expense: [
      { name: 'Raw materials', nameRw: 'Ibikoresho fatizo' },
      { name: 'Electricity and water', nameRw: 'Amashanyarazi n’amazi' },
      { name: 'Equipment maintenance', nameRw: 'Gusana ibikoresho' },
    ],
  },
  TRADING: {
    income: [{ name: 'Sale of goods', nameRw: 'Kugurisha ibicuruzwa' }],
    expense: [
      { name: 'Purchase of goods', nameRw: 'Kugura ibicuruzwa' },
      { name: 'Storage', nameRw: 'Ububiko' },
    ],
  },
  TRANSPORT: {
    income: [{ name: 'Transport fees', nameRw: 'Amafaranga y’ubwikorezi' }],
    expense: [
      { name: 'Fuel', nameRw: 'Lisansi' },
      { name: 'Vehicle maintenance', nameRw: 'Gusana ibinyabiziga' },
      { name: 'Insurance', nameRw: 'Ubwishingizi' },
    ],
  },
  SERVICES: {
    income: [{ name: 'Service fees', nameRw: 'Amafaranga ya serivisi' }],
    expense: [{ name: 'Equipment and supplies', nameRw: 'Ibikoresho' }],
  },
  OTHER: {
    income: [{ name: 'Sale of produce', nameRw: 'Kugurisha umusaruro' }],
    expense: [{ name: 'Materials and supplies', nameRw: 'Ibikoresho' }],
  },
}

export function defaultCategoriesFor(typeKey: string): {
  income: SeedCategory[]
  expense: SeedCategory[]
} {
  const specific = BY_TYPE[typeKey] ?? BY_TYPE.OTHER ?? { income: [], expense: [] }
  return {
    income: [...specific.income, ...COMMON_INCOME],
    expense: [...specific.expense, ...COMMON_EXPENSE],
  }
}

/**
 * Writes the starting categories for a new cooperative, inside the caller's transaction.
 *
 * `skipDuplicates` rather than a failure, because the unique constraint is on
 * `(cooperative_id, kind, name)` and a type-specific list may name something the common list also
 * names. A collision there should mean one category, not a refused cooperative.
 */
export async function seedFinanceCategories(
  db: Db,
  cooperativeId: string,
  typeKey: string,
): Promise<number> {
  const defaults = defaultCategoriesFor(typeKey)
  const rows = [
    ...defaults.income.map((row) => ({ ...row, kind: 'INCOME' as const })),
    ...defaults.expense.map((row) => ({ ...row, kind: 'EXPENSE' as const })),
  ].map((row) => ({
    cooperativeId,
    kind: row.kind,
    name: row.name,
    nameRw: row.nameRw,
    isSystem: true,
  }))

  const result = await db.financeCategory.createMany({ data: rows, skipDuplicates: true })
  return result.count
}
