import type { UnitKey } from '@coopmanage/shared'

export interface UnitSeed {
  key: UnitKey
  nameEn: string
  nameRw: string
  symbol: string
  /** Decimal places the unit is measured to. Whole things get 0; weights and volumes get 3. */
  precision: number
  /** Key of the unit this one converts into, with the factor. Null for a base unit. */
  baseUnitKey?: UnitKey
  factorToBase?: string
}

/**
 * The system-wide units, seeded with a null cooperative id. Cooperatives add their own on top;
 * nothing in the platform assumes kilograms, and the conversion factors exist so a cooperative
 * that receives in sacks and sells in kilograms is not doing arithmetic by hand.
 *
 * Seeded in Phase 2 rather than Phase 1 because the table carries a cooperative id and so could
 * not be created before the cooperative table existed. See docs/database.md section 15.
 */
export const SYSTEM_UNITS: UnitSeed[] = [
  { key: 'KG', nameEn: 'Kilogram', nameRw: 'Kilogarama', symbol: 'kg', precision: 3 },
  {
    key: 'TONNE',
    nameEn: 'Tonne',
    nameRw: 'Toni',
    symbol: 't',
    precision: 3,
    baseUnitKey: 'KG',
    factorToBase: '1000',
  },
  { key: 'LITRE', nameEn: 'Litre', nameRw: 'Litiro', symbol: 'L', precision: 3 },
  { key: 'UNIT', nameEn: 'Unit', nameRw: 'Igice', symbol: 'unit', precision: 0 },
  { key: 'PIECE', nameEn: 'Piece', nameRw: 'Igiceri', symbol: 'pc', precision: 0 },
  { key: 'BOX', nameEn: 'Box', nameRw: 'Agasanduku', symbol: 'box', precision: 0 },
  { key: 'BAG', nameEn: 'Bag', nameRw: 'Umufuka', symbol: 'bag', precision: 0 },
  { key: 'SACK', nameEn: 'Sack', nameRw: 'Isaho', symbol: 'sack', precision: 0 },
  { key: 'CRATE', nameEn: 'Crate', nameRw: 'Ikasha', symbol: 'crate', precision: 0 },
  { key: 'BUNCH', nameEn: 'Bunch', nameRw: 'Umutiba', symbol: 'bunch', precision: 0 },
  { key: 'HOUR', nameEn: 'Hour', nameRw: 'Isaha', symbol: 'h', precision: 2 },
  { key: 'TRIP', nameEn: 'Trip', nameRw: 'Urugendo', symbol: 'trip', precision: 0 },
]
