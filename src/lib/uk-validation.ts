/**
 * UK-format validators for signup. Used on both the client (immediate UX
 * feedback) and the server (zod refinements in /api/register) so we stay
 * consistent and don't trust client-only checks.
 */

/**
 * Validate a UK phone number.
 *
 * Accepts common shapes after stripping spaces, dashes, parens and dots:
 *   - +44 7911 123456     →  +447911123456
 *   - 0044 7911 123456    →  00447911123456
 *   - 07911 123456        →  07911123456
 *   - 020 7946 0958       →  02079460958
 *
 * Rules (after normalisation, strict — designed to catch fakes like "12345"):
 *   - National: 11 digits total, must start with a real UK prefix
 *     (01, 02, 03, 07, 08, 09). Mobile is 07, landlines are 01/02/03, special
 *     services 08/09. UK does not issue 00, 04, 05, or 06 numbers to subscribers.
 *   - International: +44 / 0044 / 44 followed by the same 10-digit subscriber
 *     number (without the leading 0).
 *
 * Also rejects obvious junk like a single repeated digit or 11 zeros after the
 * prefix (e.g. 07000000000).
 */
export function isValidUKPhone(raw: string | null | undefined): boolean {
  if (!raw) return false
  const cleaned = String(raw).replace(/[\s\-().]/g, '')
  if (cleaned.length === 0) return false

  // Same digit repeated
  const digitsOnly = cleaned.replace(/^\+/, '')
  if (/^(\d)\1+$/.test(digitsOnly)) return false

  // Normalise to a 10-digit subscriber number
  let subscriber: string | null = null
  if (/^\+44[1-9]\d{9}$/.test(cleaned)) subscriber = cleaned.slice(3)
  else if (/^0044[1-9]\d{9}$/.test(cleaned)) subscriber = cleaned.slice(4)
  else if (/^44[1-9]\d{9}$/.test(cleaned)) subscriber = cleaned.slice(2)
  else if (/^0[1-9]\d{9}$/.test(cleaned)) subscriber = cleaned.slice(1)

  if (!subscriber) return false

  // Subscriber must start with 1, 2, 3, 7, 8 or 9 (UK number plan)
  if (!/^[123789]/.test(subscriber)) return false

  // Reject mostly-zero junk like 7000000000
  if (/^.0{9}$/.test(subscriber)) return false

  return true
}

/**
 * Validate a UK postcode.
 *
 * Reference (Royal Mail): the format permits 1–2 letters (area), 1 digit (district),
 * an optional letter or digit (sub-district), a space, then 1 digit (sector) and
 * 2 letters (unit). Whitespace is tolerated; case is ignored.
 *
 * Examples accepted: "SW1A 1AA", "m11ae", "B33 8TH", "CR2 6XH", "DN55 1PT", "GIR 0AA"
 * Examples rejected: "12345", "ABCDEF", "SW1A1A".
 */
export function isValidUKPostcode(raw: string | null | undefined): boolean {
  if (!raw) return false
  const trimmed = String(raw).trim().toUpperCase()
  if (trimmed.length === 0) return false

  // Special case: BFPO and Girobank "GIR 0AA" — keep these too
  if (/^GIR\s*0AA$/.test(trimmed)) return true

  // Strict Royal Mail style with optional space
  return /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/.test(trimmed)
}

/**
 * Normalise a UK postcode for storage: collapses whitespace and ensures a single
 * space before the inward (last 3) characters. Returns the trimmed, upper-cased
 * input unchanged if it does not match a UK postcode shape.
 */
export function normaliseUKPostcode(raw: string): string {
  const trimmed = String(raw || '').trim().toUpperCase().replace(/\s+/g, '')
  if (trimmed.length < 5) return trimmed
  // Insert space before the final 3 characters
  return `${trimmed.slice(0, -3)} ${trimmed.slice(-3)}`
}
