import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { Button } from '@/components/ui'
import { PasswordForm } from '@/features/auth/PasswordForm'
import { useSignOut } from '@/features/auth/useSignOut'
import { AuthLayout } from '@/layouts/AuthLayout'

/**
 * Where an account is held until it has replaced a password somebody else chose for it: the
 * seeded administrator's bootstrap password, or a temporary one an operator handed over. No
 * navigation, because there is nowhere else to go — the server refuses every other request until
 * this is done — and a way out for somebody who has landed here on the wrong account.
 */
export function ChangePasswordPage() {
  const { t } = useTranslation(['auth', 'common'])
  const navigate = useNavigate()
  const { signOut, pending } = useSignOut()

  return (
    <AuthLayout
      title={t('auth:changePassword.title')}
      description={t('auth:changePassword.description')}
      footer={
        <Button variant="ghost" size="sm" onClick={() => void signOut()} loading={pending}>
          {t('common:actions.signOut')}
        </Button>
      }
    >
      <PasswordForm
        submitLabel={t('auth:changePassword.submit')}
        onChanged={() => void navigate('/', { replace: true })}
      />
    </AuthLayout>
  )
}
