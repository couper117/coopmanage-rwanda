import type { RoleKey } from '@coopmanage/shared'

export const ROLE_DESCRIPTIONS: Record<
  RoleKey,
  { nameEn: string; nameRw: string; descriptionEn: string; descriptionRw: string }
> = {
  MANAGER: {
    nameEn: 'Manager',
    nameRw: 'Umuyobozi',
    descriptionEn: 'Full access to everything in the cooperative',
    descriptionRw: 'Ashobora gukora byose muri koperative',
  },
  ACCOUNTANT: {
    nameEn: 'Accountant',
    nameRw: 'Umubaruramari',
    descriptionEn: 'Records money, contributions and shares, and reports on them',
    descriptionRw: "Yandika amafaranga, imisanzu n'imigabane kandi agakora raporo",
  },
  SECRETARY: {
    nameEn: 'Secretary',
    nameRw: 'Umunyamabanga',
    descriptionEn: 'Manages members, meetings, documents and announcements',
    descriptionRw: "Acunga abanyamuryango, inama, inyandiko n'amatangazo",
  },
  INVENTORY_OFFICER: {
    nameEn: 'Inventory officer',
    nameRw: 'Ushinzwe ububiko',
    descriptionEn: 'Manages products and everything that moves in or out of store',
    descriptionRw: "Acunga ibicuruzwa n'ibyinjira n'ibisohoka mu bubiko",
  },
  VIEWER: {
    nameEn: 'Viewer',
    nameRw: 'Ureba',
    descriptionEn: 'Read-only access, changes nothing',
    descriptionRw: 'Areba gusa, nta cyo ahindura',
  },
  SYSTEM_ADMIN: {
    nameEn: 'System administrator',
    nameRw: 'Ushinzwe sisitemu',
    descriptionEn: 'Manages the platform and its cooperatives, but never their records',
    descriptionRw: 'Acunga sisitemu na koperative, ariko ntahindura inyandiko zazo',
  },
}
