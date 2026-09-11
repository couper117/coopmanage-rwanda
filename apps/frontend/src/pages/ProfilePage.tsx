import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Laptop, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { checkPassword, LOCALES, MIN_PASSWORD_LENGTH } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import {
  Alert,
  Badge,
  Button,
  EmptyState,
  FormField,
  Input,
  Panel,
  SkeletonText,
} from '@/components/ui'
import {
  changePassword,
  listSessions,
  revokeSession,
  updateProfile,
} from '@/features/auth/auth.api'
import { loadSession, useActiveMembership, useSession } from '@/features/auth/useSession'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { describeDevice } from '@/lib/device'

/**
 * Everything a member of staff can change about their own account, in the order they are likely to
 * want it: who they are, then their password, then which devices are signed in.
 *
 * The device list is here rather than buried in a security screen because it is the one place
 * somebody can act on "I signed in at the cooperative office last week and I am not sure I signed
 * out".
 */
export function ProfilePage() {
  const { t } = useTranslation(['profile', 'common'])
  const { user, roleKey } = useSession()
  const membership = useActiveMembership()

  return (
    <>
      <PageHeader
        title={t('profile:title')}
        description={t('profile:description')}
        actions={
          membership ? (
            <Badge tone="neutral">
              {membership.cooperativeName} · {t(`profile:roles.${roleKey ?? membership.roleKey}`)}
            </Badge>
          ) : null
        }
      />
      {user ? <DetailsPanel /> : null}
      <PasswordPanel />
      <DevicesPanel />
    </>
  )
}

const detailsSchema = z.object({
  fullName: z.string().trim().min(2).max(120),
  phone: z.string().trim().max(30),
  locale: z.enum(LOCALES),
})

type DetailsForm = z.infer<typeof detailsSchema>

function DetailsPanel() {
  const { t } = useTranslation(['profile', 'common', 'validation'])
  const { user } = useSession()
  const describeError = useApiError()
  const [saved, setSaved] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const form = useForm<DetailsForm>({
    resolver: zodResolver(detailsSchema),
    values: {
      fullName: user?.fullName ?? '',
      phone: user?.phone ?? '',
      locale: user?.locale ?? 'EN',
    },
  })

  const mutation = useMutation({
    mutationFn: (values: DetailsForm) =>
      updateProfile({ fullName: values.fullName, phone: values.phone, locale: values.locale }),
    onSuccess: async () => {
      setFailure(null)
      setSaved(true)
      // Reloading the session applies the language choice immediately and everywhere, rather than
      // leaving the interface in the old one until the next reload.
      await loadSession()
    },
    onError: (error) => {
      setSaved(false)
      setFailure(describeError(error).message)
    },
  })

  return (
    <Panel title={t('profile:details.title')} description={t('profile:details.description')}>
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}
        className="flex max-w-md flex-col gap-4"
      >
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
        {saved && !failure ? <Alert tone="success">{t('profile:details.saved')}</Alert> : null}

        <FormField
          label={t('profile:fields.fullName')}
          error={form.formState.errors.fullName ? t('validation:too_small') : undefined}
        >
          <Input autoComplete="name" {...form.register('fullName')} />
        </FormField>

        <FormField
          label={t('profile:fields.phone')}
          optional
          hint={t('profile:fields.phoneHint')}
          error={form.formState.errors.phone ? t('validation:phone') : undefined}
        >
          <Input type="tel" inputMode="tel" autoComplete="tel" {...form.register('phone')} />
        </FormField>

        <FormField label={t('profile:fields.language')}>
          <select
            {...form.register('locale')}
            className="h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-base text-ink focus:border-primary-600"
          >
            <option value="EN">{t('common:language.en')}</option>
            <option value="RW">{t('common:language.rw')}</option>
          </select>
        </FormField>

        <div>
          <Button type="submit" loading={mutation.isPending}>
            {t('common:actions.save')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((value, ctx) => {
    const problem = checkPassword(value.newPassword)
    if (problem) ctx.addIssue({ code: 'custom', path: ['newPassword'], message: problem })
    if (value.newPassword !== value.confirmPassword) {
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'mismatch' })
    }
  })

type PasswordForm = z.infer<typeof passwordSchema>

function PasswordPanel() {
  const { t } = useTranslation(['profile', 'common', 'validation'])
  const describeError = useApiError()
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const form = useForm<PasswordForm>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: PasswordForm) =>
      changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      setFailure(null)
      setFieldErrors({})
      setDone(true)
      form.reset()
    },
    onError: (error) => {
      setDone(false)
      const described = describeError(error)
      setFailure(described.message)
      setFieldErrors(described.fieldErrors)
    },
  })

  const newPasswordError = form.formState.errors.newPassword?.message
  const confirmError = form.formState.errors.confirmPassword?.message

  return (
    <Panel title={t('profile:password.title')} description={t('profile:password.description')}>
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit((values) => mutation.mutate(values))(event)}
        className="flex max-w-md flex-col gap-4"
      >
        {failure ? <Alert tone="danger">{failure}</Alert> : null}
        {done ? <Alert tone="success">{t('profile:password.changed')}</Alert> : null}

        <FormField label={t('profile:fields.currentPassword')} error={fieldErrors.currentPassword}>
          <Input
            type="password"
            autoComplete="current-password"
            {...form.register('currentPassword')}
          />
        </FormField>

        <FormField
          label={t('profile:fields.newPassword')}
          hint={t('validation:password.hint', { min: MIN_PASSWORD_LENGTH })}
          error={newPasswordError ? t(`validation:password.${newPasswordError}`) : undefined}
        >
          <Input type="password" autoComplete="new-password" {...form.register('newPassword')} />
        </FormField>

        <FormField
          label={t('profile:fields.confirmPassword')}
          error={confirmError ? t('validation:password.mismatch') : undefined}
        >
          <Input
            type="password"
            autoComplete="new-password"
            {...form.register('confirmPassword')}
          />
        </FormField>

        <Alert tone="info">{t('profile:password.signsOutOtherDevices')}</Alert>

        <div>
          <Button type="submit" loading={mutation.isPending}>
            {t('profile:password.submit')}
          </Button>
        </div>
      </form>
    </Panel>
  )
}

function DevicesPanel() {
  const { t, i18n } = useTranslation(['profile', 'common'])
  const queryClient = useQueryClient()
  const describeError = useApiError()
  const [failure, setFailure] = useState<string | null>(null)

  const sessions = useQuery({ queryKey: ['auth', 'sessions'], queryFn: listSessions })
  const mutation = useMutation({
    mutationFn: revokeSession,
    onSuccess: async () => {
      setFailure(null)
      await queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] })
    },
    onError: (error) => setFailure(describeError(error).message),
  })

  const formatDate = (value: string) =>
    new Intl.DateTimeFormat(i18n.resolvedLanguage === 'rw' ? 'en-RW' : 'en-GB', {
      dateStyle: 'medium',
      timeStyle: 'short',
    }).format(new Date(value))

  return (
    <Panel title={t('profile:devices.title')} description={t('profile:devices.description')} flush>
      {failure ? (
        <div className="p-4 pb-0">
          <Alert tone="danger">{failure}</Alert>
        </div>
      ) : null}

      {sessions.isPending ? (
        <div className="p-4">
          <SkeletonText lines={3} />
        </div>
      ) : sessions.data && sessions.data.length > 0 ? (
        <ul className="divide-y divide-line">
          {sessions.data.map((device) => (
            <li key={device.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
              <Laptop
                aria-hidden="true"
                className="size-4 shrink-0 text-ink-muted"
                strokeWidth={1.75}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-base text-ink">
                  {describeDevice(device.userAgent) ?? t('profile:devices.unknownDevice')}
                </p>
                <p className="text-xs text-ink-muted">
                  {t('profile:devices.signedInAt', { when: formatDate(device.createdAt) })}
                  {device.ipAddress ? ` · ${device.ipAddress}` : ''}
                </p>
              </div>
              {device.current ? (
                <Badge tone="success">{t('profile:devices.thisDevice')}</Badge>
              ) : (
                <Button
                  variant="secondary"
                  size="sm"
                  loading={mutation.isPending && mutation.variables === device.id}
                  onClick={() => mutation.mutate(device.id)}
                >
                  {t('profile:devices.signOut')}
                </Button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={ShieldCheck}
          headingLevel={3}
          title={t('profile:devices.emptyTitle')}
          description={t('profile:devices.emptyBody')}
        />
      )}
    </Panel>
  )
}
