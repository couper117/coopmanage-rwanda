import type { PermissionKey, RoleKey } from '@coopmanage/shared'
import { apiRequest } from '@/lib/apiClient'

export interface StaffMember {
  id: string
  user: { id: string; email: string; fullName: string; status: string; lastLoginAt: string | null }
  roleKey: RoleKey
  roleName: { en: string; rw: string }
  jobTitle: string | null
  status: 'ACTIVE' | 'INACTIVE'
  invitedAt: string
  joinedAt: string | null
  deactivatedAt: string | null
  /** True for the caller's own row, so the interface can disable its controls. */
  isSelf: boolean
  overrideCount: number
}

export interface StaffRole {
  key: RoleKey
  nameEn: string
  nameRw: string
  descriptionEn: string
  descriptionRw: string
  permissions: PermissionKey[]
}

export interface CataloguePermission {
  key: PermissionKey
  resource: string
  action: string
  descriptionEn: string
  descriptionRw: string
}

export interface StaffOverride {
  permission: PermissionKey
  effect: 'GRANT' | 'DENY'
  reason: string | null
  grantedBy: string | null
  createdAt: string
}

export interface StaffFilters {
  status?: 'ACTIVE' | 'INACTIVE'
  roleKey?: RoleKey
}

export function fetchStaff(filters: StaffFilters): Promise<StaffMember[]> {
  return apiRequest<StaffMember[]>('/staff', { query: { ...filters } })
}

export function fetchRoles(): Promise<StaffRole[]> {
  return apiRequest<StaffRole[]>('/roles')
}

export function fetchPermissionCatalogue(): Promise<CataloguePermission[]> {
  return apiRequest<CataloguePermission[]>('/permissions')
}

export interface InviteStaffInput {
  email: string
  fullName: string
  roleKey: RoleKey
  jobTitle?: string
}

export interface InviteStaffResult {
  staff: StaffMember
  /** True when the invitation created the account, so the interface can say what happens next. */
  accountCreated: boolean
}

export function inviteStaff(input: InviteStaffInput): Promise<InviteStaffResult> {
  return apiRequest<InviteStaffResult>('/staff/invite', { method: 'POST', body: input })
}

export function updateStaff(
  id: string,
  input: { roleKey?: RoleKey; jobTitle?: string | null; status?: 'ACTIVE' | 'INACTIVE' },
): Promise<StaffMember> {
  return apiRequest<StaffMember>(`/staff/${id}`, { method: 'PATCH', body: input })
}

export function deactivateStaff(id: string, reason?: string): Promise<StaffMember> {
  return apiRequest<StaffMember>(`/staff/${id}/deactivate`, {
    method: 'POST',
    body: { reason: reason ?? '' },
  })
}

export function fetchOverrides(
  id: string,
): Promise<{ staff: StaffMember; overrides: StaffOverride[] }> {
  return apiRequest<{ staff: StaffMember; overrides: StaffOverride[] }>(`/staff/${id}/overrides`)
}

export function putOverrides(
  id: string,
  overrides: { permission: PermissionKey; effect: 'GRANT' | 'DENY'; reason?: string }[],
): Promise<{ staff: StaffMember; overrides: StaffOverride[] }> {
  return apiRequest(`/staff/${id}/overrides`, { method: 'PUT', body: { overrides } })
}
