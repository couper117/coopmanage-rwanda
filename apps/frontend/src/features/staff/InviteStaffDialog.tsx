import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import type { RoleKey } from '@coopmanage/shared'
import { Alert, Button, Dialog, FormField, Input, Select } from '@/components/ui'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { currentLanguage } from '@/i18n'
import { useInviteStaff, useRoles } from './staff.hooks'

const schema = z.object({
  fullName: z.string().trim().min(2, { message: 'validation.required' }).max(120),
  email: z.string().trim().min(1, { message: 'validation.required' }).pipe(z.email()),
  roleKey: z.string().min(1, { message: 'validation.required' }),
  jobTitle: z.string().trim().max(80),
})

type FormValues = z.infer<typeof schema>

export interface InviteStaffDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

/**
 * Inviting a member of staff.
 *
 * The person sets their own password from a link, so this form never asks for one and the
 * cooperative never handles someone else's credentials. The dialog says which of the two things
 * happened, because "we created an account for them" and "we added an account they already had"
 * lead to different next steps for the person doing the inviting.
 */
export function InviteStaffDialog({ open, onOpenChange }: InviteStaffDialogProps) {
  const { t } = useTranslation(['staff', 'common', 'validation'])
  const describeError = useApiError()
  const { data: roles } = useRoles()
  const invite = useInviteStaff()
  const language = currentLanguage()

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { fullName: '', email: '', roleKey: '', jobTitle: '' },
  })
  const { register, handleSubmit, reset, formState } = form

  useEffect(() => {
    if (open) {
      reset({ fullName: '', email: '', roleKey: '', jobTitle: '' })
      invite.reset()
    }
    // `invite` is a stable mutation object; including it would reset the result on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reset])

  const roleOptions = (roles ?? []).map((role) => ({
    value: role.key,
    label: language === 'rw' ? role.nameRw : role.nameEn,
  }))

  // `useWatch` rather than `form.watch()`: the latter reads outside React's subscription model,
  // which the compiler cannot follow. The Select is controlled, so its value has to come back here.
  const chosenRole = useWatch({ control: form.control, name: 'roleKey' })
  const selectedRole = roles?.find((role) => role.key === chosenRole)

  const onSubmit = handleSubmit(async (values) => {
    await invite.mutateAsync({
      fullName: values.fullName,
      email: values.email,
      roleKey: values.roleKey as RoleKey,
      ...(values.jobTitle.length > 0 ? { jobTitle: values.jobTitle } : {}),
    })
  })

  const result = invite.data

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff:invite.title')}
      description={t('staff:invite.description')}
      busy={invite.isPending}
      footer={
        result ? (
          <Button onClick={() => onOpenChange(false)}>{t('common:actions.close')}</Button>
        ) : (
          <>
            <Button
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={invite.isPending}
            >
              {t('common:actions.cancel')}
            </Button>
            <Button type="submit" form="invite-staff-form" loading={invite.isPending}>
              {t('staff:invite.submit')}
            </Button>
          </>
        )
      }
    >
      {result ? (
        <Alert
          tone="success"
          title={t('staff:invite.sentTitle', { name: result.staff.user.fullName })}
        >
          {result.accountCreated
            ? t('staff:invite.sentNewAccount', { email: result.staff.user.email })
            : t('staff:invite.sentExistingAccount', { email: result.staff.user.email })}
        </Alert>
      ) : (
        <form
          id="invite-staff-form"
          onSubmit={(event) => void onSubmit(event)}
          noValidate
          className="flex flex-col gap-4"
        >
          <FormField
            label={t('staff:fields.fullName')}
            error={formState.errors.fullName ? t('validation:required') : undefined}
          >
            <Input {...register('fullName')} autoComplete="name" />
          </FormField>

          <FormField
            label={t('staff:fields.email')}
            hint={t('staff:invite.emailHint')}
            error={formState.errors.email ? t('validation:email') : undefined}
          >
            <Input {...register('email')} inputMode="email" autoComplete="email" />
          </FormField>

          <FormField
            label={t('staff:fields.role')}
            error={formState.errors.roleKey ? t('validation:required') : undefined}
          >
            <Select
              {...register('roleKey')}
              value={chosenRole ?? ''}
              options={roleOptions}
              placeholder={t('staff:invite.rolePlaceholder')}
            />
          </FormField>

          {selectedRole ? (
            <p className="-mt-2 text-sm text-ink-muted">
              {language === 'rw' ? selectedRole.descriptionRw : selectedRole.descriptionEn}
            </p>
          ) : null}

          <FormField label={t('staff:fields.jobTitle')} optional>
            <Input {...register('jobTitle')} />
          </FormField>

          {invite.isError ? (
            <Alert tone="danger">{describeError(invite.error).message}</Alert>
          ) : null}
        </form>
      )}
    </Dialog>
  )
}
