import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { clearAllCaches } from '@/app/persistCache'
import { clearAllDrafts } from '@/hooks/useFormDraft'
import { useAuthStore } from '@/stores/authStore'
import { logout } from './auth.api'

/**
 * Ending a session. Separate from the menu that triggers it so the behaviour can be tested
 * directly: the menu is a Radix portal, which is not drivable under jsdom for the reasons set out
 * in `test/languageSwitcher.test.tsx`.
 */
export function useSignOut(): { signOut: () => Promise<void>; pending: boolean } {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const signedOut = useAuthStore((state) => state.signedOut)
  const [pending, setPending] = useState(false)

  async function signOut(): Promise<void> {
    setPending(true)
    try {
      await logout()
    } catch {
      // Revoking the session family server-side is the better outcome, but it must not be the
      // condition for signing out here. Leaving somebody apparently signed in because the network
      // dropped is the wrong way to fail, and the access token they hold expires in minutes.
    } finally {
      signedOut()
      // Cached answers belong to the person who was signed in. The next user on a shared office
      // computer must not see them — in memory, and on the disk, where Phase 13 started keeping a
      // copy so a reload during an outage is not a blank afternoon.
      queryClient.clear()
      clearAllCaches()
      // A half-typed member registration is as much the previous person's as their cached figures.
      clearAllDrafts()
      setPending(false)
      await navigate('/login', { replace: true })
    }
  }

  return { signOut, pending }
}
