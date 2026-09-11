import type { Locale, PermissionKey, RoleKey } from '@coopmanage/shared'

/**
 * What the application knows about the caller, built once per request by the authentication and
 * tenant-resolution middleware and then treated as read-only. Services take what they need from
 * here rather than reaching back into headers, so there is exactly one place a tenant is decided.
 *
 * `cooperative`, `staff` and the contents of `permissions` are present only when the request named
 * an active cooperative it may act in. A request without one is authenticated and holds no
 * cooperative permissions at all, which is why `requirePermission` refuses it.
 */
export interface RequestContext {
  requestId: string
  /**
   * The session family the access token was minted for. Carried so the profile screen can mark
   * "this device" and a password change can spare the device making it, without the refresh
   * cookie, which is deliberately not sent to those endpoints.
   */
  sessionFamilyId: string
  user: {
    id: string
    email: string
    fullName: string
    isPlatformAdmin: boolean
    locale: Locale
  }
  cooperative?: { id: string; name: string; code: string; isDemo: boolean }
  staff?: { id: string; roleKey: RoleKey }
  permissions: ReadonlySet<PermissionKey>
}

/** A label for the audit trail, captured at the time so the log survives a later rename. */
export function actorLabel(user: RequestContext['user']): string {
  return `${user.fullName} <${user.email}>`
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      ctx?: RequestContext
    }
  }
}
