import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { LOCALES, type Locale } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Button,
  FormField,
  Panel,
  Select,
  SkeletonText,
  type SelectOption,
} from '@/components/ui'
import { fetchPlatformSettings, saveDefaultCooperativeLocale } from '@/features/admin/admin.api'
import { adminKeys, useAdminError } from '@/features/admin/admin.hooks'

function isLocale(value: string): value is Locale {
  return (LOCALES as readonly string[]).includes(value)
}

/**
 * The platform settings, which for now is one choice.
 *
 * It saves on change rather than behind a Save button: there is a single field, the change is
 * reversible, and a button for one select is friction. The outcome is stated inline either way,
 * because a select that silently springs back to its old value is how people lose confidence in a
 * settings screen.
 */
export function AdminSettingsPage() {
  const { t } = useTranslation(['admin', 'common'])
  const queryClient = useQueryClient()
  const describeError = useAdminError()
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const settings = useQuery({ queryKey: adminKeys.settings, queryFn: fetchPlatformSettings })

  const mutation = useMutation({
    mutationFn: saveDefaultCooperativeLocale,
    onSuccess: async () => {
      setFailure(null)
      setSaved(true)
      await queryClient.invalidateQueries({ queryKey: adminKeys.settings })
    },
    onError: (error) => {
      setSaved(false)
      setFailure(describeError(error).message)
    },
  })

  const localeOptions: SelectOption[] = [
    { value: 'EN', label: t('common:language.en') },
    { value: 'RW', label: t('common:language.rw') },
  ]

  return (
    <>
      <PageHeader title={t('admin:settings.title')} description={t('admin:settings.description')} />

      <Panel
        title={t('admin:settings.panel.title')}
        description={t('admin:settings.panel.description')}
      >
        {settings.isPending ? (
          <SkeletonText lines={3} />
        ) : settings.isError ? (
          <Alert
            tone="danger"
            title={t('admin:settings.error.load')}
            action={
              <Button variant="secondary" size="sm" onClick={() => void settings.refetch()}>
                {t('common:actions.retry')}
              </Button>
            }
          >
            {describeError(settings.error).message}
          </Alert>
        ) : (
          <div className="flex max-w-md flex-col gap-4">
            {failure ? <Alert tone="danger">{failure}</Alert> : null}
            {saved && !failure ? <Alert tone="success">{t('admin:settings.saved')}</Alert> : null}

            <FormField
              label={t('admin:settings.fields.defaultLocale')}
              hint={t('admin:settings.fields.defaultLocaleHint')}
            >
              <Select
                options={localeOptions}
                value={settings.data.defaultCooperativeLocale}
                disabled={mutation.isPending}
                onChange={(event) => {
                  const next = event.target.value
                  if (!isLocale(next)) return
                  setSaved(false)
                  mutation.mutate(next)
                }}
              />
            </FormField>
          </div>
        )}
      </Panel>
    </>
  )
}
