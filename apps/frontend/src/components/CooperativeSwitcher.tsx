import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Building2, Check, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { Badge } from '@/components/ui'
import { useActiveMembership, useSession } from '@/features/auth/useSession'
import { loadSession } from '@/features/auth/useSession'
import { cn } from '@/lib/cn'
import { useAuthStore } from '@/stores/authStore'

/**
 * Switching between cooperatives, for the handful of people who serve more than one.
 *
 * When there is only one cooperative this renders its name as plain text rather than a control
 * that does nothing, which is the common case and should not look like a menu.
 *
 * Changing cooperative changes the caller's permissions, so the session is reloaded rather than
 * only the header being swapped. Every cached query is keyed by cooperative id and the cache is
 * cleared besides, so nothing from the previous tenant can survive on screen.
 */
export function CooperativeSwitcher() {
  const { t } = useTranslation(['nav', 'common'])
  const { memberships } = useSession()
  const active = useActiveMembership()
  const setActiveCooperative = useAuthStore((state) => state.setActiveCooperative)
  const queryClient = useQueryClient()

  if (memberships.length === 0) return null

  const label = active?.cooperativeName ?? t('nav:noCooperative')

  if (memberships.length === 1) {
    return (
      <div className="flex min-w-0 items-center gap-2">
        <Building2
          aria-hidden="true"
          className="size-4 shrink-0 text-ink-muted"
          strokeWidth={1.75}
        />
        <span className="truncate text-base font-medium text-ink">{label}</span>
        {active?.isDemo ? <DemoBadge /> : null}
      </div>
    )
  }

  async function choose(cooperativeId: string): Promise<void> {
    if (cooperativeId === active?.cooperativeId) return
    setActiveCooperative(cooperativeId)
    // The new cooperative decides the permission set, so the session is re-read before any screen
    // renders against it.
    queryClient.clear()
    await loadSession()
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-base font-medium text-ink hover:bg-surface-subtle"
          aria-label={t('nav:switchCooperative')}
        >
          <Building2
            aria-hidden="true"
            className="size-4 shrink-0 text-ink-muted"
            strokeWidth={1.75}
          />
          <span className="truncate">{label}</span>
          <ChevronsUpDown aria-hidden="true" className="size-3.5 shrink-0 text-ink-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-80 min-w-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-overlay"
        >
          <DropdownMenu.Label className="px-2 py-1.5 text-xs font-semibold tracking-wider text-ink-muted uppercase">
            {t('nav:yourCooperatives')}
          </DropdownMenu.Label>
          {memberships.map((membership) => {
            const isActive = membership.cooperativeId === active?.cooperativeId
            return (
              <DropdownMenu.Item
                key={membership.cooperativeId}
                onSelect={() => {
                  void choose(membership.cooperativeId)
                }}
                className={cn(
                  'flex cursor-pointer items-start justify-between gap-3 rounded-md px-2 py-1.5',
                  'text-base text-ink outline-none data-[highlighted]:bg-surface-subtle',
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-medium">{membership.cooperativeName}</span>
                  <span className="block truncate text-sm text-ink-muted">
                    {membership.cooperativeCode}
                  </span>
                </span>
                {isActive ? (
                  <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary-600" />
                ) : null}
              </DropdownMenu.Item>
            )
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/**
 * The demonstration badge. It appears everywhere the cooperative is named, so nobody can mistake
 * seeded practice data for their own records.
 */
export function DemoBadge() {
  const { t } = useTranslation('common')
  return (
    <Badge tone="warning" className="shrink-0">
      {t('demoData')}
    </Badge>
  )
}
