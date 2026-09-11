import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { z } from 'zod'
import { checkPassword, MIN_PASSWORD_LENGTH } from '@coopmanage/shared'
import { Alert, Button, FormField, Input } from '@/components/ui'
import { resetPassword } from '@/features/auth/auth.api'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ApiError } from '@/lib/apiClient'
import { toI18nKey } from '@/lib/messageKey'

/**
 * The rule comes from the shared catalogue, so the sentence a user reads here is the same rule the
 * API applies. Checking in the browser is a courtesy; the server checks again regardless.
 */
const schema = z
  .object({
    password: z.string(),
    confirmPassword: z.string(),
  })
  .superRefine((value, ctx) => {
    const problem = checkPassword(value.password)
    if (problem) ctx.addIssue({ code: 'custom', path: ['password'], message: problem })
    if (value.password !== value.confirmPassword) {
      ctx.addIssue({ code: 'custom', path: ['confirmPassword'], message: 'mismatch' })
    }
  })

type ResetForm = z.infer<typeof schema>

export function ResetPasswordPage() {
  const { t } = useTranslation(['auth', 'errors', 'validation'])
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const form = useForm<ResetForm>({
    resolver: zodResolver(schema),
    defaultValues: { password: '', confirmPassword: '' },
  })

  async function onSubmit(values: ResetForm) {
    setFailure(null)
    try {
      await resetPassword(token, values.password)
      setDone(true)
      // Every session was revoked by the reset, so the only place to go is the login screen.
      setTimeout(() => void navigate('/login', { replace: true }), 2500)
    } catch (error) {
      setFailure(
        error instanceof ApiError
          ? t(toI18nKey(error.messageKey), { ...error.messageParams, defaultValue: error.message })
          : t('errors:unexpected.body'),
      )
    }
  }

  const passwordError = form.formState.errors.password?.message
  const confirmError = form.formState.errors.confirmPassword?.message

  return (
    <AuthLayout
      title={t('auth:reset.title')}
      description={t('auth:reset.description')}
      footer={
        <Link to="/login" className="text-primary-600 hover:text-primary-700">
          {t('auth:forgot.backToLogin')}
        </Link>
      }
    >
      {done ? (
        <Alert tone="success" title={t('auth:reset.doneTitle')}>
          {t('auth:reset.doneBody')}
        </Alert>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          {failure ? <Alert tone="danger">{failure}</Alert> : null}

          <FormField
            label={t('auth:fields.newPassword')}
            hint={t('validation:password.hint', { min: MIN_PASSWORD_LENGTH })}
            error={passwordError ? t(`validation:password.${passwordError}`) : undefined}
          >
            <Input type="password" autoComplete="new-password" {...form.register('password')} />
          </FormField>

          <FormField
            label={t('auth:fields.confirmPassword')}
            error={confirmError ? t('validation:password.mismatch') : undefined}
          >
            <Input
              type="password"
              autoComplete="new-password"
              {...form.register('confirmPassword')}
            />
          </FormField>

          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
            {t('auth:reset.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
