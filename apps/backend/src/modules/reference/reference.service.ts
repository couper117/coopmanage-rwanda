import { prisma } from '../../lib/prisma.js'

export interface CooperativeTypeDto {
  id: string
  key: string
  nameEn: string
  nameRw: string
  descriptionEn: string
  descriptionRw: string
  iconKey: string
  defaultUnitKeys: string[]
}

/**
 * Cooperative types are public reference data. They are needed on the sign-up and cooperative
 * creation screens before any session exists, and they contain nothing tenant-specific.
 */
export async function listCooperativeTypes(): Promise<CooperativeTypeDto[]> {
  const rows = await prisma.cooperativeType.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: 'asc' },
  })
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    nameEn: row.nameEn,
    nameRw: row.nameRw,
    descriptionEn: row.descriptionEn,
    descriptionRw: row.descriptionRw,
    iconKey: row.iconKey,
    defaultUnitKeys: row.defaultUnitKeys,
  }))
}
