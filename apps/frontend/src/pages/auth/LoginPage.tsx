import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import { z } from 'zod'
import { Alert, Button, FormField, Input } from '@/components/ui'
import { login } from '@/features/auth/auth.api'
import { loadSession } from '@/features/auth/useSession'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ApiError } from '@/lib/apiClient'
import { toI18nKey } from '@/lib/messageKey'
import { authState, useAuthStore } from '@/stores/authStore'

const schema = z.object({
  email: z.string().trim().min(1).email(),
  password: z.string().min(1),
})

type LoginForm = z.infer<typeof schema>

export function LoginPage() {
  const { t } = useTranslation(['auth', 'common', 'errors'])
  const navigate = useNavigate()
  const location = useLocation()
  const status = useAuthStore((state) => state.status)
  const [failure, setFailure] = useState<{ message: string; retryAfter?: number } | null>(null)

  const form = useForm<LoginForm>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  })

  // Somebody who is already signed in and navigates here belongs back where they came from.
  if (status === 'authenticated') {
    const from = (location.state as { from?: string } | null)?.from
    return <Navigate to={from ?? '/'} replace />
  }

  async function onSubmit(values: LoginForm) {
    setFailure(null)
    try {
      const result = await login(values.email, values.password)
      authState.setAccessToken(result.accessToken)
      await loadSession()
      const from = (location.state as { from?: string } | null)?.from
      await navigate(from ?? '/', { replace: true })
    } catch (error) {
      if (error instanceof ApiError) {
        setFailure({
          message: t(toI18nKey(error.messageKey), {
            ...error.messageParams,
            defaultValue: error.message,
          }),
        })
        // The password field is cleared but the email is kept: retyping an address that was right
        // is a small insult after a failed sign-in.
        form.setValue('password', '')
        form.setFocus('password')
        return
      }
      setFailure({ message: t('errors:unexpected.body') })
    }
  }

  return (
    <AuthLayout
      title={t('auth:login.title')}
      description={t('auth:login.description')}
      footer={
        <Link to="/forgot-password" className="text-primary-600 hover:text-primary-700">
          {t('auth:login.forgotPassword')}
        </Link>
      }
    >
      <form
        noValidate
        onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
        className="flex flex-col gap-4"
      >
        {failure ? <Alert tone="danger">{failure.message}</Alert> : null}

        <FormField
          label={t('auth:fields.email')}
          error={form.formState.errors.email ? t('auth:validation.email') : undefined}
        >
          <Input
            type="email"
            autoComplete="username"
            inputMode="email"
            {...form.register('email')}
          />
        </FormField>

        <FormField
          label={t('auth:fields.password')}
          error={form.formState.errors.password ? t('auth:validation.passwordRequired') : undefined}
        >
          <Input type="password" autoComplete="current-password" {...form.register('password')} />
        </FormField>

        <Button type="submit" size="lg" loading={form.formState.isSubmitting} className="mt-1">
          {t('auth:login.submit')}
        </Button>
      </form>
    </AuthLayout>
  )
}
