/**
 * Demonstration members.
 *
 * Real Rwandan given names and family names, combined deterministically so the same seed always
 * produces the same register. No `John Doe`, no `Test Member`: a manager judging whether this
 * software fits their cooperative should see names, places and figures they recognise, and a
 * screenshot of the members screen should look like a cooperative in Musanze rather than a demo.
 *
 * Every row belongs to the cooperative flagged `is_demo`, so the whole set is removable in one
 * step and the interface labels it wherever it appears.
 */

/** Family names, which come first in Rwandan usage and are what a register is sorted by. */
export const FAMILY_NAMES = [
  'Bizimana',
  'Habimana',
  'Hakizimana',
  'Ingabire',
  'Iradukunda',
  'Kamanzi',
  'Kayitesi',
  'Mbabazi',
  'Mukamana',
  'Mukandayisenga',
  'Munyaneza',
  'Murekatete',
  'Mutesi',
  'Nadine',
  'Nkurunziza',
  'Nsengimana',
  'Ntawukuriryayo',
  'Nyirahabimana',
  'Nzeyimana',
  'Rwigema',
  'Shyaka',
  'Tuyishime',
  'Uwamahoro',
  'Uwase',
  'Uwimana',
  'Twagirayezu',
  'Niyonzima',
  'Gatera',
  'Karangwa',
  'Mugisha',
] as const

export const FEMALE_NAMES = [
  'Alice',
  'Aline',
  'Chantal',
  'Claudine',
  'Diane',
  'Divine',
  'Esperance',
  'Florence',
  'Grace',
  'Immaculee',
  'Josiane',
  'Marie',
  'Mediatrice',
  'Solange',
  'Vestine',
  'Yvonne',
] as const

export const MALE_NAMES = [
  'Alphonse',
  'Emmanuel',
  'Eric',
  'Fidele',
  'Innocent',
  'Jean Baptiste',
  'Joseph',
  'Moise',
  'Patrick',
  'Pascal',
  'Samuel',
  'Theogene',
  'Thierry',
  'Valens',
  'Vincent',
] as const

/**
 * Sectors and cells of Musanze district, where the demonstration cooperative is registered, so
 * the addresses in the register are places that exist.
 */
export const MUSANZE_LOCATIONS = [
  { sector: 'Muhoza', cells: ['Cyabararika', 'Kigombe', 'Mpenge'] },
  { sector: 'Cyuve', cells: ['Bukinanyana', 'Cyabagarura', 'Migeshi'] },
  { sector: 'Kimonyi', cells: ['Birira', 'Kabeza', 'Nyaruvumu'] },
  { sector: 'Busogo', cells: ['Sahara', 'Nyagisozi', 'Rwebeya'] },
  { sector: 'Gataraga', cells: ['Mudakama', 'Murwa', 'Rungu'] },
  { sector: 'Kinigi', cells: ['Bisoke', 'Kaguhu', 'Nyabigoma'] },
] as const

export interface DemoMemberSeed {
  firstName: string
  lastName: string
  gender: 'FEMALE' | 'MALE'
  /** Roughly a third have no phone number at all, which is the reality the product is built for. */
  phone: string | null
  district: string
  sector: string
  cell: string
  village: string
  joinedOn: string
  position: 'MEMBER' | 'COMMITTEE' | 'SECRETARY' | 'TREASURER' | 'VICE_CHAIR' | 'CHAIRPERSON'
  status: 'ACTIVE' | 'INACTIVE' | 'EXITED'
}

/** Reads a constant list at a wrapped index. Every call site takes the index modulo the length. */
function pick<T>(list: readonly T[], index: number): T {
  const value = list[((index % list.length) + list.length) % list.length]
  if (value === undefined) throw new Error('demo seed list is empty')
  return value
}

/**
 * Builds the register deterministically from an index, so two runs produce identical data and a
 * screenshot taken today matches one taken next week.
 */
export function buildDemoMembers(count: number): DemoMemberSeed[] {
  const members: DemoMemberSeed[] = []

  for (let index = 0; index < count; index += 1) {
    const isFemale = index % 2 === 0
    const given = isFemale ? pick(FEMALE_NAMES, index) : pick(MALE_NAMES, index)
    const family = pick(FAMILY_NAMES, index * 7)
    const place = pick(MUSANZE_LOCATIONS, index)
    const cell = pick(place.cells, index)

    // Two in three have a phone. The rest are the members a cooperative has to reach another way,
    // and they exist in the demonstration data so nobody builds a screen that assumes a number.
    const hasPhone = index % 3 !== 0
    const line = 780_000_000 + index * 137
    const phone = hasPhone ? `+250${line}` : null

    // Joined over the last five years, more recently as the index grows, so the register has a
    // history and the "new this month" figure is not everybody.
    const year = 2021 + Math.floor(index / 26)
    const month = (index % 12) + 1
    const day = (index % 27) + 1
    const joinedOn = `${Math.min(year, 2026)}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`

    // A committee of six, and a handful who have left, so every status and position appears.
    const position: DemoMemberSeed['position'] =
      index === 0
        ? 'CHAIRPERSON'
        : index === 1
          ? 'VICE_CHAIR'
          : index === 2
            ? 'TREASURER'
            : index === 3
              ? 'SECRETARY'
              : index < 6
                ? 'COMMITTEE'
                : 'MEMBER'

    const status: DemoMemberSeed['status'] =
      index % 29 === 28 ? 'EXITED' : index % 17 === 16 ? 'INACTIVE' : 'ACTIVE'

    members.push({
      firstName: given,
      lastName: family,
      gender: isFemale ? 'FEMALE' : 'MALE',
      phone,
      district: 'Musanze',
      sector: place.sector,
      cell,
      village: `${cell} ${(index % 4) + 1}`,
      joinedOn,
      position,
      status,
    })
  }

  return members
}

/**
 * Income and expense categories for the demonstration cooperative, taken from what an agricultural
 * cooperative in Rwanda actually records.
 */
export const DEMO_FINANCE_CATEGORIES = {
  income: [
    { name: 'Sale of produce', nameRw: 'Kugurisha umusaruro' },
    { name: 'Membership fees', nameRw: 'Amafaranga yo kwinjira' },
    { name: 'Share capital', nameRw: 'Imigabane y’igishoro' },
    { name: 'Savings deposits', nameRw: 'Ubwizigame' },
    { name: 'Grants and support', nameRw: 'Inkunga' },
  ],
  expense: [
    { name: 'Seeds and seedlings', nameRw: 'Imbuto' },
    { name: 'Fertiliser', nameRw: 'Ifumbire' },
    { name: 'Transport', nameRw: 'Ubwikorezi' },
    { name: 'Packaging', nameRw: 'Ibipfunyika' },
    { name: 'Labour', nameRw: 'Abakozi b’umunsi' },
    { name: 'Payments to members', nameRw: 'Kwishyura abanyamuryango' },
    { name: 'Office and administration', nameRw: 'Ibiro n’ubuyobozi' },
    { name: 'Bank charges', nameRw: 'Amafaranga ya banki' },
  ],
} as const
