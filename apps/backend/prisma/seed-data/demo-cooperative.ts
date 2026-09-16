import type { RoleKey } from '@coopmanage/shared'

/**
 * The demonstration cooperative. Realistic rather than illustrative: a genuine Rwandan cooperative
 * name, a real district and sector in Musanze, Rwandan staff names and RWF throughout. Nothing in
 * here is "Test Company" or "John Doe", because a demonstration that looks fake teaches nothing
 * about how the screens read when they are full.
 *
 * It is flagged once, on the cooperative (`isDemo`). Everything reachable from it by foreign key
 * is demonstration data by definition, and the interface shows a badge beside the name wherever it
 * appears. Later phases add members, products, sales and meetings to this same cooperative.
 */
export const DEMO_COOPERATIVE = {
  code: 'UMURENGE-MUSANZE',
  name: 'Umurenge Farmers Cooperative',
  typeKey: 'AGRICULTURE',
  registrationNumber: 'RCA/2019/NP/0428',
  tinNumber: '103829471',
  province: 'NORTHERN',
  district: 'Musanze',
  sector: 'Muhoza',
  cell: 'Kabaya',
  village: 'Nyabisindu',
  addressLine: 'KG 21 Ave, Muhoza',
  phone: '+250 788 300 412',
  email: 'ubuyobozi@umurenge-coop.rw',
  foundedOn: '2019-03-14',
  memberCodePrefix: 'UMU',
  defaultLocale: 'RW',
} as const

export interface DemoStaffSeed {
  email: string
  fullName: string
  phone: string
  roleKey: Exclude<RoleKey, 'SYSTEM_ADMIN'>
  jobTitle: string
  locale: 'EN' | 'RW'
}

export const DEMO_STAFF: DemoStaffSeed[] = [
  {
    email: 'uwimana.claudine@umurenge-coop.rw',
    fullName: 'Claudine Uwimana',
    phone: '+250 788 300 413',
    roleKey: 'MANAGER',
    jobTitle: "Umuyobozi w'amakoperative",
    locale: 'RW',
  },
  {
    email: 'habimana.eric@umurenge-coop.rw',
    fullName: 'Eric Habimana',
    phone: '+250 788 300 414',
    roleKey: 'ACCOUNTANT',
    jobTitle: 'Umubaruramari',
    locale: 'RW',
  },
  {
    email: 'mukamana.solange@umurenge-coop.rw',
    fullName: 'Solange Mukamana',
    phone: '+250 788 300 415',
    roleKey: 'SECRETARY',
    jobTitle: 'Umunyamabanga',
    locale: 'RW',
  },
  {
    email: 'nsengimana.patrick@umurenge-coop.rw',
    fullName: 'Patrick Nsengimana',
    phone: '+250 788 300 416',
    roleKey: 'INVENTORY_OFFICER',
    jobTitle: 'Ushinzwe ububiko',
    locale: 'RW',
  },
  {
    email: 'ingabire.aline@umurenge-coop.rw',
    fullName: 'Aline Ingabire',
    phone: '+250 788 300 417',
    roleKey: 'VIEWER',
    jobTitle: "Ugenzuzi w'imari",
    locale: 'EN',
  },
]
