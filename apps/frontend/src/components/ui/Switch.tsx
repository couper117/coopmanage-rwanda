import { cn } from '@/lib/cn'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  /** Required: a switch with no label is unusable with a screen reader. */
  label: string
  description?: string
  disabled?: boolean
  id?: string
}

/**
 * A labelled on/off control, built on a real checkbox so it is keyboard operable and announced
 * correctly without any ARIA of our own. The whole row is the label, which makes it a comfortable
 * target on a tablet.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  description,
  disabled = false,
  id,
}: SwitchProps) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-3 rounded-md px-1 py-2',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        id={id}
        type="checkbox"
        role="switch"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onCheckedChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cn(
          'mt-0.5 flex h-5 w-9 shrink-0 items-center rounded-full border transition-colors',
          'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-600',
          checked ? 'border-primary-600 bg-primary-600' : 'border-line-strong bg-surface-subtle',
        )}
      >
        <span
          className={cn(
            'size-3.5 rounded-full bg-surface shadow-sm transition-transform',
            checked ? 'translate-x-[1.15rem]' : 'translate-x-[0.15rem]',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-base text-ink">{label}</span>
        {description ? (
          <span className="mt-0.5 block text-sm text-ink-muted">{description}</span>
        ) : null}
      </span>
    </label>
  )
}
