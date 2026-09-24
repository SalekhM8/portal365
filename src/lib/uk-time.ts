/**
 * Format timestamps for humans in UK local time, labelled (BST/GMT).
 * The server runs in UTC on Vercel, so any string built server-side with a
 * bare toLocaleString() is an hour off in summer. Use these instead.
 */
const TZ = 'Europe/London'

export function ukDateTime(d: Date | string | number): string {
  // e.g. "24/09/2026, 11:57 BST"
  return new Date(d).toLocaleString('en-GB', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' })
}

export function ukDate(d: Date | string | number): string {
  // e.g. "24/09/2026"
  return new Date(d).toLocaleDateString('en-GB', { timeZone: TZ })
}
