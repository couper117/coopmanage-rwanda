import { Router, type RequestHandler, type Router as ExpressRouter } from 'express'
import type { PermissionKey } from '@coopmanage/shared'

/**
 * Every route is registered through this module so the application can describe its own surface.
 *
 * Express 5 does not expose a router's mount path, so walking the internal stack cannot recover a
 * full path. Recording registration explicitly is both accurate and more useful: each route states
 * its access requirement at the point it is declared, which is what the Phase 2 route-inventory
 * test asserts against and what the OpenAPI document is generated from in Phase 8.
 */

/** What a caller needs in order to reach a route. */
export type RouteAccess =
  /** No session required. Only reference data and health may use this. */
  | { kind: 'PUBLIC' }
  /** A valid session, but no particular permission. Own-profile endpoints. */
  | { kind: 'AUTHENTICATED' }
  /** A session plus this permission, checked server-side. */
  | { kind: 'PERMISSION'; permission: PermissionKey }

export const PUBLIC: RouteAccess = { kind: 'PUBLIC' }
export const AUTHENTICATED: RouteAccess = { kind: 'AUTHENTICATED' }
export function permission(key: PermissionKey): RouteAccess {
  return { kind: 'PERMISSION', permission: key }
}

export interface RegisteredRoute {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'
  /** Full path below the API prefix, for example `/health/ready`. */
  path: string
  access: RouteAccess
}

const registry: RegisteredRoute[] = []

export function registeredRoutes(): readonly RegisteredRoute[] {
  return registry
}

function joinPath(base: string, path: string): string {
  const combined = `${base}/${path}`.replace(/\/{2,}/g, '/')
  return combined.length > 1 ? combined.replace(/\/$/, '') : combined
}

type Method = RegisteredRoute['method']

export interface ModuleRouter {
  readonly router: ExpressRouter
  get(path: string, access: RouteAccess, ...handlers: RequestHandler[]): ModuleRouter
  post(path: string, access: RouteAccess, ...handlers: RequestHandler[]): ModuleRouter
  patch(path: string, access: RouteAccess, ...handlers: RequestHandler[]): ModuleRouter
  put(path: string, access: RouteAccess, ...handlers: RequestHandler[]): ModuleRouter
  delete(path: string, access: RouteAccess, ...handlers: RequestHandler[]): ModuleRouter
}

/**
 * Creates a router whose routes are recorded against `basePath`. The base path must match the path
 * the router is mounted at in `routes.ts`; a mismatch is caught by the route-inventory test, which
 * compares recorded paths against live requests.
 */
export function createModuleRouter(basePath: string): ModuleRouter {
  const router = Router()

  function register(
    method: Method,
    path: string,
    access: RouteAccess,
    handlers: RequestHandler[],
  ): void {
    registry.push({ method, path: joinPath(basePath, path), access })
    switch (method) {
      case 'GET':
        router.get(path, ...handlers)
        break
      case 'POST':
        router.post(path, ...handlers)
        break
      case 'PATCH':
        router.patch(path, ...handlers)
        break
      case 'PUT':
        router.put(path, ...handlers)
        break
      case 'DELETE':
        router.delete(path, ...handlers)
        break
    }
  }

  const moduleRouter: ModuleRouter = {
    router,
    get(path, access, ...handlers) {
      register('GET', path, access, handlers)
      return moduleRouter
    },
    post(path, access, ...handlers) {
      register('POST', path, access, handlers)
      return moduleRouter
    },
    patch(path, access, ...handlers) {
      register('PATCH', path, access, handlers)
      return moduleRouter
    },
    put(path, access, ...handlers) {
      register('PUT', path, access, handlers)
      return moduleRouter
    },
    delete(path, access, ...handlers) {
      register('DELETE', path, access, handlers)
      return moduleRouter
    },
  }

  return moduleRouter
}
