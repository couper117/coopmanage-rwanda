import { AlertCircle } from 'lucide-react'
import { useId, type ReactElement, cloneElement } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/cn'
import { toI18nKey } from '@/lib/messageKey'

export interface FormFieldProps {
  label: string
  /** Required is the default. Optional fields say so, which matters most for member phone numbers. */
  optional?: boolean
  hint?: string
  /** A translation key from the validation namespace, or a ready-made sentence. */
  error?: string
  className?: string
  children: ReactElement<{
    id?: string
    'aria-describedby'?: string
    invalid?: boolean
  }>
}

/**
 * Label above the control, always visible. Placeholders are examples, never labels. The error is
 * bound with aria-describedby so a screen reader announces it with the field.
 */
export function FormField({
  label,
  optional = false,
  hint,
  error,
  className,
  children,
}: FormFieldProps) {
  const { t } = useTranslation(['common', 'validation'])
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`

  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  const control = cloneElement(children, {
    id,
    ...(describedBy ? { 'aria-describedby': describedBy } : {}),
    ...(error ? { invalid: true } : {}),
  })

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
        {optional ? (
          <span className="ml-1 font-normal text-ink-muted">({t('common:state.optional')})</span>
        ) : null}
      </label>
      {control}
      {hint && !error ? (
        <p id={hintId} className="text-xs text-ink-muted">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="flex items-start gap-1 text-xs text-danger-fg">
          <AlertCircle aria-hidden="true" className="mt-px size-3.5 shrink-0" />
          <span>{t(toI18nKey(error), { defaultValue: error })}</span>
        </p>
      ) : null}
    </div>
  )
}
