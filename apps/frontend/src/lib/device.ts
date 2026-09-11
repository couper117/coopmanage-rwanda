/**
 * Turns a user-agent string into something a cooperative secretary can recognise.
 *
 * The point of the device list is "do I recognise this?", and a raw user-agent string cannot be
 * answered. Browser and operating system can, and that is all this extracts. It deliberately does
 * not try to be a full user-agent parser: the strings are unreliable, and a wrong guess about a
 * version number would be worse than saying nothing.
 */
const BROWSERS: { name: string; test: RegExp }[] = [
  // Order matters: Edge and Opera both contain "Chrome", and Chrome contains "Safari".
  { name: 'Edge', test: /\bEdg(?:e|A|iOS)?\// },
  { name: 'Opera', test: /\bOPR\/|\bOpera\// },
  { name: 'Samsung Internet', test: /\bSamsungBrowser\// },
  { name: 'Firefox', test: /\bFirefox\/|\bFxiOS\// },
  { name: 'Chrome', test: /\bChrome\/|\bCriOS\// },
  { name: 'Safari', test: /\bSafari\// },
]

const PLATFORMS: { name: string; test: RegExp }[] = [
  { name: 'Android', test: /\bAndroid\b/ },
  { name: 'iPhone', test: /\biPhone\b/ },
  { name: 'iPad', test: /\biPad\b/ },
  { name: 'Windows', test: /\bWindows\b/ },
  { name: 'macOS', test: /\bMac OS X\b|\bMacintosh\b/ },
  { name: 'Linux', test: /\bLinux\b/ },
]

export function describeDevice(userAgent: string | null): string | null {
  if (!userAgent) return null

  const browser = BROWSERS.find((candidate) => candidate.test.test(userAgent))?.name
  const platform = PLATFORMS.find((candidate) => candidate.test.test(userAgent))?.name

  if (browser && platform) return `${browser} on ${platform}`
  if (browser) return browser
  if (platform) return platform
  // Something that is not a browser at all — a script, or a tool calling the API. Saying so is
  // more useful than showing thirty characters of a string nobody can read.
  return null
}
