import type { CooperativeSettingKey, CooperativeSettings, Membership } from '@coopmanage/shared'
import { apiRequest } from '@/lib/apiClient'

export interface CooperativeProfile {
  id: string
  code: string
  name: string
  type: { key: string; nameEn: string; nameRw: string }
  registrationNumber: string | null
  tinNumber: string | null
  province: string
  district: string
  sector: string
  cell: string
  village: string
  addressLine: string | null
  phone: string | null
  email: string | null
  logoUrl: string | null
  foundedOn: string | null
  status: string
  isDemo: boolean
  currency: string
  timezone: string
  defaultLocale: 'EN' | 'RW'
  memberCodePrefix: string
  fiscalYearStartMonth: number
  createdAt: string
}

export type CooperativeProfileUpdate = Partial<{
  name: string
  registrationNumber: string | null
  tinNumber: string | null
  province: string
  district: string
  sector: string
  cell: string
  village: string
  addressLine: string | null
  phone: string | null
  email: string | null
  foundedOn: string | null
  defaultLocale: 'EN' | 'RW'
  memberCodePrefix: string
  fiscalYearStartMonth: number
}>

/** The cooperatives the caller may act in. Needs no cooperative header: it is how one is chosen. */
export function fetchMyCooperatives(): Promise<Membership[]> {
  return apiRequest<Membership[]>('/cooperatives/mine')
}

export function fetchCooperativeProfile(): Promise<CooperativeProfile> {
  return apiRequest<CooperativeProfile>('/cooperatives/current')
}

export function updateCooperativeProfile(
  input: CooperativeProfileUpdate,
): Promise<CooperativeProfile> {
  return apiRequest<CooperativeProfile>('/cooperatives/current', {
    method: 'PATCH',
    body: input,
  })
}

export function fetchCooperativeSettings(): Promise<CooperativeSettings> {
  return apiRequest<CooperativeSettings>('/settings')
}

/**
 * One key with the value that key takes, as a discriminated union rather than a generic pair. It
 * reads the same at the call site and, unlike a generic, survives being handed to TanStack
 * Query's `mutationFn`, which cannot infer a type parameter of its own.
 */
export type CooperativeSettingChange = {
  [TKey in CooperativeSettingKey]: { key: TKey; value: CooperativeSettings[TKey] }
}[CooperativeSettingKey]

export function putCooperativeSetting(
  change: CooperativeSettingChange,
): Promise<CooperativeSettings> {
  return apiRequest<CooperativeSettings>(`/settings/${change.key}`, {
    method: 'PUT',
    body: { value: change.value },
  })
}
