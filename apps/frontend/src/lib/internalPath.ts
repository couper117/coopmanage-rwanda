/**
 * A link target that can only ever point inside this application.
 *
 * Four screens render a destination that arrived from the server: a notification's `actionUrl`, a
 * dashboard tile's and attention line's `href`, and an assistant answer's. Every one of those is
 * written by our own code today, from a constant — `/members`, `/finance`, `/meetings/<id>`.
 *
 * This makes that a property of the rendering rather than of the writers. A value that is not a
 * same-origin path is dropped, so the day a module writes something attacker-influenced into
 * `notifications.action_url` the link simply does not render, instead of becoming a
 * `javascript:` URL or an off-site redirect wearing the cooperative's own chrome.
 *
 * Refused: anything that does not begin with a single `/` — an absolute URL, a scheme of any kind,
 * and `//host`, which a browser reads as protocol-relative and therefore as off-site.
 *
 * Found in the Phase 15 review. Nothing was exploitable; this is the fence.
 */
export function internalPath(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (trimmed.length === 0) return null
  if (!trimmed.startsWith('/')) return null
  // `//evil.example` is protocol-relative: a browser treats it as another origin.
  if (trimmed.startsWith('//')) return null
  // A backslash is normalised to a slash by some browsers, so `/\evil.example` is the same trick.
  if (trimmed.startsWith('/\\')) return null
  return trimmed
}
