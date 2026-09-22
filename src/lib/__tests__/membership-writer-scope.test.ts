/**
 * Guard rail: every membership.updateMany keyed by userId MUST also scope to
 * `endDate: null`, so subscription-driven writers (webhooks, crons, admin
 * actions) can never stomp a cash/offline PACKAGE membership row (which is
 * identified by having an endDate). Package rows are written only by the
 * package routes, by id.
 *
 * If this test fails: add `endDate: null` to the where clause you just wrote,
 * or (rarely) key the write by membership id instead of userId.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (name === '__tests__' || name === 'node_modules') continue
    if (statSync(p).isDirectory()) walk(p, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(p)
  }
  return out
}

function whereClauses(src: string): Array<{ line: number; clause: string }> {
  const found: Array<{ line: number; clause: string }> = []
  let i = 0
  while (true) {
    const j = src.indexOf('membership.updateMany', i)
    if (j < 0) break
    const w = src.indexOf('where:', j)
    if (w < 0 || w - j > 400) { i = j + 20; continue }
    const b = src.indexOf('{', w)
    let depth = 0, k = b
    for (; k < src.length; k++) {
      if (src[k] === '{') depth++
      else if (src[k] === '}') { depth--; if (depth === 0) break }
    }
    found.push({ line: src.slice(0, j).split('\n').length, clause: src.slice(b, k + 1) })
    i = k + 1
  }
  return found
}

describe('membership writers never touch package rows', () => {
  const root = join(__dirname, '..', '..')
  const offenders: string[] = []
  for (const file of walk(join(root, 'app')).concat(walk(join(root, 'lib')))) {
    const src = readFileSync(file, 'utf8')
    for (const { line, clause } of whereClauses(src)) {
      if (/\buserId\b/.test(clause) && !/\bendDate\b/.test(clause)) offenders.push(`${file.replace(root, 'src')}:${line}`)
    }
  }
  it('every membership.updateMany keyed by userId is scoped with endDate: null', () => {
    expect(offenders, `Unscoped membership writers (add endDate: null):\n${offenders.join('\n')}`).toEqual([])
  })
})
