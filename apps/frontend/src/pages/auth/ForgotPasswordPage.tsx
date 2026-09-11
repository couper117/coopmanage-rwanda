import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { z } from 'zod'
import { Alert, Button, FormField, Input } from '@/components/ui'
import { requestPasswordReset } from '@/features/auth/auth.api'
import { AuthLayout } from '@/layouts/AuthLayout'
import { ApiError } from '@/lib/apiClient'
import { toI18nKey } from '@/lib/messageKey'

const schema = z.object({ email: z.string().trim().min(1).email() })

export function ForgotPasswordPage() {
  const { t } = useTranslation(['auth', 'errors'])
  const [sent, setSent] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: '' },
  })

  async function onSubmit(values: z.infer<typeof schema>) {
    setFailure(null)
    try {
      await requestPasswordReset(values.email)
      setSent(true)
    } catch (error) {
      // A rate limit is the only failure this endpoint reports; everything else answers 204 so
      // that the form cannot be used to find out which addresses are registered.
      setFailure(
        error instanceof ApiError
          ? t(toI18nKey(error.messageKey), { ...error.messageParams, defaultValue: error.message })
          : t('errors:unexpected.body'),
      )
    }
  }

  return (
    <AuthLayout
      title={t('auth:forgot.title')}
      description={t('auth:forgot.description')}
      footer={
        <Link to="/login" className="text-primary-600 hover:text-primary-700">
          {t('auth:forgot.backToLogin')}
        </Link>
      }
    >
      {sent ? (
        // The same message whether or not the address is registered. Saying "no such account"
        // would turn this form into a list of every member of staff.
        <Alert tone="success" title={t('auth:forgot.sentTitle')}>
          {t('auth:forgot.sentBody')}
        </Alert>
      ) : (
        <form
          noValidate
          onSubmit={(event) => void form.handleSubmit(onSubmit)(event)}
          className="flex flex-col gap-4"
        >
          {failure ? <Alert tone="danger">{failure}</Alert> : null}
          <FormField
            label={t('auth:fields.email')}
            error={form.formState.errors.email ? t('auth:validation.email') : undefined}
          >
            <Input type="email" autoComplete="username" {...form.register('email')} />
          </FormField>
          <Button type="submit" size="lg" loading={form.formState.isSubmitting}>
            {t('auth:forgot.submit')}
          </Button>
        </form>
      )}
    </AuthLayout>
  )
}
