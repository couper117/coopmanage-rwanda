import { describe, expect, it } from 'vitest'
import { SMS_SINGLE_SEGMENT, smsIsUnicode, smsSegments } from '../src/sms.js'

/**
 * The arithmetic a gateway bills by. Both applications quote it — the screen as somebody types,
 * the server when it records what was sent — so it lives here and is tested here, once.
 */
describe('the alphabet a message needs', () => {
  it('stays on the 7-bit alphabet for plain text, including Kinyarwanda with a straight apostrophe', () => {
    expect(smsIsUnicode("Inama y'abanyamuryango izaba ku wa gatatu saa tatu.")).toBe(false)
    expect(smsIsUnicode('Line one\nLine two\tTabbed\r\n')).toBe(false)
  })

  it('switches the whole message to 16-bit for one character outside it', () => {
    // The curly apostrophe a word processor pastes in, and an accented vowel.
    expect(smsIsUnicode('Inama y’abanyamuryango')).toBe(true)
    expect(smsIsUnicode('café')).toBe(true)
    // A control character other than tab, newline and return is not printable text either.
    expect(smsIsUnicode('bell')).toBe(true)
  })
})

describe('how many segments a body costs', () => {
  it('sends nothing for an empty body', () => {
    expect(smsSegments('')).toBe(0)
  })

  it('fits 160 plain characters into one segment and splits at 153 after that', () => {
    expect(smsSegments('a'.repeat(SMS_SINGLE_SEGMENT))).toBe(1)
    expect(smsSegments('a'.repeat(SMS_SINGLE_SEGMENT + 1))).toBe(2)
    expect(smsSegments('a'.repeat(306))).toBe(2)
    expect(smsSegments('a'.repeat(307))).toBe(3)
  })

  it('fits only 70 unicode characters into one segment and 67 into each after that', () => {
    const curly = '’'
    expect(smsSegments(curly.repeat(70))).toBe(1)
    expect(smsSegments(curly.repeat(71))).toBe(2)
    expect(smsSegments(curly.repeat(134))).toBe(2)
    expect(smsSegments(curly.repeat(135))).toBe(3)
  })

  it('charges a 150-character message three times over for one wrong apostrophe', () => {
    const straight = "Murakaza neza mu nama y'abanyamuryango ".repeat(4).slice(0, 150)
    const curly = straight.replace("'", '’')
    expect(smsSegments(straight)).toBe(1)
    expect(smsSegments(curly)).toBe(3)
  })
})
