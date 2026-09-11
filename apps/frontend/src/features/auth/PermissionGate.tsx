import type { ReactNode } from 'react'
import type { PermissionKey } from '@coopmanage/shared'
import { usePermission } from './useSession'

export interface PermissionGateProps {
  permission: PermissionKey
  children: ReactNode
  /** Shown instead of the children. Omit it to render nothing at all. */
  fallback?: ReactNode
}

/**
 * Renders its children only when the user holds the permission.
 *
 * Use it to omit a control the user could not use anyway. It is a usability affordance and never a
 * security boundary: every endpoint behind every control re-checks server-side, so a user who
 * reaches one by other means is still refused.
 */
export function PermissionGate({ permission, children, fallback = null }: PermissionGateProps) {
  return usePermission(permission) ? <>{children}</> : <>{fallback}</>
}
