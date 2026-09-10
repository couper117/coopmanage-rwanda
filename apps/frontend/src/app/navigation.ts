import {
  Boxes,
  ClipboardList,
  Coins,
  FileText,
  Gauge,
  Handshake,
  LayoutDashboard,
  Megaphone,
  MessageCircleQuestion,
  Package,
  ScrollText,
  Settings,
  ShoppingCart,
  Users,
  UsersRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PermissionKey } from '@coopmanage/shared'

export interface NavItem {
  /** Key into the `nav` translation namespace. */
  key: string
  to: string
  icon: LucideIcon
  /** Permission required to see the item. Enforced again by the backend on every request. */
  permission: PermissionKey
  /** The phase that delivers the screen. Until then the route shows an honest status page. */
  availableFromPhase: number
}

export interface NavGroup {
  key: string
  items: NavItem[]
}

/**
 * The information architecture from docs/ui-system.md section 5. Items the user has no permission
 * for are not rendered, and a group with no visible items disappears entirely.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: 'overview',
    items: [
      {
        key: 'dashboard',
        to: '/',
        icon: LayoutDashboard,
        permission: 'dashboard:view',
        availableFromPhase: 1,
      },
      {
        key: 'assistant',
        to: '/assistant',
        icon: MessageCircleQuestion,
        permission: 'assistant:use',
        availableFromPhase: 14,
      },
      {
        key: 'reports',
        to: '/reports',
        icon: Gauge,
        permission: 'reports:view',
        availableFromPhase: 8,
      },
    ],
  },
  {
    key: 'cooperative',
    items: [
      {
        key: 'members',
        to: '/members',
        icon: Users,
        permission: 'members:view',
        availableFromPhase: 4,
      },
      {
        key: 'contributions',
        to: '/contributions',
        icon: Coins,
        permission: 'contributions:view',
        availableFromPhase: 4,
      },
      {
        key: 'meetings',
        to: '/meetings',
        icon: ClipboardList,
        permission: 'meetings:view',
        availableFromPhase: 9,
      },
      {
        key: 'documents',
        to: '/documents',
        icon: FileText,
        permission: 'documents:view',
        availableFromPhase: 9,
      },
      {
        key: 'announcements',
        to: '/announcements',
        icon: Megaphone,
        permission: 'announcements:view',
        availableFromPhase: 12,
      },
    ],
  },
  {
    key: 'operations',
    items: [
      {
        key: 'inventory',
        to: '/inventory',
        icon: Boxes,
        permission: 'inventory:view',
        availableFromPhase: 6,
      },
      {
        key: 'products',
        to: '/inventory/products',
        icon: Package,
        permission: 'products:view',
        availableFromPhase: 6,
      },
      {
        key: 'sales',
        to: '/sales',
        icon: ShoppingCart,
        permission: 'sales:view',
        availableFromPhase: 7,
      },
      {
        key: 'buyers',
        to: '/buyers',
        icon: Handshake,
        permission: 'buyers:view',
        availableFromPhase: 7,
      },
    ],
  },
  {
    key: 'money',
    items: [
      {
        key: 'finance',
        to: '/finance',
        icon: Coins,
        permission: 'finance:view',
        availableFromPhase: 5,
      },
    ],
  },
  {
    key: 'administration',
    items: [
      {
        key: 'staff',
        to: '/settings/staff',
        icon: UsersRound,
        permission: 'staff:view',
        availableFromPhase: 3,
      },
      {
        key: 'settings',
        to: '/settings/cooperative',
        icon: Settings,
        permission: 'cooperative:view',
        availableFromPhase: 3,
      },
      {
        key: 'audit',
        to: '/settings/audit',
        icon: ScrollText,
        permission: 'audit:view',
        availableFromPhase: 2,
      },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)
