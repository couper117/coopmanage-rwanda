import { describe, expect, it } from 'vitest'
import { internalPath } from '../src/lib/internalPath'

/**
 * The fence Phase 15 put around the four link targets that arrive from the server.
 *
 * Nothing was exploitable when it was added: every value is written by our own code from a
 * constant. The point is that it stays that way without anybody having to remember — a module that
 * one day writes something attacker-influenced into `notifications.action_url` gets a link that
 * does not render, rather than a `javascript:` URL wearing the cooperative's own chrome.
 */
describe('a link target from the server', () => {
  it('accepts a path inside the application', () => {
    expect(internalPath('/members')).toBe('/members')
    expect(internalPath('/meetings/7c9e6679-7425-40de-944b-e07fc1f90ae7')).toBe(
      '/meetings/7c9e6679-7425-40de-944b-e07fc1f90ae7',
    )
    expect(internalPath('/members?hasPhone=no')).toBe('/members?hasPhone=no')
  })

  it('refuses a scheme of any kind', () => {
    expect(internalPath('javascript:alert(1)')).toBeNull()
    expect(internalPath('https://evil.example/steal')).toBeNull()
    expect(internalPath('data:text/html,<script>alert(1)</script>')).toBeNull()
  })

  it('refuses a protocol-relative address, which a browser reads as another site', () => {
    expect(internalPath('//evil.example')).toBeNull()
    // Some browsers normalise a backslash to a slash, which makes this the same trick.
    expect(internalPath('/\\evil.example')).toBeNull()
  })

  it('refuses nothing at all', () => {
    expect(internalPath(null)).toBeNull()
    expect(internalPath(undefined)).toBeNull()
    expect(internalPath('   ')).toBeNull()
    expect(internalPath('members')).toBeNull()
  })
})
