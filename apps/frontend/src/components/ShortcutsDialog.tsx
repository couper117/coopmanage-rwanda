import { useTranslation } from 'react-i18next'
import { Dialog } from '@/components/ui'
import { useVisibleNavigation } from '@/hooks/useVisibleNavigation'

function Key({ children }: { children: string }) {
  return (
    <kbd className="inline-block min-w-6 rounded-sm border border-line bg-surface-subtle px-1.5 py-0.5 text-center font-mono text-xs text-ink">
      {children}
    </kbd>
  )
}

/**
 * The list a keyboard user opens with `?`. Built from the same visible navigation as the sidebar
 * and the shortcuts themselves, so it never lists a screen the reader cannot reach.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const { t } = useTranslation('nav')
  const groups = useVisibleNavigation()
  const items = groups.flatMap((group) => group.items).filter((item) => item.shortcut)

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('shortcuts.title')}
      description={t('shortcuts.description')}
      width="sm"
    >
      <div className="flex flex-col gap-5">
        <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
          <dt>
            <Key>/</Key>
          </dt>
          <dd className="text-ink">{t('shortcuts.search')}</dd>
          <dt>
            <Key>?</Key>
          </dt>
          <dd className="text-ink">{t('shortcuts.help')}</dd>
          <dt>
            <Key>Esc</Key>
          </dt>
          <dd className="text-ink">{t('shortcuts.close')}</dd>
        </dl>

        <div>
          <h3 className="mb-2 text-sm font-semibold text-ink">{t('shortcuts.goTo')}</h3>
          <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2 text-sm">
            {items.map((item) => (
              <div key={item.key} className="contents">
                <dt className="whitespace-nowrap">
                  <Key>g</Key> <Key>{item.shortcut as string}</Key>
                </dt>
                <dd className="text-ink">{t(`items.${item.key}`)}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
    </Dialog>
  )
}
