/** Closed value sets shared by the API contract and the interface. */

export const LOCALES = ['EN', 'RW'] as const
export type Locale = (typeof LOCALES)[number]

/** The i18next language code for a stored locale. */
export const LOCALE_TO_LANGUAGE: Readonly<Record<Locale, 'en' | 'rw'>> = { EN: 'en', RW: 'rw' }
export const LANGUAGE_TO_LOCALE: Readonly<Record<'en' | 'rw', Locale>> = { en: 'EN', rw: 'RW' }

export const COOPERATIVE_TYPE_KEYS = [
  'AGRICULTURE',
  'DAIRY',
  'COFFEE',
  'LIVESTOCK',
  'HANDICRAFTS',
  'TRADING',
  'TRANSPORT',
  'MANUFACTURING',
  'SERVICES',
  'OTHER',
] as const
export type CooperativeTypeKey = (typeof COOPERATIVE_TYPE_KEYS)[number]

export const UNIT_KEYS = [
  'KG',
  'TONNE',
  'LITRE',
  'UNIT',
  'PIECE',
  'BOX',
  'BAG',
  'SACK',
  'CRATE',
  'BUNCH',
  'HOUR',
  'TRIP',
] as const
export type UnitKey = (typeof UNIT_KEYS)[number]

export const RWANDA_PROVINCES = ['KIGALI', 'NORTHERN', 'SOUTHERN', 'EASTERN', 'WESTERN'] as const
export type Province = (typeof RWANDA_PROVINCES)[number]

export const DEFAULT_CURRENCY = 'RWF'
export const DEFAULT_TIMEZONE = 'Africa/Kigali'
