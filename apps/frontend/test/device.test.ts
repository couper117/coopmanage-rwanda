import { describe, expect, it } from 'vitest'
import { describeDevice } from '../src/lib/device'

/**
 * The device list answers one question: "do I recognise this?". These are the strings the browsers
 * a Rwandan cooperative office actually runs send, and each must produce a sentence somebody can
 * answer that question from.
 */
describe('describing a device', () => {
  const cases: [string, string][] = [
    [
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
      'Chrome on macOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0',
      'Edge on Windows',
    ],
    [
      'Mozilla/5.0 (Linux; Android 13; SM-A155F) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/23.0 Chrome/115.0.0.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iPhone',
    ],
    ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0', 'Firefox on Linux'],
  ]

  for (const [userAgent, expected] of cases) {
    it(`reads "${expected}"`, () => {
      expect(describeDevice(userAgent)).toBe(expected)
    })
  }

  it('says nothing rather than guessing at something that is not a browser', () => {
    // The interface shows its own "unrecognised device" wording, which is translated; returning a
    // fragment of the raw string here would put untranslatable text on the screen.
    expect(describeDevice('curl/8.7.1')).toBeNull()
    expect(describeDevice(null)).toBeNull()
  })
})
