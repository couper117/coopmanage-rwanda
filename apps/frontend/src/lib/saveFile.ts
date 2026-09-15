import type { DownloadedFile } from '@/lib/apiClient'

/**
 * Hands a downloaded file to the browser.
 *
 * There is no hidden anchor in the markup for this: one is made, clicked and removed. The object
 * URL is revoked afterwards, because it pins the whole file in memory until the tab closes
 * otherwise, and a cooperative producing a dozen reports in a sitting would hold every one of
 * them.
 *
 * Does nothing where `URL.createObjectURL` is absent, which is the case under jsdom. That keeps
 * the tests able to assert that the request was made and the right file came back, without
 * needing a browser to receive it.
 */
export function saveFile({ blob, filename }: DownloadedFile): void {
  if (typeof URL.createObjectURL !== 'function') return

  const href = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = href
  link.download = filename
  link.rel = 'noopener'
  document.body.append(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(href)
}
