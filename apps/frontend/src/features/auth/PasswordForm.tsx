import { zodResolver } from '@hookform/resolvers/zod'
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { checkPassword, MIN_PASSWORD_LENGTH } from '@coopmanage/shared'
import { Alert, Button, FormField, Input } from '@/components/ui'
import { useApiError } from '@/hooks/useApiErrorMessage'
import { useAuthStore } from '@/stores/authStore'
import { changePassword } from './auth.api'

/**
 * Changing one's own password. Used on the profile screen, and on its own on the screen an
 * account is held at until it has replaced a password somebody else chose for it.
 */
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

type PasswordFormValues = z.infer<typeof passwordSchema>

export function PasswordForm({
  onChanged,
  submitLabel,
}: {
  /** Called once the server has accepted the new password. */
  onChanged?: () => void
  submitLabel?: string
}) {
  const { t } = useTranslation(['profile', 'common', 'validation'])
  const describeError = useApiError()
  const passwordChanged = useAuthStore((state) => state.passwordChanged)
  const [done, setDone] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})

  const form = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' },
  })

  const mutation = useMutation({
    mutationFn: (values: PasswordFormValues) =>
      changePassword(values.currentPassword, values.newPassword),
    onSuccess: () => {
      setFailure(null)
      setFieldErrors({})
      setDone(true)
      form.reset()
      // The lock, if there was one, is lifted server-side by the same call.
      passwordChanged()
      onChanged?.()
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
        <Input type="password" autoComplete="new-password" {...form.register('confirmPassword')} />
      </FormField>

      <Alert tone="info">{t('profile:password.signsOutOtherDevices')}</Alert>

      <div>
        <Button type="submit" loading={mutation.isPending}>
          {submitLabel ?? t('profile:password.submit')}
        </Button>
      </div>
    </form>
  )
}
