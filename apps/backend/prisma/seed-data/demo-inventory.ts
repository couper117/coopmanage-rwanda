/**
 * Demonstration catalogue and store.
 *
 * What an agricultural cooperative in Musanze actually keeps: the produce it collects from
 * members, the inputs it buys in and sells on, and the sacks and twine it packs with. Two stores,
 * because a cooperative with collection points is the normal case and a single-store demonstration
 * would hide the transfer screen entirely.
 *
 * Deterministic like the rest of the demonstration data, so the same seed always produces the same
 * store and a screenshot taken today matches one taken next week.
 */

export interface DemoWarehouse {
  name: string
  code: string
  district: string
  sector: string
  isDefault: boolean
}

export const DEMO_WAREHOUSES: DemoWarehouse[] = [
  {
    name: 'Main store, Muhoza',
    code: 'MAIN',
    district: 'Musanze',
    sector: 'Muhoza',
    isDefault: true,
  },
  {
    name: 'Kinigi collection point',
    code: 'KINIGI',
    district: 'Musanze',
    sector: 'Kinigi',
    isDefault: false,
  },
]

export interface DemoProductCategory {
  name: string
  nameRw: string
}

export const DEMO_PRODUCT_CATEGORIES: DemoProductCategory[] = [
  { name: 'Produce', nameRw: 'Umusaruro' },
  { name: 'Inputs', nameRw: "Ibikoresho by'ubuhinzi" },
  { name: 'Packaging', nameRw: 'Ibipfunyika' },
  { name: 'Services', nameRw: 'Serivisi' },
]

export interface DemoProduct {
  name: string
  nameRw: string
  category: string
  /** A key from the seeded system units, so nothing here invents a unit. */
  unitKey: string
  trackInventory: boolean
  type: 'GOODS' | 'SERVICE'
  minStockLevel: string | null
  purchasePrice: string | null
  salePrice: string | null
  /** What is in the store when the demonstration starts, per warehouse code. */
  opening: { warehouse: string; quantity: string; unitCost: string | null }[]
}

export const DEMO_PRODUCTS: DemoProduct[] = [
  {
    name: 'Maize grain',
    nameRw: 'Ibigori',
    category: 'Produce',
    unitKey: 'KG',
    trackInventory: true,
    type: 'GOODS',
    minStockLevel: '2000',
    purchasePrice: '380.00',
    salePrice: '450.00',
    opening: [
      { warehouse: 'MAIN', quantity: '14500', unitCost: '380.00' },
      { warehouse: 'KINIGI', quantity: '3200', unitCost: '380.00' },
    ],
  },
  {
    name: 'Beans, red',
    nameRw: 'Ibishyimbo bitukura',
    category: 'Produce',
    unitKey: 'KG',
    trackInventory: true,
    type: 'GOODS',
    minStockLevel: '1000',
    purchasePrice: '720.00',
    salePrice: '850.00',
    opening: [{ warehouse: 'MAIN', quantity: '4800', unitCost: '720.00' }],
  },
  {
    name: 'Irish potatoes',
    nameRw: 'Ibirayi',
    category: 'Produce',
    unitKey: 'KG',
    trackInventory: true,
    type: 'GOODS',
    minStockLevel: '1500',
    purchasePrice: '260.00',
    salePrice: '320.00',
    opening: [{ warehouse: 'KINIGI', quantity: '6400', unitCost: '260.00' }],
  },
  {
    name: 'Fertiliser, NPK 17-17-17',
    nameRw: 'Ifumbire NPK 17-17-17',
    category: 'Inputs',
    unitKey: 'SACK',
    trackInventory: true,
    type: 'GOODS',
    // Deliberately just above what is in the store, so the low-stock warning is visible on the
    // overview from the first load rather than only after somebody records a movement.
    minStockLevel: '40',
    purchasePrice: '28000.00',
    salePrice: '31000.00',
    opening: [{ warehouse: 'MAIN', quantity: '34', unitCost: '28000.00' }],
  },
  {
    name: 'Maize seed, certified',
    nameRw: "Imbuto y'ibigori",
    category: 'Inputs',
    unitKey: 'KG',
    trackInventory: true,
    type: 'GOODS',
    minStockLevel: '200',
    purchasePrice: '1800.00',
    salePrice: '2100.00',
    opening: [{ warehouse: 'MAIN', quantity: '640', unitCost: '1800.00' }],
  },
  {
    name: 'Pesticide, for armyworm',
    nameRw: "Umuti w'ibyonnyi",
    category: 'Inputs',
    unitKey: 'LITRE',
    trackInventory: true,
    type: 'GOODS',
    minStockLevel: '20',
    purchasePrice: '9500.00',
    salePrice: '11000.00',
    opening: [{ warehouse: 'MAIN', quantity: '18', unitCost: '9500.00' }],
  },
  {
    name: 'Sacks, fifty kilogram',
    nameRw: "Amafuka y'ibiro mirongo itanu",
    category: 'Packaging',
    unitKey: 'PIECE',
    trackInventory: true,
    type: 'GOODS',
    minStockLevel: '500',
    purchasePrice: '450.00',
    salePrice: '600.00',
    opening: [{ warehouse: 'MAIN', quantity: '1250', unitCost: '450.00' }],
  },
  {
    name: 'Twine',
    nameRw: 'Umugozi',
    category: 'Packaging',
    unitKey: 'PIECE',
    trackInventory: true,
    type: 'GOODS',
    minStockLevel: null,
    purchasePrice: '1200.00',
    salePrice: null,
    opening: [{ warehouse: 'MAIN', quantity: '85', unitCost: '1200.00' }],
  },
  {
    name: 'Tractor ploughing',
    nameRw: 'Guhinga na tarakteri',
    category: 'Services',
    unitKey: 'HOUR',
    // Not counted, which is what separates a day of tractor hire from a bag of maize. It has no
    // stock level, no minimum and no place on the stock overview.
    trackInventory: false,
    type: 'SERVICE',
    minStockLevel: null,
    purchasePrice: null,
    salePrice: '25000.00',
    opening: [],
  },
  {
    name: 'Transport to Musanze town',
    nameRw: 'Ubwikorezi bwo kujya i Musanze',
    category: 'Services',
    unitKey: 'TRIP',
    trackInventory: false,
    type: 'SERVICE',
    minStockLevel: null,
    purchasePrice: null,
    salePrice: '45000.00',
    opening: [],
  },
]

export interface DemoMovement {
  product: string
  warehouse: string
  type: 'RECEIPT' | 'ISSUE' | 'ADJUSTMENT'
  quantity: string
  month: number
  day: number
  /** Set on a receipt that came from a member, which is what "supplied" on a profile sums over. */
  fromMember: boolean
  reason: string | null
  note: string | null
}

/**
 * A season of movements after the opening balances.
 *
 * Member deliveries through the harvest, inputs sold on to members before planting, one count that
 * disagreed with the record, and a transfer between the two stores — so every screen and every
 * movement type has something real on it.
 */
export const DEMO_MOVEMENTS: DemoMovement[] = [
  {
    product: 'Maize seed, certified',
    warehouse: 'MAIN',
    type: 'ISSUE',
    quantity: '180',
    month: 1,
    day: 18,
    fromMember: false,
    reason: 'Sold to members for planting',
    note: null,
  },
  {
    product: 'Fertiliser, NPK 17-17-17',
    warehouse: 'MAIN',
    type: 'ISSUE',
    quantity: '26',
    month: 2,
    day: 8,
    fromMember: false,
    reason: 'Sold to members for planting',
    note: null,
  },
  {
    product: 'Pesticide, for armyworm',
    warehouse: 'MAIN',
    type: 'ISSUE',
    quantity: '11',
    month: 3,
    day: 12,
    fromMember: false,
    reason: 'Treatment against armyworm',
    note: null,
  },

  {
    product: 'Maize grain',
    warehouse: 'KINIGI',
    type: 'RECEIPT',
    quantity: '2400',
    month: 6,
    day: 10,
    fromMember: true,
    reason: null,
    note: 'Collected at Kinigi',
  },
  {
    product: 'Maize grain',
    warehouse: 'MAIN',
    type: 'RECEIPT',
    quantity: '5800',
    month: 6,
    day: 11,
    fromMember: true,
    reason: null,
    note: null,
  },
  {
    product: 'Sacks, fifty kilogram',
    warehouse: 'MAIN',
    type: 'ISSUE',
    quantity: '160',
    month: 6,
    day: 11,
    fromMember: false,
    reason: 'Packing the first lot',
    note: null,
  },

  {
    product: 'Maize grain',
    warehouse: 'MAIN',
    type: 'RECEIPT',
    quantity: '6900',
    month: 7,
    day: 5,
    fromMember: true,
    reason: null,
    note: null,
  },
  {
    product: 'Beans, red',
    warehouse: 'MAIN',
    type: 'RECEIPT',
    quantity: '2100',
    month: 7,
    day: 6,
    fromMember: true,
    reason: null,
    note: null,
  },
  {
    product: 'Maize grain',
    warehouse: 'MAIN',
    type: 'ADJUSTMENT',
    quantity: '27050',
    month: 7,
    day: 31,
    fromMember: false,
    reason: 'Counted at the end of July, spillage during loading',
    note: null,
  },

  {
    product: 'Irish potatoes',
    warehouse: 'KINIGI',
    type: 'RECEIPT',
    quantity: '3100',
    month: 8,
    day: 2,
    fromMember: true,
    reason: null,
    note: null,
  },
  {
    product: 'Sacks, fifty kilogram',
    warehouse: 'MAIN',
    type: 'RECEIPT',
    quantity: '400',
    month: 8,
    day: 20,
    fromMember: false,
    reason: null,
    note: 'Bought in Musanze town',
  },
]

/** Stock moved between the two stores, which is the only way the transfer screen has anything on it. */
export const DEMO_TRANSFERS = [
  { product: 'Maize grain', from: 'KINIGI', to: 'MAIN', quantity: '2800', month: 6, day: 24 },
  { product: 'Irish potatoes', from: 'KINIGI', to: 'MAIN', quantity: '1500', month: 8, day: 14 },
] as const
