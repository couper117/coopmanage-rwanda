import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect } from 'react'
import { useForm } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { Alert, Button, Dialog, FormField, Input } from '@/components/ui'
import type { CategoryInput, CategoryRow, FinanceKind } from './finance.api'
import { useCreateCategory, useFinanceError, useUpdateCategory } from './finance.hooks'

/**
 * Adding a category, or renaming one that already exists.
 *
 * **There is no kind control anywhere in here.** A category's kind is fixed the moment it is
 * created: moving one from income to expense would flip the sign of every entry already posted
 * against it and silently rewrite months that have been reported on and signed off. The dialog
 * states which kind it is working with instead, so the reader is not left looking for a control
 * that was deliberately not built.
 *
 * **There is no delete either.** A category that has fallen out of use is deactivated from the
 * categories screen, because the entries posted against it still have to be able to say where the
 * money went.
 */

const schema = z.object({
  name: z.string().trim().min(1).max(80),
  nameRw: z.string().trim().max(80),
  code: z.string().trim().max(20),
})

type FormValues = z.infer<typeof schema>

function valuesFor(category: CategoryRow | null): FormValues {
  return {
    name: category?.name ?? '',
    nameRw: category?.nameRw ?? '',
    code: category?.code ?? '',
  }
}

export interface CategoryDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Which list the dialog was opened from, and therefore the kind of a newly created category. */
  kind: FinanceKind
  /** The category being renamed, or `null` to add one. */
  category: CategoryRow | null
  onSaved?: (result: { name: string; created: boolean }) => void
}

export function CategoryDialog({
  open,
  onOpenChange,
  kind,
  category,
  onSaved,
}: CategoryDialogProps) {
  const { t } = useTranslation(['finance', 'common'])
  const describeError = useFinanceError()
  const create = useCreateCategory()
  const update = useUpdateCategory()

  const editing = category !== null
  const pending = create.isPending || update.isPending

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: valuesFor(category),
    mode: 'onBlur',
  })
  const { register, handleSubmit, reset, formState } = form

  /** Each opening starts from whatever is currently stored, or from a clean sheet when adding. */
  useEffect(() => {
    if (!open) return
    reset(valuesFor(category))
    create.reset()
    update.reset()
    // The mutation objects are rebuilt on every state change of their own, so depending on them
    // would clear the failure the moment it appeared. Their `reset` functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category, reset])

  const failed = create.error ?? update.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    // An emptied optional field is sent as an empty string, which the server stores as nothing.
    // That is how a Kinyarwanda name or a paper code is cleared rather than kept for ever.
    const shared = {
      name: values.name.trim(),
      nameRw: values.nameRw.trim(),
      code: values.code.trim(),
    }

    if (category) {
      update.mutate(
        { id: category.id, changes: shared },
        {
          onSuccess: (saved) => {
            onSaved?.({ name: saved.name, created: false })
            onOpenChange(false)
          },
        },
      )
      return
    }

    const body: CategoryInput = { kind, ...shared }
    create.mutate(body, {
      onSuccess: (saved) => {
        onSaved?.({ name: saved.name, created: true })
        onOpenChange(false)
      },
    })
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) return t(`finance:categoryErrors.${field}`)
    return serverFields[field]
  }

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="sm"
      busy={pending}
      title={t(editing ? 'finance:categoryDialog.editTitle' : 'finance:categoryDialog.addTitle')}
      description={t(
        kind === 'INCOME'
          ? 'finance:categoryDialog.descriptionIn'
          : 'finance:categoryDialog.descriptionOut',
      )}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
            {/* Abandoning a form, which is the shared "Cancel" and, in Kinyarwanda, Kureka. */}
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="category-form" loading={pending}>
            {t(editing ? 'finance:categoryDialog.submitEdit' : 'finance:categoryDialog.submitAdd')}
          </Button>
        </>
      }
    >
      <form
        id="category-form"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        {/*
          The kind, stated rather than offered. Said in full here because a reader who cannot find
          the control needs to know it was withheld on purpose and why.
        */}
        <p className="rounded-md border border-line bg-surface-subtle px-3 py-2 text-sm text-ink-secondary">
          {t(
            kind === 'INCOME'
              ? 'finance:categoryDialog.kindFixedIn'
              : 'finance:categoryDialog.kindFixedOut',
          )}
        </p>

        {category?.isSystem ? (
          <Alert tone="info">{t('finance:categoryDialog.systemOrigin')}</Alert>
        ) : null}

        <FormField label={t('finance:categoryFields.name')} error={errorFor('name')}>
          <Input autoComplete="off" {...register('name')} />
        </FormField>

        <FormField
          label={t('finance:categoryFields.nameRw')}
          optional
          hint={t('finance:categoryFields.nameRwHint')}
          error={errorFor('nameRw')}
        >
          <Input autoComplete="off" {...register('nameRw')} />
        </FormField>

        <FormField
          label={t('finance:categoryFields.code')}
          optional
          hint={t('finance:categoryFields.codeHint')}
          error={errorFor('code')}
        >
          <Input autoComplete="off" {...register('code')} />
        </FormField>
      </form>
    </Dialog>
  )
}
