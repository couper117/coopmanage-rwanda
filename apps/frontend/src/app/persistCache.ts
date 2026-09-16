import { dehydrate, hydrate, type DehydratedState, type QueryClient } from '@tanstack/react-query'

/**
 * The last thing the cooperative saw, kept across a reload.
 *
 * The situation this is for is ordinary here and rare in the places most software is written: a
 * secretary is halfway through the afternoon's work, the district office's link drops, and the
 * browser reloads — a crash, a closed laptop, somebody clicking refresh out of habit. Without
 * this, every screen comes back empty and the afternoon stops until the connection does. With it,
 * the member register and this month's figures are still there, marked as what was last seen.
 *
 * **What is written, and where.** The query cache, dehydrated to `localStorage`, under a key naming
 * the signed-in user and the cooperative they were working in. That is a cooperative's own data on
 * the disk of the computer it was already being read on, and nothing that was not already on the
 * screen. It is **not** the access token, which stays in memory for exactly the reasons
 * `docs/security.md` §3 gives.
 *
 * Four rules keep it honest:
 *
 * - **Scoped to the reader.** The key holds the user id and the cooperative id, so a shared office
 *   computer cannot hydrate one person's cache into another's session, or one cooperative's figures
 *   into another cooperative's screens.
 * - **Cleared on sign-out.** Every key, not only the current one. A cooperative that signs out on a
 *   shared machine has left nothing behind.
 * - **Expires.** A day old is stale enough that showing it would mislead rather than help.
 * - **Busted by the build.** A deployment that changes the shape of a response must not hydrate
 *   yesterday's shape into today's screens.
 */

const PREFIX = 'coopmanage.cache'

/** A day. Long enough to survive a night, short enough that nothing misleads. */
const MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Changes whenever the application is rebuilt, so a deployment discards what it cannot trust.
 * Vite replaces this at build time; in development it is a constant, which is what makes a
 * hot-reloaded session keep its cache.
 */
const BUSTER = import.meta.env.VITE_BUILD_ID ?? 'dev'

interface StoredCache {
  buster: string
  savedAt: number
  state: DehydratedState
}

function keyFor(userId: string, cooperativeId: string): string {
  return `${PREFIX}:${userId}:${cooperativeId}`
}

/** Reads a value, treating any storage failure as "nothing stored". */
function read(key: string): StoredCache | null {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCache
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed
  } catch {
    // A private window, cleared site data, a browser set to block storage. None of these is an
    // error worth reporting: the application simply has no cache to start from.
    return null
  }
}

/**
 * Puts the stored cache back, if there is one and it can be trusted.
 *
 * Returns whether anything was restored, so the shell can say what a reader is looking at.
 */
export function hydrateCache(
  client: QueryClient,
  session: { userId: string; cooperativeId: string },
  now = Date.now(),
): boolean {
  if (typeof window === 'undefined') return false

  const stored = read(keyFor(session.userId, session.cooperativeId))
  if (!stored) return false

  if (stored.buster !== BUSTER || now - stored.savedAt > MAX_AGE_MS) {
    clearCacheFor(session)
    return false
  }

  try {
    hydrate(client, stored.state)
    return true
  } catch {
    // A stored shape this build cannot read. Discard it rather than leave a half-hydrated cache.
    clearCacheFor(session)
    return false
  }
}

/**
 * Starts saving the cache, and returns the unsubscribe.
 *
 * Throttled, because the cache changes on every fetch and serialising it on each one would put a
 * few milliseconds of JSON work in front of every list a reader scrolls.
 */
export function persistCache(
  client: QueryClient,
  session: { userId: string; cooperativeId: string },
  throttleMs = 2000,
): () => void {
  if (typeof window === 'undefined') return () => undefined

  const key = keyFor(session.userId, session.cooperativeId)
  let timer: ReturnType<typeof setTimeout> | null = null

  const save = (): void => {
    timer = null
    try {
      const payload: StoredCache = {
        buster: BUSTER,
        savedAt: Date.now(),
        // `dehydrate`'s default takes successful queries only, which is what should survive a
        // reload: a failed request is not a fact about the cooperative.
        state: dehydrate(client),
      }
      window.localStorage.setItem(key, JSON.stringify(payload))
    } catch {
      // Storage full, or refused. The application keeps working from memory; the only thing lost
      // is the next reload's head start.
    }
  }

  const unsubscribe = client.getQueryCache().subscribe(() => {
    if (timer !== null) return
    timer = setTimeout(save, throttleMs)
  })

  return () => {
    if (timer !== null) clearTimeout(timer)
    unsubscribe()
  }
}

/** Removes one reader's cache for one cooperative. */
export function clearCacheFor(session: { userId: string; cooperativeId: string }): void {
  try {
    window.localStorage.removeItem(keyFor(session.userId, session.cooperativeId))
  } catch {
    // Nothing to do: if storage cannot be written it cannot be holding anything either.
  }
}

/**
 * Removes every cached cooperative for every reader.
 *
 * Called on sign-out. Every key, not just the current one, because the point is that a cooperative
 * signing out of a shared office computer has left nothing on it.
 */
export function clearAllCaches(): void {
  if (typeof window === 'undefined') return
  try {
    const keys: string[] = []
    for (let index = 0; index < window.localStorage.length; index += 1) {
      const key = window.localStorage.key(index)
      if (key?.startsWith(PREFIX)) keys.push(key)
    }
    for (const key of keys) window.localStorage.removeItem(key)
  } catch {
    // As above.
  }
}
