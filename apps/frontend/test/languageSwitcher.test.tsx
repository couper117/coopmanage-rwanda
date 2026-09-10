import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { LanguageSwitcher } from '../src/components/LanguageSwitcher'
import i18n, { changeLanguage, LANGUAGE_STORAGE_KEY, SUPPORTED_LANGUAGES } from '../src/i18n'

/**
 * The switcher's trigger, and the language change it performs, are asserted here. Opening the menu
 * is deliberately not driven in this suite: the menu is a Radix portal, and under jsdom every route
 * into it is unusable. userEvent's pointer simulation never terminates against the portal, and
 * Testing Library's role queries spend seventeen seconds computing accessibility visibility through
 * `getComputedStyle` for a menu that has in fact already opened in ninety milliseconds.
 *
 * What driving the menu would have proved is proved another way. The menu item's only job is to
 * call `changeLanguage`; the tests below cover that call, its persistence and its effect on the
 * trigger, and `app.test.tsx` asserts that the whole shell re-renders in Kinyarwanda. The dropdown's
 * own open-and-select behaviour belongs to Radix and is checked by hand in a browser as part of
 * each phase's bilingual review.
 */
describe('language switcher', () => {
  it('renders a labelled trigger showing the active language', async () => {
    await changeLanguage('en')
    render(<LanguageSwitcher />)
    const trigger = screen.getByLabelText('Language')
    expect(trigger).toHaveTextContent('en')
    expect(trigger).toHaveAttribute('aria-haspopup', 'menu')
  })

  it('labels itself in Kinyarwanda once the language changes', async () => {
    await changeLanguage('rw')
    render(<LanguageSwitcher />)
    expect(screen.getByLabelText('Ururimi')).toHaveTextContent('rw')
    await changeLanguage('en')
  })

  it('persists the chosen language so it survives a reload', async () => {
    await changeLanguage('rw')
    expect(i18n.resolvedLanguage).toBe('rw')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('rw')

    await changeLanguage('en')
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en')
  })

  it('supports exactly English and Kinyarwanda', () => {
    expect([...SUPPORTED_LANGUAGES]).toEqual(['en', 'rw'])
    for (const language of SUPPORTED_LANGUAGES) {
      expect(i18n.options.supportedLngs).toContain(language)
    }
  })
})
