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
  SlidersHorizontal,
  ShoppingCart,
  Users,
  UsersRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { ModuleKey, PermissionKey } from '@coopmanage/shared'

export interface NavItem {
  /** Key into the `nav` translation namespace. */
  key: string
  to: string
  icon: LucideIcon
  /** Permission required to see the item. Enforced again by the backend on every request. */
  permission: PermissionKey
  /**
   * The module this item belongs to, when the cooperative can switch it off. An item with no
   * module is always shown to anyone holding its permission.
   *
   * Module availability and permission are separate questions: a module can be on for the whole
   * cooperative and still be invisible to a member of staff whose role does not cover it, and
   * switching one off never weakens a permission check on the server.
   */
  module?: ModuleKey
  /** The phase that delivers the screen. Until then the route shows an honest status page. */
  availableFromPhase: number
  /**
   * The letter that reaches the screen after `g`, for a keyboard user. One letter, unique across
   * every item, and only offered for items the reader can see — `useKeyboardShortcuts` explains.
   */
  shortcut?: string
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
        shortcut: 'd',
      },
      {
        key: 'assistant',
        module: 'assistant',
        to: '/assistant',
        icon: MessageCircleQuestion,
        permission: 'assistant:use',
        availableFromPhase: 14,
        shortcut: 'a',
      },
      {
        key: 'reports',
        module: 'reports',
        to: '/reports',
        icon: Gauge,
        permission: 'reports:view',
        availableFromPhase: 8,
        shortcut: 'r',
      },
    ],
  },
  {
    key: 'cooperative',
    items: [
      {
        key: 'members',
        module: 'members',
        to: '/members',
        icon: Users,
        permission: 'members:view',
        availableFromPhase: 4,
        shortcut: 'm',
      },
      {
        key: 'contributions',
        module: 'contributions',
        to: '/contributions',
        icon: Coins,
        permission: 'contributions:view',
        availableFromPhase: 4,
        shortcut: 'c',
      },
      {
        key: 'meetings',
        module: 'meetings',
        to: '/meetings',
        icon: ClipboardList,
        permission: 'meetings:view',
        availableFromPhase: 9,
        shortcut: 'e',
      },
      {
        key: 'documents',
        module: 'documents',
        to: '/documents',
        icon: FileText,
        permission: 'documents:view',
        availableFromPhase: 9,
        shortcut: 'o',
      },
      {
        key: 'announcements',
        module: 'announcements',
        to: '/announcements',
        icon: Megaphone,
        permission: 'announcements:view',
        availableFromPhase: 12,
        shortcut: 'n',
      },
    ],
  },
  {
    key: 'operations',
    items: [
      {
        key: 'inventory',
        module: 'inventory',
        to: '/inventory',
        icon: Boxes,
        permission: 'inventory:view',
        availableFromPhase: 6,
        shortcut: 'i',
      },
      {
        key: 'products',
        module: 'products',
        to: '/inventory/products',
        icon: Package,
        permission: 'products:view',
        availableFromPhase: 6,
        shortcut: 'p',
      },
      {
        key: 'sales',
        module: 'sales',
        to: '/sales',
        icon: ShoppingCart,
        permission: 'sales:view',
        availableFromPhase: 7,
        shortcut: 's',
      },
      {
        key: 'buyers',
        module: 'buyers',
        to: '/buyers',
        icon: Handshake,
        permission: 'buyers:view',
        availableFromPhase: 7,
        shortcut: 'b',
      },
    ],
  },
  {
    key: 'money',
    items: [
      {
        key: 'finance',
        module: 'finance',
        to: '/finance',
        icon: Coins,
        permission: 'finance:view',
        availableFromPhase: 5,
        shortcut: 'f',
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
        shortcut: 'u',
      },
      {
        key: 'settings',
        to: '/settings/cooperative',
        icon: Settings,
        permission: 'cooperative:view',
        availableFromPhase: 3,
        shortcut: 'k',
      },
      {
        key: 'preferences',
        to: '/settings/preferences',
        icon: SlidersHorizontal,
        permission: 'cooperative:view',
        availableFromPhase: 3,
        shortcut: 'y',
      },
      {
        key: 'audit',
        to: '/settings/audit',
        icon: ScrollText,
        permission: 'audit:view',
        availableFromPhase: 2,
        shortcut: 'l',
      },
    ],
  },
]

export const ALL_NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items)
