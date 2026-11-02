import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

/**
 * Guard rail: no Stripe subscription cancel in the codebase may ask Stripe to prorate.
 * Stripe's prorate-on-cancel never refunds a card; it books a credit on the customer
 * balance that only surfaces on a later invoice — invisible for a solo member, and a
 * mystery reduction on the parent's bill for a family child. House rule: cancelling
 * never refunds the current month; money back goes through the Refund button.
 */
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') walk(p, out) }
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

describe('no prorate on cancel', () => {
  it('every subscriptions.cancel() call passes prorate: false (or no prorate at all)', () => {
    const offenders: string[] = []
    for (const file of walk(join(process.cwd(), 'src'))) {
      const src = readFileSync(file, 'utf8')
      const re = /subscriptions\.cancel\(([\s\S]*?)\)\s*(?:,|\n|$)/g
      let m: RegExpExecArray | null
      while ((m = re.exec(src))) {
        const args = m[1]
        if (/prorate\s*:\s*(true|prorate\b)/.test(args) && !/prorate\s*:\s*false/.test(args)) offenders.push(`${file.replace(process.cwd() + '/', '')}: ${args.trim().slice(0, 80)}`)
      }
    }
    expect(offenders).toEqual([])
  })
  it('the admin cancel dialog no longer asks for a prorate', () => {
    const page = readFileSync(join(process.cwd(), 'src/app/admin/page.tsx'), 'utf8')
    expect(page).not.toMatch(/requestBody\.prorate\s*=\s*true/)
  })
  it('the admin cancel route hard-codes prorate false', () => {
    const route = readFileSync(join(process.cwd(), 'src/app/api/admin/customers/[id]/cancel-membership/route.ts'), 'utf8')
    expect(route).toMatch(/const prorate = false/)
  })
})
