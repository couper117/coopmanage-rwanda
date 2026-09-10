import { Component, type ErrorInfo, type ReactNode } from 'react'
import { withTranslation, type WithTranslation } from 'react-i18next'
import { Alert, Button } from '@/components/ui'

interface Props extends WithTranslation {
  children: ReactNode
}

interface State {
  hasError: boolean
}

/**
 * Keeps a failure in one screen from blanking the whole application. The message is translated and
 * plain; the technical detail goes to the console, not to the user.
 */
class ErrorBoundaryBase extends Component<Props, State> {
  override state: State = { hasError: false }

  static getDerivedStateFromError(): State {
    return { hasError: true }
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('Unhandled interface error', error, info.componentStack)
  }

  override render(): ReactNode {
    const { t, children } = this.props
    if (!this.state.hasError) return children

    return (
      <div className="p-6">
        <Alert
          tone="danger"
          title={t('boundary.title', { ns: 'errors' })}
          action={
            <Button
              variant="secondary"
              size="sm"
              onClick={() => this.setState({ hasError: false })}
            >
              {t('actions.retry', { ns: 'common' })}
            </Button>
          }
        >
          {t('boundary.body', { ns: 'errors' })}
        </Alert>
      </div>
    )
  }
}

export const ErrorBoundary = withTranslation(['errors', 'common'])(ErrorBoundaryBase)
