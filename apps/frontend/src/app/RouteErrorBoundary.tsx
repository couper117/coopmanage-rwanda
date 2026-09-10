import { Component, type ErrorInfo, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { ApiError } from '@/lib/apiClient'
import { toI18nKey } from '@/lib/messageKey'
import { Alert, Button } from '@/components/ui'

interface Props extends WithTranslation {
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Catches a failure inside one screen. It lives inside the application shell, so the sidebar and
 * top bar keep working and the user can navigate somewhere else rather than facing a blank page.
 *
 * When the failure is an API error the translated sentence is shown along with the request id,
 * which is the string a user can quote to whoever supports them. Anything else gets the generic
 * sentence, and the technical detail goes to the console only.
 */
class RouteErrorBoundaryBase extends Component<Props, State> {
  override state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled screen error', error, info.componentStack)
  }

  private renderMessage(): string {
    const { t } = this.props
    const { error } = this.state
    if (error instanceof ApiError) {
      return t(toI18nKey(error.messageKey), {
        ...error.messageParams,
        defaultValue: error.message,
      })
    }
    return t('errors:boundary.body')
  }

  override render(): ReactNode {
    const { t, children } = this.props
    const { error } = this.state
    if (!error) return children

    const requestId = error instanceof ApiError ? error.requestId : undefined

    return (
      <Alert
        tone="danger"
        title={t('errors:boundary.title')}
        action={
          <Button variant="secondary" size="sm" onClick={() => this.setState({ error: null })}>
            {t('common:actions.retry')}
          </Button>
        }
      >
        <p>{this.renderMessage()}</p>
        {requestId ? (
          <p className="mt-1 text-xs opacity-80">
            {t('errors:unexpected.reference', { requestId })}
          </p>
        ) : null}
      </Alert>
    )
  }
}

export const RouteErrorBoundary = withTranslation(['errors', 'common', 'validation'])(
  RouteErrorBoundaryBase,
)
