import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CooperativeSettings } from '@coopmanage/shared'
import { useAuthStore } from '@/stores/authStore'
import {
  fetchCooperativeProfile,
  fetchCooperativeSettings,
  putCooperativeSetting,
  updateCooperativeProfile,
  type CooperativeProfile,
  type CooperativeProfileUpdate,
  type CooperativeSettingChange,
} from './cooperative.api'

/**
 * Query keys carry the active cooperative id, so switching cooperative cannot show the previous
 * tenant's cached answer. This is the frontend half of tenant isolation: the backend would refuse
 * a wrong-tenant request anyway, but a stale cache would still put the wrong name on the screen.
 */
export function cooperativeKeys(cooperativeId: string | null) {
  return {
    profile: ['cooperative', cooperativeId, 'profile'] as const,
    settings: ['cooperative', cooperativeId, 'settings'] as const,
  }
}

function useActiveCooperativeId(): string | null {
  return useAuthStore((state) => state.activeCooperativeId)
}

export function useCooperativeProfile() {
  const cooperativeId = useActiveCooperativeId()
  return useQuery({
    queryKey: cooperativeKeys(cooperativeId).profile,
    queryFn: fetchCooperativeProfile,
    enabled: cooperativeId !== null,
  })
}

export function useUpdateCooperativeProfile() {
  const cooperativeId = useActiveCooperativeId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input: CooperativeProfileUpdate) => updateCooperativeProfile(input),
    onSuccess: (profile: CooperativeProfile) => {
      queryClient.setQueryData(cooperativeKeys(cooperativeId).profile, profile)
    },
  })
}

export function useCooperativeSettings() {
  const cooperativeId = useActiveCooperativeId()
  return useQuery({
    queryKey: cooperativeKeys(cooperativeId).settings,
    queryFn: fetchCooperativeSettings,
    enabled: cooperativeId !== null,
  })
}

export function useSaveCooperativeSetting() {
  const cooperativeId = useActiveCooperativeId()
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (change: CooperativeSettingChange) => putCooperativeSetting(change),
    onSuccess: (settings: CooperativeSettings) => {
      queryClient.setQueryData(cooperativeKeys(cooperativeId).settings, settings)
    },
  })
}
