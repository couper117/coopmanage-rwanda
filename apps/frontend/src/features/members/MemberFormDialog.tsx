import { zodResolver } from '@hookform/resolvers/zod'
import { useEffect, useMemo } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'
import { isRwandanPhone, RWANDA_PROVINCES, type Province } from '@coopmanage/shared'
import {
  Alert,
  Button,
  Dialog,
  FormField,
  Input,
  Select,
  Textarea,
  type SelectOption,
} from '@/components/ui'
import {
  MEMBER_GENDERS,
  MEMBER_POSITIONS,
  type MemberDetail,
  type MemberGender,
  type MemberInput,
  type MemberPosition,
} from './members.api'
import { todayIso, useCreateMember, useMemberError, useUpdateMember } from './members.hooks'

/**
 * Adding and editing a member.
 *
 * **A member needs a name and nothing else.** That is the product rule this form exists to
 * honour, so only the two name fields are required and every other field is marked optional.
 * The phone field says so twice — once in the label and once in its hint — because most members
 * of a Rwandan agricultural cooperative have no phone, and a form that appears to demand one is
 * how a secretary ends up inventing numbers.
 *
 * Nothing is validated as the user types. The checks that do run mirror the server's own, so a
 * value that cannot be accepted is refused here rather than after a round trip, and the server
 * checks again regardless.
 */

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

function compactDigits(value: string): string {
  return value.replace(/\s/g, '')
}

const schema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  // Empty is always allowed: "not given" is the normal answer for all of these.
  gender: z.string(),
  dateOfBirth: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  nationalId: z
    .string()
    .refine((value) => compactDigits(value) === '' || /^\d{16}$/.test(compactDigits(value))),
  // Never required, never blocking. A number that *was* given still has to be usable.
  phone: z.string().refine((value) => value.trim() === '' || isRwandanPhone(value)),
  email: z
    .string()
    .refine((value) => value.trim() === '' || z.email().safeParse(value.trim()).success),
  province: z.string(),
  district: z.string().trim().max(60),
  sector: z.string().trim().max(60),
  cell: z.string().trim().max(60),
  village: z.string().trim().max(60),
  joinedOn: z.string().refine((value) => value === '' || DATE_ONLY.test(value)),
  position: z.string(),
  notes: z.string().trim().max(2000),
})

type FormValues = z.infer<typeof schema>

/** The fields with a sentence of their own. Anything else falls back to the shared wording. */
const OWN_ERROR_FIELDS = new Set<keyof FormValues>([
  'firstName',
  'lastName',
  'nationalId',
  'phone',
  'email',
  'dateOfBirth',
  'joinedOn',
])

function emptyValues(): FormValues {
  return {
    firstName: '',
    lastName: '',
    gender: '',
    dateOfBirth: '',
    nationalId: '',
    phone: '',
    email: '',
    province: '',
    district: '',
    sector: '',
    cell: '',
    village: '',
    // Somebody registered at the desk joined today, which is the answer nine times in ten.
    joinedOn: todayIso(),
    position: '',
    notes: '',
  }
}

function valuesFrom(member: MemberDetail): FormValues {
  return {
    firstName: member.firstName,
    lastName: member.lastName,
    gender: member.gender === 'UNSPECIFIED' ? '' : member.gender,
    dateOfBirth: member.dateOfBirth ?? '',
    nationalId: member.nationalId ?? '',
    phone: member.phone ?? '',
    email: member.email ?? '',
    province: member.province ?? '',
    district: member.district ?? '',
    sector: member.sector ?? '',
    cell: member.cell ?? '',
    village: member.village ?? '',
    joinedOn: member.joinedOn,
    position: member.position === 'MEMBER' ? '' : member.position,
    notes: member.notes ?? '',
  }
}

function asGender(value: string): MemberGender | undefined {
  return MEMBER_GENDERS.find((candidate) => candidate === value)
}

function asPosition(value: string): MemberPosition | undefined {
  return MEMBER_POSITIONS.find((candidate) => candidate === value)
}

function asProvince(value: string): Province | undefined {
  return RWANDA_PROVINCES.find((candidate) => candidate === value)
}

/**
 * What to send.
 *
 * Empty text is sent as `''`, which the server stores as null — that is how a field is cleared on
 * an edit. Enums and dates cannot carry an empty string, so they are sent as `null` where the
 * server accepts null and omitted where it does not. On a create nothing empty is sent at all,
 * which keeps the request to exactly what the user typed.
 */
function toInput(values: FormValues, editing: boolean): MemberInput {
  const gender = asGender(values.gender)
  const position = asPosition(values.position)
  const province = asProvince(values.province)
  const nationalId = compactDigits(values.nationalId)
  const phone = values.phone.trim()
  const email = values.email.trim()

  const body: MemberInput = {
    firstName: values.firstName.trim(),
    lastName: values.lastName.trim(),
  }

  if (gender) body.gender = gender
  if (position) body.position = position
  if (values.joinedOn) body.joinedOn = values.joinedOn

  // `dateOfBirth` and `province` are nullable on the server, so an edit can genuinely clear them.
  if (values.dateOfBirth) body.dateOfBirth = values.dateOfBirth
  else if (editing) body.dateOfBirth = null

  if (province) body.province = province
  else if (editing) body.province = null

  for (const [key, value] of [
    ['nationalId', nationalId],
    ['phone', phone],
    ['email', email],
    ['district', values.district.trim()],
    ['sector', values.sector.trim()],
    ['cell', values.cell.trim()],
    ['village', values.village.trim()],
    ['notes', values.notes.trim()],
  ] as const) {
    if (value !== '' || editing) body[key] = value
  }

  return body
}

export interface MemberFormDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** When given, the dialog edits that member. Otherwise it adds a new one. */
  member?: MemberDetail | null
  onSaved?: (member: MemberDetail, mode: 'created' | 'updated') => void
}

export function MemberFormDialog({
  open,
  onOpenChange,
  member = null,
  onSaved,
}: MemberFormDialogProps) {
  const { t } = useTranslation(['members', 'common', 'validation'])
  const describeError = useMemberError()
  const create = useCreateMember()
  const update = useUpdateMember()
  const editing = member !== null

  const defaults = useMemo(() => (member ? valuesFrom(member) : emptyValues()), [member])

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: defaults,
    // On blur and again on submit, never on every keystroke.
    mode: 'onBlur',
  })
  const { register, handleSubmit, reset, formState, control } = form

  /**
   * Opening the dialog starts from a clean sheet: the fields as they should be, and no error left
   * over from the last attempt. Nothing local is set here — the failure is read from the mutation
   * rather than copied into state, which is what keeps this an effect that synchronises rather
   * than one that cascades.
   */
  useEffect(() => {
    if (!open) return
    reset(defaults)
    create.reset()
    update.reset()
    // The two mutation objects are rebuilt on every state change of their own, so depending on
    // them would clear the failure the moment it appeared. Their `reset` functions are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaults, reset])

  // `Select` is a controlled native select, so the chosen value has to come back to it; the
  // registration alone supplies `onChange` but no `value`.
  const gender = useWatch({ control, name: 'gender' })
  const province = useWatch({ control, name: 'province' })
  const position = useWatch({ control, name: 'position' })

  const pending = create.isPending || update.isPending
  // The failure and any field errors are the mutation's own state, read rather than duplicated.
  const failed = update.error ?? create.error
  const described = failed ? describeError(failed) : null
  const serverFields = described?.fieldErrors ?? {}

  const submit = handleSubmit((values) => {
    const done = (saved: MemberDetail, mode: 'created' | 'updated') => {
      onSaved?.(saved, mode)
      onOpenChange(false)
    }
    if (member) {
      update.mutate(
        { id: member.id, changes: toInput(values, true) },
        { onSuccess: (saved) => done(saved, 'updated') },
      )
    } else {
      create.mutate(toInput(values, false), { onSuccess: (saved) => done(saved, 'created') })
    }
  })

  function errorFor(field: keyof FormValues): string | undefined {
    if (formState.errors[field]) {
      return OWN_ERROR_FIELDS.has(field)
        ? t(`members:fieldErrors.${field}`)
        : t('validation:too_big')
    }
    return serverFields[field]
  }

  const genderOptions: SelectOption[] = MEMBER_GENDERS.filter(
    (value) => value !== 'UNSPECIFIED',
  ).map((value) => ({ value, label: t(`members:gender.${value}`) }))

  const provinceOptions: SelectOption[] = RWANDA_PROVINCES.map((value) => ({
    value,
    label: t(`members:province.${value}`),
  }))

  const positionOptions: SelectOption[] = MEMBER_POSITIONS.filter(
    (value) => value !== 'MEMBER',
  ).map((value) => ({ value, label: t(`members:position.${value}`) }))

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      width="lg"
      busy={pending}
      title={
        member
          ? t('members:form.editTitle', { name: member.fullName })
          : t('members:form.createTitle')
      }
      description={member ? t('members:form.editDescription') : t('members:form.createDescription')}
      footer={
        <>
          <Button variant="secondary" disabled={pending} onClick={() => onOpenChange(false)}>
            {t('common:actions.cancel')}
          </Button>
          <Button type="submit" form="member-form" loading={pending}>
            {editing ? t('members:form.submitSave') : t('members:form.submitCreate')}
          </Button>
        </>
      }
    >
      <form
        id="member-form"
        noValidate
        className="flex flex-col gap-5"
        onSubmit={(event) => void submit(event)}
      >
        {described ? <Alert tone="danger">{described.message}</Alert> : null}

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold text-ink">
            {t('members:form.identitySection')}
          </legend>

          {/* The one genuinely paired case for two columns, per docs/ui-system.md section 7. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('members:fields.firstName')} error={errorFor('firstName')}>
              <Input autoComplete="given-name" {...register('firstName')} />
            </FormField>
            <FormField label={t('members:fields.lastName')} error={errorFor('lastName')}>
              <Input autoComplete="family-name" {...register('lastName')} />
            </FormField>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('members:fields.gender')} optional error={errorFor('gender')}>
              <Select
                options={genderOptions}
                placeholder={t('members:fields.genderPlaceholder')}
                value={gender ?? ''}
                {...register('gender')}
              />
            </FormField>
            <FormField
              label={t('members:fields.dateOfBirth')}
              optional
              error={errorFor('dateOfBirth')}
            >
              <Input type="date" {...register('dateOfBirth')} />
            </FormField>
          </div>

          <FormField
            label={t('members:fields.nationalId')}
            optional
            hint={t('members:fields.nationalIdHint')}
            error={errorFor('nationalId')}
          >
            <Input inputMode="numeric" autoComplete="off" {...register('nationalId')} />
          </FormField>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold text-ink">
            {t('members:form.contactSection')}
          </legend>

          <FormField
            label={t('members:fields.phone')}
            optional
            hint={t('members:fields.phoneHint')}
            error={errorFor('phone')}
          >
            <Input inputMode="tel" autoComplete="off" {...register('phone')} />
          </FormField>

          <FormField label={t('members:fields.email')} optional error={errorFor('email')}>
            <Input inputMode="email" autoComplete="off" {...register('email')} />
          </FormField>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold text-ink">
            {t('members:form.locationSection')}
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label={t('members:fields.province')} optional error={errorFor('province')}>
              <Select
                options={provinceOptions}
                placeholder={t('members:fields.provincePlaceholder')}
                value={province ?? ''}
                {...register('province')}
              />
            </FormField>
            <FormField label={t('members:fields.district')} optional error={errorFor('district')}>
              <Input autoComplete="off" {...register('district')} />
            </FormField>
            <FormField label={t('members:fields.sector')} optional error={errorFor('sector')}>
              <Input autoComplete="off" {...register('sector')} />
            </FormField>
            <FormField label={t('members:fields.cell')} optional error={errorFor('cell')}>
              <Input autoComplete="off" {...register('cell')} />
            </FormField>
            <FormField label={t('members:fields.village')} optional error={errorFor('village')}>
              <Input autoComplete="off" {...register('village')} />
            </FormField>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-4">
          <legend className="mb-2 text-sm font-semibold text-ink">
            {t('members:form.membershipSection')}
          </legend>

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField
              label={t('members:fields.joinedOn')}
              optional
              hint={t('members:fields.joinedOnHint')}
              error={errorFor('joinedOn')}
            >
              <Input type="date" {...register('joinedOn')} />
            </FormField>
            <FormField label={t('members:fields.position')} optional error={errorFor('position')}>
              <Select
                options={positionOptions}
                placeholder={t('members:fields.positionPlaceholder')}
                value={position ?? ''}
                {...register('position')}
              />
            </FormField>
          </div>

          <FormField
            label={t('members:fields.notes')}
            optional
            hint={t('members:fields.notesHint')}
            error={errorFor('notes')}
          >
            <Textarea rows={3} {...register('notes')} />
          </FormField>
        </fieldset>
      </form>
    </Dialog>
  )
}
