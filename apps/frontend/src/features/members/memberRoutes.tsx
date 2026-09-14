import type { RouteObject } from 'react-router-dom'
import { RequirePermission } from '@/features/auth/RequireAuth'
import { ContributionsPage } from '@/pages/members/ContributionsPage'
import { MemberProfilePage } from '@/pages/members/MemberProfilePage'
import { MembersPage } from '@/pages/members/MembersPage'

/**
 * The member register, mounted inside the application shell.
 *
 * Both screens are guarded by `members:view`, which is the permission their endpoints require.
 * The guard is a courtesy to the user rather than the security boundary: the server checks every
 * request again, and each money block inside a profile is gated separately by the permission
 * covering its own data.
 *
 * There is no route for deleting a member, because there is no such operation: a member is
 * deactivated, suspended or marked as having left, and the record always remains.
 *
 * Exported as data rather than as a built router so tests can mount the same tree in a memory
 * router and assert what a user actually sees.
 */
export const memberRoutes: RouteObject[] = [
  {
    path: 'members',
    element: (
      <RequirePermission permission="members:view">
        <MembersPage />
      </RequirePermission>
    ),
  },
  {
    path: 'members/:id',
    element: (
      <RequirePermission permission="members:view">
        <MemberProfilePage />
      </RequirePermission>
    ),
  },
]

/**
 * The cooperative-wide contributions ledger, guarded by the permission its endpoint requires.
 *
 * Separate from `memberRoutes` because it is reached from the navigation in its own right: a
 * treasurer asked what came in last month goes here, not through a member.
 */
export const contributionRoutes: RouteObject[] = [
  {
    path: 'contributions',
    element: (
      <RequirePermission permission="contributions:view">
        <ContributionsPage />
      </RequirePermission>
    ),
  },
]
