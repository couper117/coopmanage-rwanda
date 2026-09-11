import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { LogOut, User } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { useActiveMembership, useSession } from '@/features/auth/useSession'
import { useSignOut } from '@/features/auth/useSignOut'

/** The two initials a Rwandan name gives: "Claudine Uwimana" reads as CU. */
function initials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('') || '?'
}

export function UserMenu() {
  const { t } = useTranslation(['common', 'nav', 'profile'])
  const { user } = useSession()
  const membership = useActiveMembership()
  const navigate = useNavigate()
  const { signOut, pending } = useSignOut()

  if (!user) return null

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="flex h-8 items-center gap-2 rounded-md pr-1 pl-1 text-sm font-medium text-ink-secondary hover:bg-surface-subtle hover:text-ink"
        >
          <span
            aria-hidden="true"
            className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary-100 text-2xs font-semibold text-primary-700"
          >
            {initials(user.fullName)}
          </span>
          <span className="hidden max-w-32 truncate sm:block">{user.fullName}</span>
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          className="z-50 min-w-56 rounded-lg border border-line bg-surface p-1 shadow-overlay"
        >
          <div className="border-b border-line px-2 py-2">
            <p className="truncate text-base font-medium text-ink">{user.fullName}</p>
            <p className="truncate text-xs text-ink-muted">{user.email}</p>
            {membership ? (
              <p className="mt-1 truncate text-xs text-ink-muted">
                {membership.cooperativeName} · {t(`profile:roles.${membership.roleKey}`)}
              </p>
            ) : null}
          </div>

          <DropdownMenu.Item
            onSelect={() => void navigate('/profile')}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-base text-ink outline-none data-[highlighted]:bg-surface-subtle"
          >
            <User aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {t('nav:items.profile')}
          </DropdownMenu.Item>

          <DropdownMenu.Item
            disabled={pending}
            onSelect={() => void signOut()}
            className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-base text-ink outline-none data-[highlighted]:bg-surface-subtle"
          >
            <LogOut aria-hidden="true" className="size-4" strokeWidth={1.75} />
            {t('common:actions.signOut')}
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
