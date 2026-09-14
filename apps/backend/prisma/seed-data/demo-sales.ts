/**
 * Demonstration buyers and sales.
 *
 * Who an agricultural cooperative in Musanze actually sells to: the district buyer who takes the
 * maize in lots, a school that buys beans for its kitchen, a processor, and a few traders from the
 * market. The sales are the other side of the stock movements the store already has, so the two
 * modules tell one story rather than two.
 *
 * Deterministic like the rest of the demonstration data. One sale is left as a draft and one is
 * cancelled, because every state has to be visible on the screens: a list where everything is
 * confirmed hides the draft badge, the cancel reason and the compensating movements entirely.
 */

export interface DemoBuyer {
  name: string
  organization: string | null
  contactPerson: string | null
  phone: string | null
  tin: string | null
  district: string
  sector: string
}

export const DEMO_BUYERS: DemoBuyer[] = [
  {
    name: 'Musanze District Produce Buyer',
    organization: 'Musanze District',
    contactPerson: 'Habimana Jean Baptiste',
    phone: '+250788301122',
    tin: '102345678',
    district: 'Musanze',
    sector: 'Muhoza',
  },
  {
    name: 'Groupe Scolaire Kinigi',
    organization: 'Groupe Scolaire Kinigi',
    contactPerson: 'Mukamana Immaculee',
    phone: '+250788412233',
    tin: null,
    district: 'Musanze',
    sector: 'Kinigi',
  },
  {
    name: 'Ruhengeri Grain Millers',
    organization: 'Ruhengeri Grain Millers Ltd',
    contactPerson: 'Nkurunziza Eric',
    phone: '+250788523344',
    tin: '103456789',
    district: 'Musanze',
    sector: 'Muhoza',
  },
  {
    // A market trader, with a name and a telephone number and nothing else, which is the common
    // case and the reason a buyer needs only a name.
    name: 'Uwimana Vestine',
    organization: null,
    contactPerson: null,
    phone: '+250788634455',
    tin: null,
    district: 'Musanze',
    sector: 'Cyuve',
  },
]

export interface DemoSaleLine {
  product: string
  quantity: string
  unitPrice: string
}

export interface DemoSale {
  buyer: string
  month: number
  day: number
  lines: DemoSaleLine[]
  discount: string | null
  /** `DRAFT` leaves it unconfirmed; `CANCELLED` confirms then cancels, so the history shows both. */
  state: 'CONFIRMED' | 'DRAFT' | 'CANCELLED'
  /** What was paid at the counter. Null means the buyer was invoiced and still owes. */
  paid: string | null
  cancelReason: string | null
  note: string | null
}

export const DEMO_SALES: DemoSale[] = [
  {
    buyer: 'Musanze District Produce Buyer',
    month: 6,
    day: 12,
    lines: [{ product: 'Maize grain', quantity: '7000', unitPrice: '450' }],
    discount: null,
    state: 'CONFIRMED',
    paid: '3150000.00',
    cancelReason: null,
    note: 'First lot of the season, collected from the main store',
  },
  {
    buyer: 'Musanze District Produce Buyer',
    month: 7,
    day: 9,
    lines: [{ product: 'Maize grain', quantity: '8200', unitPrice: '450' }],
    discount: '150000.00',
    state: 'CONFIRMED',
    // Part paid at the counter and the rest invoiced, so the outstanding column has something in
    // it and the payment screen has a sale to work on.
    paid: '2500000.00',
    cancelReason: null,
    note: 'Second lot, discount agreed for the volume',
  },
  {
    buyer: 'Groupe Scolaire Kinigi',
    month: 8,
    day: 4,
    lines: [{ product: 'Beans, red', quantity: '1900', unitPrice: '850' }],
    discount: null,
    state: 'CONFIRMED',
    paid: '1615000.00',
    cancelReason: null,
    note: 'Beans for the school kitchen',
  },
  {
    buyer: 'Ruhengeri Grain Millers',
    month: 8,
    day: 22,
    lines: [
      { product: 'Maize grain', quantity: '1200', unitPrice: '470' },
      { product: 'Sacks, fifty kilogram', quantity: '24', unitPrice: '600' },
    ],
    discount: null,
    state: 'CANCELLED',
    paid: null,
    cancelReason: 'The buyer rejected the moisture content on delivery',
    note: null,
  },
  {
    buyer: 'Uwimana Vestine',
    month: 9,
    day: 8,
    lines: [
      { product: 'Irish potatoes', quantity: '400', unitPrice: '320' },
      { product: 'Beans, red', quantity: '150', unitPrice: '850' },
    ],
    discount: null,
    state: 'CONFIRMED',
    paid: '255500.00',
    cancelReason: null,
    note: 'Sold at the store counter',
  },
  {
    // Written up and not yet confirmed, which is the state a sale spends most of its life in at a
    // busy store counter.
    buyer: 'Ruhengeri Grain Millers',
    month: 9,
    day: 12,
    lines: [{ product: 'Maize grain', quantity: '2500', unitPrice: '470' }],
    discount: null,
    state: 'DRAFT',
    paid: null,
    cancelReason: null,
    note: 'Agreed on the telephone, waiting for the lorry',
  },
]
