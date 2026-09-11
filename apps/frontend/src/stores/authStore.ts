import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  AuthUser,
  Membership,
  PermissionKey,
  RoleKey,
  SessionSummary,
} from '@coopmanage/shared'

/**
 * The session, as the interface sees it.
 *
 * The access token lives here and nowhere else — in memory, never in `localStorage`, because
 * anything in storage is readable by any script that gets onto the page. It is gone when the tab
 * closes, and the `HttpOnly` refresh cookie is what brings a returning user back in.
 *
 * The only thing persisted is which cooperative the user was last working in, which is a
 * preference rather than a credential. It is checked against the memberships the server returns
 * before it is used, so a stale id cannot select a cooperative the user has since left.
 */
export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

interface AuthState {
  status: SessionStatus
  accessToken: string | null
  user: AuthUser | null
  memberships: Membership[]
  activeCooperativeId: string | null
  roleKey: RoleKey | null
  permissions: ReadonlySet<PermissionKey>

  setAccessToken: (token: string | null) => void
  applySession: (summary: SessionSummary) => void
  setActiveCooperative: (cooperativeId: string | null) => void
  signedOut: () => void
}

const EMPTY_PERMISSIONS: ReadonlySet<PermissionKey> = new Set()

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      status: 'unknown',
      accessToken: null,
      user: null,
      memberships: [],
      activeCooperativeId: null,
      roleKey: null,
      permissions: EMPTY_PERMISSIONS,

      setAccessToken: (token) => set({ accessToken: token }),

      applySession: (summary) => {
        const memberships = summary.memberships
        const remembered = get().activeCooperativeId
        // A remembered cooperative is only honoured if the server still lists it. Somebody removed
        // from a cooperative must not keep sending its id in a header and collecting refusals.
        const active =
          summary.cooperative?.id ??
          (remembered && memberships.some((row) => row.cooperativeId === remembered)
            ? remembered
            : (memberships[0]?.cooperativeId ?? null))

        set({
          status: 'authenticated',
          user: summary.user,
          memberships,
          activeCooperativeId: active,
          roleKey: summary.roleKey,
          permissions: new Set(summary.permissions),
        })
      },

      setActiveCooperative: (cooperativeId) =>
        set({
          activeCooperativeId: cooperativeId,
          // The permission set belongs to the cooperative it was resolved in. Keeping it across a
          // switch would briefly show controls the user may not have in the new one.
          roleKey: null,
          permissions: EMPTY_PERMISSIONS,
        }),

      signedOut: () =>
        set({
          status: 'anonymous',
          accessToken: null,
          user: null,
          memberships: [],
          roleKey: null,
          permissions: EMPTY_PERMISSIONS,
        }),
    }),
    {
      name: 'coopmanage.session',
      // Deliberately not the token, the user or the permissions: only the preference.
      partialize: (state) => ({ activeCooperativeId: state.activeCooperativeId }),
    },
  ),
)

/** Non-React access, for the API client. */
export const authState = {
  accessToken: (): string | null => useAuthStore.getState().accessToken,
  cooperativeId: (): string | null => useAuthStore.getState().activeCooperativeId,
  setAccessToken: (token: string | null): void => useAuthStore.getState().setAccessToken(token),
  signedOut: (): void => useAuthStore.getState().signedOut(),
}
