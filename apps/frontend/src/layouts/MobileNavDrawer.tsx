import * as Dialog from '@radix-ui/react-dialog'
import { useTranslation } from 'react-i18next'
import { useUiStore } from '@/stores/uiStore'
import { Sidebar } from './Sidebar'

/**
 * The mobile navigation drawer is a real modal dialog rather than a positioned div.
 *
 * Radix supplies what overlay content is required to do and what a hand-rolled drawer had been
 * missing: `role="dialog"` with `aria-modal`, a focus trap, focus returned to the trigger on
 * close, the content behind it removed from the tab order, and Escape and scrim dismissal. The
 * title is present for the accessible name and visually hidden, because the drawer's own header
 * already names the application.
 */
export function MobileNavDrawer() {
  const { t } = useTranslation('nav')
  const open = useUiStore((state) => state.mobileNavOpen)
  const setMobileNavOpen = useUiStore((state) => state.setMobileNavOpen)

  return (
    <Dialog.Root open={open} onOpenChange={setMobileNavOpen}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-ink/40 lg:hidden" />
        <Dialog.Content
          aria-describedby={undefined}
          className="fixed inset-y-0 left-0 z-50 w-sidebar shadow-overlay outline-none lg:hidden"
        >
          <Dialog.Title className="sr-only">{t('mainNavigation')}</Dialog.Title>
          <Sidebar variant="mobile" />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
