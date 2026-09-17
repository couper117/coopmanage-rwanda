import { isModuleEnabled } from '@coopmanage/shared'
import { useMemo } from 'react'
import { NAV_GROUPS, type NavGroup, type NavItem } from '@/app/navigation'
import { useCooperativeSettings } from '@/features/cooperative/cooperative.hooks'
import { useAuthStore } from '@/stores/authStore'

/**
 * The navigation the signed-in person can see: the groups and items whose permission they hold
 * and whose module the cooperative has switched on, with any group that ends up empty dropped.
 *
 * Both are presentation only. docs/permissions.md §6 is explicit that the backend re-checks every
 * request, and a module being off never relaxes a permission.
 *
 * While the settings are still loading, or for a platform administrator who has no cooperative,
 * every module is treated as available: hiding navigation on a pending query would make the
 * sidebar flicker on every page load.
 *
 * One hook, so the sidebar, the drawer and the keyboard shortcuts agree on what exists. A shortcut
 * to a screen the sidebar does not show would be a second, hidden navigation with its own rules.
 */
export function useVisibleNavigation(): NavGroup[] {
  const permissions = useAuthStore((state) => state.permissions)
  const { data: settings } = useCooperativeSettings()

  return useMemo(() => {
    const moduleAvailable = (item: NavItem): boolean => {
      if (!item.module) return true
      if (!settings) return true
      return isModuleEnabled(item.module, settings)
    }
    return NAV_GROUPS.map((group) => ({
      key: group.key,
      items: group.items.filter(
        (item) => permissions.has(item.permission) && moduleAvailable(item),
      ),
    })).filter((group) => group.items.length > 0)
  }, [permissions, settings])
}
