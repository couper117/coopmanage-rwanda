import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { useState } from 'react'
import {
  Badge,
  Button,
  EmptyState,
  FormField,
  Input,
  Money,
  Quantity,
  SearchSelect,
  type SearchOption,
} from '../src/components/ui'

describe('Button', () => {
  it('renders a real button with its label', () => {
    render(<Button>Record expense</Button>)
    expect(screen.getByRole('button', { name: 'Record expense' })).toBeInTheDocument()
  })

  it('defaults to type="button" so it cannot submit a form by accident', () => {
    render(<Button>Filter</Button>)
    expect(screen.getByRole('button')).toHaveAttribute('type', 'button')
  })

  it('keeps its label while loading and blocks further clicks', async () => {
    const onClick = vi.fn()
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    )
    const button = screen.getByRole('button', { name: 'Save' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    await userEvent.click(button)
    expect(onClick).not.toHaveBeenCalled()
  })

  it('calls its handler when enabled', async () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Add member</Button>)
    await userEvent.click(screen.getByRole('button'))
    expect(onClick).toHaveBeenCalledOnce()
  })
})

describe('FormField', () => {
  it('labels the control and links it by id', () => {
    render(
      <FormField label="Member name">
        <Input />
      </FormField>,
    )
    expect(screen.getByLabelText('Member name')).toBeInTheDocument()
  })

  it('marks optional fields, which matters for the member phone number', () => {
    render(
      <FormField label="Phone number" optional>
        <Input />
      </FormField>,
    )
    expect(screen.getByText(/optional/i)).toBeInTheDocument()
  })

  it('announces an error through aria-describedby and marks the control invalid', () => {
    render(
      <FormField label="Amount" error="validation.positiveAmount">
        <Input />
      </FormField>,
    )
    const input = screen.getByLabelText('Amount')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    const describedBy = input.getAttribute('aria-describedby')
    expect(describedBy).toBeTruthy()
    expect(document.getElementById(describedBy as string)).toHaveTextContent(
      'Enter an amount greater than zero.',
    )
  })

  it('hides the hint once there is an error, so the two never compete', () => {
    render(
      <FormField label="Amount" hint="In Rwandan francs" error="validation.required">
        <Input />
      </FormField>,
    )
    expect(screen.queryByText('In Rwandan francs')).not.toBeInTheDocument()
  })
})

describe('Badge', () => {
  it('pairs a dot with the label so status never rests on colour alone', () => {
    const { container } = render(<Badge tone="success">Active</Badge>)
    expect(screen.getByText('Active')).toBeInTheDocument()
    expect(container.querySelectorAll('span[aria-hidden="true"]')).toHaveLength(1)
  })
})

describe('Money', () => {
  it('formats whole francs with a currency code', () => {
    render(<Money value="250000.00" />)
    expect(screen.getByText('250,000 RWF')).toBeInTheDocument()
  })

  it('shows direction with a sign, not only with colour', () => {
    render(<Money value="120000.00" tone="out" />)
    expect(screen.getByText('−120,000 RWF')).toBeInTheDocument()
  })

  it('formats a quantity with its unit', () => {
    render(<Quantity value="1240.500" unit="kg" />)
    expect(screen.getByText('1,240.5 kg')).toBeInTheDocument()
  })
})

describe('EmptyState', () => {
  it('always gives a heading and a next step', () => {
    render(
      <EmptyState
        title="No members yet"
        description="Add your first cooperative member to start building your records."
        action={<Button>Add member</Button>}
      />,
    )
    expect(screen.getByRole('heading', { name: 'No members yet' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add member' })).toBeInTheDocument()
  })
})

/**
 * The picker used where a native `<select>` cannot go: a list of hundreds of members that lives on
 * the server and is found by typing. Its keyboard contract is the part that matters, because the
 * staff who work fastest never touch the mouse.
 */
const MEMBERS: SearchOption[] = [
  { value: 'm1', label: 'Chantal Mukamana', hint: 'ABAH-0001' },
  { value: 'm2', label: 'Eric Habimana', hint: 'ABAH-0002' },
  { value: 'm3', label: 'Solange Mutesi', hint: 'ABAH-0003 · Left the cooperative' },
]

function PickerHarness({ options = MEMBERS }: { options?: SearchOption[] }) {
  const [value, setValue] = useState<SearchOption | null>(null)
  const [query, setQuery] = useState('')
  return (
    <>
      <FormField label="Member this concerns" optional>
        <SearchSelect
          value={value}
          onChange={setValue}
          options={options}
          query={query}
          onQueryChange={setQuery}
          placeholder="Search by name"
          emptyLabel="No member matches that"
          loadingLabel="Searching the register"
          clearLabel="Remove the member"
        />
      </FormField>
      <p>selected: {value ? value.value : 'none'}</p>
    </>
  )
}

describe('SearchSelect', () => {
  it('is a combobox that says whether its list is open', async () => {
    render(<PickerHarness />)
    const input = screen.getByRole('combobox')

    expect(input).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(input)
    expect(input).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('listbox')).toBeInTheDocument()
  })

  it('takes an option with the arrows and Enter, without the mouse', async () => {
    render(<PickerHarness />)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)

    await userEvent.keyboard('{ArrowDown}')
    await userEvent.keyboard('{Enter}')

    // The highlight starts on the first option, so one press down takes the second.
    expect(screen.getByText('selected: m2')).toBeInTheDocument()
    // The list closes once something is chosen, and the box shows the choice rather than the text.
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('Eric Habimana')).toBeInTheDocument()
    expect(screen.getByText('ABAH-0002')).toBeInTheDocument()
  })

  it('names the highlighted option for a screen reader without moving focus', async () => {
    render(<PickerHarness />)
    const input = screen.getByRole('combobox')
    await userEvent.click(input)

    const first = screen.getByRole('option', { selected: true })
    expect(input).toHaveAttribute('aria-activedescendant', first.id)
    // Focus stays in the box, which is what lets the user keep typing.
    expect(input).toHaveFocus()
  })

  it('wraps the highlight round the ends of the list', async () => {
    render(<PickerHarness />)
    await userEvent.click(screen.getByRole('combobox'))

    // Up from the first option reaches the last, so a long list can be reached from either end.
    await userEvent.keyboard('{ArrowUp}')
    await userEvent.keyboard('{Enter}')
    expect(screen.getByText('selected: m3')).toBeInTheDocument()
  })

  it('closes on Escape without choosing anything', async () => {
    render(<PickerHarness />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.keyboard('{Escape}')

    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByText('selected: none')).toBeInTheDocument()
  })

  it('leaves Enter alone when the list is closed, so a form can still be submitted', async () => {
    const onSubmit = vi.fn((event: React.FormEvent) => event.preventDefault())
    render(
      <form onSubmit={onSubmit}>
        <PickerHarness />
        <button type="submit">Record</button>
      </form>,
    )

    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    await userEvent.keyboard('{Escape}')
    await userEvent.keyboard('{Enter}')

    expect(onSubmit).toHaveBeenCalledTimes(1)
    expect(screen.getByText('selected: none')).toBeInTheDocument()
  })

  it('says so when a search found nothing', async () => {
    render(<PickerHarness options={[]} />)
    await userEvent.click(screen.getByRole('combobox'))

    // "No member matches that" is a different answer from an empty list, which reads as broken.
    expect(screen.getByText('No member matches that')).toBeInTheDocument()
  })

  it('lets the choice be taken back', async () => {
    render(<PickerHarness />)
    await userEvent.click(screen.getByRole('combobox'))
    await userEvent.keyboard('{Enter}')
    expect(screen.getByText('selected: m1')).toBeInTheDocument()

    // Naming a member is optional, so unnaming one has to be possible without reopening the form.
    await userEvent.click(screen.getByRole('button', { name: 'Remove the member' }))
    expect(screen.getByText('selected: none')).toBeInTheDocument()
    expect(screen.getByRole('combobox')).toBeInTheDocument()
  })

  it('carries the label and the optional marker from the field around it', () => {
    render(<PickerHarness />)
    // The picker is a field like any other, so it has to be reachable by its label.
    expect(screen.getByLabelText(/Member this concerns/)).toBe(screen.getByRole('combobox'))
  })
})
