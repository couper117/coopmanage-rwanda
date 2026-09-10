import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Badge, Button, EmptyState, FormField, Input, Money, Quantity } from '../src/components/ui'

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
