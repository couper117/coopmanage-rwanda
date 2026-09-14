import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PermissionKey, RoleKey } from '@coopmanage/shared'
import { useAuthStore } from '@/stores/authStore'
import {
  deactivateStaff,
  fetchOverrides,
  fetchPermissionCatalogue,
  fetchRoles,
  fetchStaff,
  inviteStaff,
  putOverrides,
  updateStaff,
  type InviteStaffInput,
  type StaffFilters,
} from './staff.api'

/** Namespaced by cooperative, so switching tenant cannot show the previous roster. */
function keys(cooperativeId: string | null) {
  return {
    all: ['staff', cooperativeId] as const,
    list: (filters: StaffFilters) => ['staff', cooperativeId, 'list', filters] as const,
    roles: ['staff', cooperativeId, 'roles'] as const,
    catalogue: ['staff', cooperativeId, 'permissions'] as const,
    overrides: (staffId: string) => ['staff', cooperativeId, 'overrides', staffId] as const,
  }
}

function useCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useStaffList(filters: StaffFilters) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: keys(cooperativeId).list(filters),
    queryFn: () => fetchStaff(filters),
    enabled: cooperativeId !== null,
  })
}

export function useRoles() {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: keys(cooperativeId).roles,
    queryFn: fetchRoles,
    enabled: cooperativeId !== null,
    // Roles change only when the platform is reseeded, so they are not re-read on every visit.
    staleTime: 10 * 60_000,
  })
}

export function usePermissionCatalogue(enabled: boolean) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: keys(cooperativeId).catalogue,
    queryFn: fetchPermissionCatalogue,
    enabled: enabled && cooperativeId !== null,
    staleTime: 10 * 60_000,
  })
}

export function useStaffOverrides(staffId: string | null) {
  const cooperativeId = useCooperativeId()
  return useQuery({
    queryKey: keys(cooperativeId).overrides(staffId ?? 'none'),
    queryFn: () => fetchOverrides(staffId as string),
    enabled: staffId !== null && cooperativeId !== null,
  })
}

/**
 * Every staff mutation invalidates the whole staff namespace rather than patching one row. A role
 * change alters the override count, the roster order and possibly the caller's own permissions, so
 * refetching is both simpler and more truthful than reconciling by hand.
 */
function useStaffMutation<TInput, TResult>(mutationFn: (input: TInput) => Promise<TResult>) {
  const cooperativeId = useCooperativeId()
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: keys(cooperativeId).all }),
  })
}

export function useInviteStaff() {
  return useStaffMutation((input: InviteStaffInput) => inviteStaff(input))
}

export function useUpdateStaff() {
  return useStaffMutation(
    (input: {
      id: string
      roleKey?: RoleKey
      jobTitle?: string | null
      status?: 'ACTIVE' | 'INACTIVE'
    }) => {
      const { id, ...rest } = input
      return updateStaff(id, rest)
    },
  )
}

export function useDeactivateStaff() {
  return useStaffMutation((input: { id: string; reason?: string }) =>
    deactivateStaff(input.id, input.reason),
  )
}

export function usePutOverrides() {
  return useStaffMutation(
    (input: {
      id: string
      overrides: { permission: PermissionKey; effect: 'GRANT' | 'DENY'; reason?: string }[]
    }) => putOverrides(input.id, input.overrides),
  )
}
