import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { isRwandanPhone, LOCALES, RWANDA_PROVINCES } from '@coopmanage/shared'
import { PageHeader } from '@/components/PageHeader'
import { Alert, Button, FormField, Input, Panel, Select, SkeletonText } from '@/components/ui'
import {
  useCooperativeProfile,
  useUpdateCooperativeProfile,
} from '@/features/cooperative/cooperative.hooks'
import { usePermission } from '@/features/auth/useSession'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { currentLanguage } from '@/i18n'

/**
 * The cooperative's own record: who it is, where it is, and the few settings that shape how the
 * rest of the product behaves for it.
 *
 * The form mirrors the backend validator rather than inventing its own rules, and the backend
 * remains the authority: this copy exists so a cooperative officer is told about a bad phone
 * number before they submit, not to be trusted.
 */
const schema = z.object({
  name: z.string().trim().min(3).max(160),
  registrationNumber: z.string().trim().max(60),
  tinNumber: z.string().trim().max(30),
  province: z.enum(RWANDA_PROVINCES),
  district: z.string().trim().min(2).max(60),
  sector: z.string().trim().min(2).max(60),
  cell: z.string().trim().min(1).max(60),
  village: z.string().trim().min(1).max(60),
  addressLine: z.string().trim().max(200),
  phone: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || isRwandanPhone(value), {
      message: 'validation.phone',
    }),
  email: z
    .string()
    .trim()
    .refine((value) => value.length === 0 || z.email().safeParse(value).success, {
      message: 'validation.email',
    }),
  defaultLocale: z.enum(LOCALES),
  memberCodePrefix: z
    .string()
    .trim()
    .regex(/^[A-Z][A-Z0-9-]{1,11}$/, { message: 'validation.memberCodePrefix' }),
})

type FormValues = z.infer<typeof schema>

export function CooperativeSettingsPage() {
  const { t } = useTranslation(['settings', 'common', 'validation'])
  const describeError = useApiError()
  const canEdit = usePermission('cooperative:update')
  const { data: profile, isPending, isError, refetch } = useCooperativeProfile()
  const update = useUpdateCooperativeProfile()
  const [saved, setSaved] = useState(false)

  const form = useForm<FormValues>({ resolver: zodResolver(schema) })
  const { register, handleSubmit, reset, formState } = form

  // The form is filled once the record arrives, and again after a save, so the inputs always show
  // what is actually stored rather than what was typed.
  useEffect(() => {
    if (!profile) return
    reset({
      name: profile.name,
      registrationNumber: profile.registrationNumber ?? '',
      tinNumber: profile.tinNumber ?? '',
      province: profile.province as FormValues['province'],
      district: profile.district,
      sector: profile.sector,
      cell: profile.cell,
      village: profile.village,
      addressLine: profile.addressLine ?? '',
      phone: profile.phone ?? '',
      email: profile.email ?? '',
      defaultLocale: profile.defaultLocale,
      memberCodePrefix: profile.memberCodePrefix,
    })
  }, [profile, reset])

  const provinceOptions = RWANDA_PROVINCES.map((province) => ({
    value: province,
    label: t(`settings:provinces.${province}`),
  }))

  const localeOptions = LOCALES.map((locale) => ({
    value: locale,
    label: t(`common:language.${locale === 'EN' ? 'en' : 'rw'}`),
  }))

  const onSubmit = handleSubmit(async (values) => {
    setSaved(false)
    await update.mutateAsync({
      name: values.name,
      registrationNumber: values.registrationNumber,
      tinNumber: values.tinNumber,
      province: values.province,
      district: values.district,
      sector: values.sector,
      cell: values.cell,
      village: values.village,
      addressLine: values.addressLine,
      phone: values.phone,
      email: values.email,
      defaultLocale: values.defaultLocale,
      memberCodePrefix: values.memberCodePrefix,
    })
    setSaved(true)
  })

  if (isPending) {
    return (
      <>
        <PageHeader title={t('settings:cooperative.title')} />
        <Panel>
          <SkeletonText lines={8} />
        </Panel>
      </>
    )
  }

  if (isError || !profile) {
    return (
      <>
        <PageHeader title={t('settings:cooperative.title')} />
        <Alert
          tone="danger"
          title={t('settings:cooperative.loadFailed')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void refetch()}>
              {t('common:actions.retry')}
            </Button>
          }
        />
      </>
    )
  }

  const language = currentLanguage()

  return (
    <>
      <PageHeader
        title={t('settings:cooperative.title')}
        description={t('settings:cooperative.description')}
      />

      <Panel
        title={t('settings:cooperative.identityTitle')}
        description={t('settings:cooperative.identityDescription')}
      >
        <dl className="grid gap-4 sm:grid-cols-3">
          <Fact label={t('settings:cooperative.code')} value={profile.code} />
          <Fact
            label={t('settings:cooperative.type')}
            value={language === 'rw' ? profile.type.nameRw : profile.type.nameEn}
          />
          <Fact label={t('settings:cooperative.currency')} value={profile.currency} />
        </dl>
        <p className="mt-3 text-sm text-ink-muted">{t('settings:cooperative.identityNote')}</p>
      </Panel>

      <Panel title={t('settings:cooperative.detailsTitle')}>
        {!canEdit ? (
          <Alert tone="info" className="mb-4">
            {t('settings:cooperative.readOnly')}
          </Alert>
        ) : null}

        <form onSubmit={(event) => void onSubmit(event)} noValidate className="flex flex-col gap-4">
          <FormField
            label={t('settings:cooperative.name')}
            error={formState.errors.name ? t('validation:required') : undefined}
          >
            <Input {...register('name')} disabled={!canEdit} autoComplete="organization" />
          </FormField>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('settings:cooperative.registrationNumber')} optional>
              <Input {...register('registrationNumber')} disabled={!canEdit} />
            </FormField>
            <FormField label={t('settings:cooperative.tinNumber')} optional>
              <Input {...register('tinNumber')} disabled={!canEdit} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('settings:cooperative.province')}>
              <Select {...register('province')} options={provinceOptions} disabled={!canEdit} />
            </FormField>
            <FormField
              label={t('settings:cooperative.district')}
              error={formState.errors.district ? t('validation:required') : undefined}
            >
              <Input {...register('district')} disabled={!canEdit} />
            </FormField>
            <FormField
              label={t('settings:cooperative.sector')}
              error={formState.errors.sector ? t('validation:required') : undefined}
            >
              <Input {...register('sector')} disabled={!canEdit} />
            </FormField>
            <FormField
              label={t('settings:cooperative.cell')}
              error={formState.errors.cell ? t('validation:required') : undefined}
            >
              <Input {...register('cell')} disabled={!canEdit} />
            </FormField>
            <FormField
              label={t('settings:cooperative.village')}
              error={formState.errors.village ? t('validation:required') : undefined}
            >
              <Input {...register('village')} disabled={!canEdit} />
            </FormField>
            <FormField label={t('settings:cooperative.addressLine')} optional>
              <Input {...register('addressLine')} disabled={!canEdit} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('settings:cooperative.phone')}
              optional
              hint={t('settings:cooperative.phoneHint')}
              error={formState.errors.phone?.message}
            >
              <Input {...register('phone')} disabled={!canEdit} inputMode="tel" />
            </FormField>
            <FormField
              label={t('settings:cooperative.email')}
              optional
              error={formState.errors.email?.message}
            >
              <Input {...register('email')} disabled={!canEdit} inputMode="email" />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('settings:cooperative.defaultLocale')}
              hint={t('settings:cooperative.defaultLocaleHint')}
            >
              <Select {...register('defaultLocale')} options={localeOptions} disabled={!canEdit} />
            </FormField>
            <FormField
              label={t('settings:cooperative.memberCodePrefix')}
              hint={t('settings:cooperative.memberCodePrefixHint', {
                example: `${profile.memberCodePrefix}-00001`,
              })}
              error={formState.errors.memberCodePrefix?.message}
            >
              <Input {...register('memberCodePrefix')} disabled={!canEdit} />
            </FormField>
          </div>

          {update.isError ? (
            <Alert tone="danger">{describeError(update.error).message}</Alert>
          ) : null}
          {saved && !formState.isDirty ? (
            <Alert tone="success">{t('settings:cooperative.saved')}</Alert>
          ) : null}

          {canEdit ? (
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                disabled={!formState.isDirty || update.isPending}
                onClick={() => {
                  setSaved(false)
                  reset()
                }}
              >
                {t('common:actions.cancel')}
              </Button>
              <Button type="submit" loading={update.isPending} disabled={!formState.isDirty}>
                {t('settings:cooperative.save')}
              </Button>
            </div>
          ) : null}
        </form>
      </Panel>
    </>
  )
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold tracking-wider text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-base text-ink">{value}</dd>
    </div>
  )
}
