import type { Locale, PageMeta, Province, SystemSettings } from '@coopmanage/shared'
import { apiRequest, apiRequestCollection } from '@/lib/apiClient'

/**
 * Platform administration, as the interface sees it.
 *
 * Every path here reaches across tenants, which is why the whole surface answers 404 rather than
 * 403 to somebody who is not a platform administrator: an ordinary user must not be able to
 * discover that these endpoints exist. Nothing in this file sends a cooperative id, because these
 * endpoints manage organisations and accounts rather than a cooperative's records.
 */

export const COOPERATIVE_STATUSES = ['ACTIVE', 'SUSPENDED', 'ARCHIVED'] as const
export type CooperativeStatus = (typeof COOPERATIVE_STATUSES)[number]

/** A user account is only ever active or suspended; archiving belongs to cooperatives. */
export const USER_STATUSES = ['ACTIVE', 'SUSPENDED'] as const
export type UserStatus = (typeof USER_STATUSES)[number]

export interface AdminCooperativeRow {
  id: string
  code: string
  name: string
  typeKey: string
  status: CooperativeStatus
  isDemo: boolean
  province: Province
  district: string
  registrationNumber: string | null
  staffCount: number
  activeStaffCount: number
  createdAt: string
}

export interface AdminCooperativeFilters {
  q: string
  status: CooperativeStatus | ''
  includeDemo: boolean
  page: number
  pageSize: number
}

export interface AdminPage<TRow> {
  items: TRow[]
  meta: PageMeta | undefined
}

export function listAdminCooperatives(
  filters: AdminCooperativeFilters,
): Promise<AdminPage<AdminCooperativeRow>> {
  return apiRequestCollection<AdminCooperativeRow>('/admin/cooperatives', {
    query: {
      q: filters.q,
      status: filters.status,
      // Sent only to exclude: the backend includes demonstration cooperatives by default, and an
      // absent parameter is how the list asks for everything.
      includeDemo: filters.includeDemo ? undefined : 'false',
      page: filters.page,
      pageSize: filters.pageSize,
    },
  })
}

export interface CreateCooperativeInput {
  name: string
  /** Upper-case letters, digits and hyphens; the server upper-cases whatever it is given. */
  code: string
  typeKey: string
  registrationNumber?: string
  province: Province
  district: string
  sector: string
  cell: string
  village: string
  defaultLocale?: Locale
  manager: { email: string; fullName: string }
}

/**
 * A cooperative and its first manager are created together, in one transaction. A new manager
 * account is unusable until the setup link the server sends has been followed, so creating a
 * cooperative never mints a password anybody could guess.
 */
export interface CreateCooperativeResult {
  cooperative: AdminCooperativeRow
  manager: { userId: string; email: string; accountCreated: boolean }
}

export function createAdminCooperative(
  input: CreateCooperativeInput,
): Promise<CreateCooperativeResult> {
  return apiRequest<CreateCooperativeResult>('/admin/cooperatives', {
    method: 'POST',
    body: input,
  })
}

export interface UpdateCooperativeInput {
  status?: CooperativeStatus
  name?: string
  /** Recorded in the audit trail alongside the change. */
  reason?: string
}

export function updateAdminCooperative(
  id: string,
  changes: UpdateCooperativeInput,
): Promise<AdminCooperativeRow> {
  return apiRequest<AdminCooperativeRow>(`/admin/cooperatives/${id}`, {
    method: 'PATCH',
    body: changes,
  })
}

export interface AdminUserMembership {
  cooperativeId: string
  cooperativeName: string
  roleKey: string
  status: string
}

export interface AdminUserRow {
  id: string
  email: string
  fullName: string
  status: UserStatus
  isPlatformAdmin: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  lockedUntil: string | null
  memberships: AdminUserMembership[]
  createdAt: string
}

export interface AdminUserFilters {
  q: string
  status: UserStatus | ''
  page: number
  pageSize: number
}

export function listAdminUsers(filters: AdminUserFilters): Promise<AdminPage<AdminUserRow>> {
  return apiRequestCollection<AdminUserRow>('/admin/users', {
    query: {
      q: filters.q,
      status: filters.status,
      page: filters.page,
      pageSize: filters.pageSize,
    },
  })
}

export interface CreateUserInput {
  email: string
  fullName: string
  isPlatformAdmin?: boolean
  locale?: Locale
}

export function createAdminUser(input: CreateUserInput): Promise<AdminUserRow> {
  return apiRequest<AdminUserRow>('/admin/users', { method: 'POST', body: input })
}

export interface UpdateUserInput {
  fullName?: string
  status?: UserStatus
  isPlatformAdmin?: boolean
  reason?: string
}

export function updateAdminUser(id: string, changes: UpdateUserInput): Promise<AdminUserRow> {
  return apiRequest<AdminUserRow>(`/admin/users/${id}`, { method: 'PATCH', body: changes })
}

export function fetchPlatformSettings(): Promise<SystemSettings> {
  return apiRequest<SystemSettings>('/admin/settings')
}

/** The one platform setting there is. The server refuses any other key. */
export function saveDefaultCooperativeLocale(value: Locale): Promise<SystemSettings> {
  return apiRequest<SystemSettings>('/admin/settings/defaultCooperativeLocale', {
    method: 'PUT',
    body: { value },
  })
}

export interface PlatformHealth {
  database: { reachable: boolean; latencyMs: number | null }
  counts: {
    cooperatives: number
    activeCooperatives: number
    users: number
    activeUsers: number
    platformAdmins: number
  }
  timestamp: string
}

export function fetchPlatformHealth(): Promise<PlatformHealth> {
  return apiRequest<PlatformHealth>('/admin/health')
}

export interface CooperativeType {
  id: string
  key: string
  nameEn: string
  nameRw: string
  descriptionEn: string
  descriptionRw: string
  iconKey: string
  defaultUnitKeys: string[]
}

/** Public reference data: the type picker needs it before a cooperative exists. */
export function fetchCooperativeTypes(): Promise<CooperativeType[]> {
  return apiRequest<CooperativeType[]>('/cooperative-types')
}
