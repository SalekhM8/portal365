// Verify the pause-credits.ts fix against the bug scenarios.
// Compiled from src/lib/pause-credits.ts (manual transliteration of the relevant fn).

function getDaysInMonth(d) {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate()
}
function daysBetweenInclusive(a, b) {
  const ms = b.getTime() - a.getTime()
  return Math.round(ms / (1000 * 60 * 60 * 24)) + 1
}

function calc({ startDate, endDate, monthlyPrice }) {
  const start = new Date(Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate()))
  const end = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate()))

  const fullMonthsSkipped = []
  const partialMonths = []
  let totalDays = 0
  let totalSettlement = 0
  let totalCharge = 0

  let current = new Date(start)
  while (current <= end) {
    const year = current.getUTCFullYear()
    const monthNum = current.getUTCMonth()
    const daysInMonth = getDaysInMonth(current)
    const monthName = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthNum]} ${year}`
    const monthStart = new Date(Date.UTC(year, monthNum, 1))
    const monthEnd = new Date(Date.UTC(year, monthNum, daysInMonth))
    const overlapStart = start > monthStart ? start : monthStart
    const overlapEnd = end < monthEnd ? end : monthEnd
    const pausedDaysInMonth = daysBetweenInclusive(overlapStart, overlapEnd)
    totalDays += pausedDaysInMonth

    if (pausedDaysInMonth === daysInMonth) {
      fullMonthsSkipped.push(monthName)
    } else if (pausedDaysInMonth > 0) {
      const customerWasCharged = overlapStart.getTime() > monthStart.getTime()
      const dailyRate = monthlyPrice / daysInMonth
      const credit = pausedDaysInMonth * dailyRate
      const roundedCredit = Math.round(credit * 100) / 100
      const usedDays = customerWasCharged ? 0 : (daysInMonth - pausedDaysInMonth)
      const charge = usedDays * dailyRate
      const roundedCharge = Math.round(charge * 100) / 100

      partialMonths.push({
        month: monthName,
        pausedDays: pausedDaysInMonth,
        totalDaysInMonth: daysInMonth,
        creditAmount: customerWasCharged ? roundedCredit : 0,
        creditable: customerWasCharged,
        usedDays,
        chargeAmount: customerWasCharged ? 0 : roundedCharge
      })
      if (customerWasCharged) totalSettlement += roundedCredit
      else if (usedDays > 0) totalCharge += roundedCharge
    }
    current = new Date(Date.UTC(year, monthNum + 1, 1))
  }
  totalSettlement = Math.round(totalSettlement * 100) / 100
  totalCharge = Math.round(totalCharge * 100) / 100
  return {
    totalDays,
    fullMonthsSkipped,
    partialMonths,
    totalSettlementAmount: totalSettlement,
    totalChargeAmount: totalCharge
  }
}

function approxEq(a, b, tol = 0.02) {
  return Math.abs(a - b) <= tol
}

const cases = [
  // ── Original bug scenarios (Adam/Ahmed) ──
  // Mar 1 → Apr 29, £55. Mar full void. Apr: pause covers day 1, ends Apr 29 → 1 used day = £55/30 = £1.83
  { label: 'Adam (Mar 1 → Apr 29, £55) — bug case', start: '2026-03-01', end: '2026-04-29', price: 55, expectCredit: 0, expectCharge: 1.83 },
  { label: 'Ahmed-style (Mar 1 → Apr 29, £75)', start: '2026-03-01', end: '2026-04-29', price: 75, expectCredit: 0, expectCharge: 2.5 },

  // ── Full months only ──
  { label: 'Pause Jun 1 → Aug 31 (full months only)', start: '2026-06-01', end: '2026-08-31', price: 60, expectCredit: 0, expectCharge: 0 },

  // ── Pause covers day 1, ends mid-month (non-creditable, post-resume charge) ──
  // Jun 1 → Aug 15, £60. Jun & Jul full void. Aug: 15 paused / 31, used = 16 → 16 * £60/31 = £30.97
  { label: 'Pause Jun 1 → Aug 15, £60 — post-resume charge only', start: '2026-06-01', end: '2026-08-15', price: 60, expectCredit: 0, expectCharge: 30.97 },

  // ── Pause covers day 1, ends mid-month, single month ──
  // Mar 1 → Mar 5, £55. Pause covers day 1, used = 26 days → 26 * £55/31 = £46.13
  { label: 'Pause Mar 1 → Mar 5, £55 (single month, day 1 covered)', start: '2026-03-01', end: '2026-03-05', price: 55, expectCredit: 0, expectCharge: 46.13 },

  // ── Pause starts after day 1, ends on last day (creditable) ──
  // Mar 15 → Mar 31, £55. customer paid Mar fully, 17 days paused → 17 * £55/31 = £30.16
  { label: 'Pause Mar 15 → Mar 31 (mid-start, last-day end)', start: '2026-03-15', end: '2026-03-31', price: 55, expectCredit: 30.16, expectCharge: 0 },

  // ── Pause starts after day 1, spans into next month (creditable Mar, non-creditable Apr) ──
  // Mar 15 → Apr 20, £55.
  //   Mar: paused 15-31 = 17 days, creditable → 17 * £55/31 = £30.16
  //   Apr: pause covers day 1, ends Apr 20 → used = 10 days → 10 * £55/30 = £18.33
  { label: 'Pause Mar 15 → Apr 20, £55 (mixed: credit + post-resume charge)', start: '2026-03-15', end: '2026-04-20', price: 55, expectCredit: 30.16, expectCharge: 18.33 },

  // ── Pause entirely within one creditable month ──
  // Mar 5 → Mar 20, £55. paused after day 1, 16 days → 16 * £55/31 = £28.39
  { label: 'Pause Mar 5 → Mar 20, £55 (entirely within month, creditable)', start: '2026-03-05', end: '2026-03-20', price: 55, expectCredit: 28.39, expectCharge: 0 },

  // ── Big multi-month example with both shapes ──
  // Apr 15 → Jul 16, £50/month
  //   Apr: 16 days paused (15-30) of 30 → creditable → 16 * £50/30 = £26.67
  //   May & Jun: full void
  //   Jul: pause covers day 1, ends Jul 16 → used = 15 days → 15 * £50/31 = £24.19
  { label: 'Pause Apr 15 → Jul 16, £50 — credit + 2 voids + post-resume charge', start: '2026-04-15', end: '2026-07-16', price: 50, expectCredit: 26.67, expectCharge: 24.19 },

  // ── Single-day pause, mid-month (creditable) ──
  // Mar 15 → Mar 15, £55 → 1 * £55/31 = £1.77
  { label: 'Single-day pause Mar 15, £55 (creditable)', start: '2026-03-15', end: '2026-03-15', price: 55, expectCredit: 1.77, expectCharge: 0 },

  // ── Single-day pause on day 1 (non-creditable) ──
  // Mar 1 → Mar 1, £55 → pause covers day 1 only, used = 30 days → 30 * £55/31 = £53.23
  { label: 'Single-day pause Mar 1, £55 (non-creditable, day 1 covered)', start: '2026-03-01', end: '2026-03-01', price: 55, expectCredit: 0, expectCharge: 53.23 },

  // ── Pause starts day 1 of one month, ends last day of next month (full void of both) ──
  // Mar 1 → Apr 30, £55 → full Mar (31) + full Apr (30) → no credit, no charge
  { label: 'Pause Mar 1 → Apr 30 (two full months voided)', start: '2026-03-01', end: '2026-04-30', price: 55, expectCredit: 0, expectCharge: 0 },

  // ── Edge: pause starts day 1 of Mar, ends last day of Mar (single full void) ──
  { label: 'Pause Mar 1 → Mar 31 (full void, single month)', start: '2026-03-01', end: '2026-03-31', price: 55, expectCredit: 0, expectCharge: 0 },

  // ── Edge: pause Feb (28 days), creditable mid-start ──
  // Feb 10 → Feb 28, £50, 28-day month: 19 days paused → 19 * £50/28 = £33.93
  { label: 'Pause Feb 10 → Feb 28, £50 (28-day month, creditable)', start: '2026-02-10', end: '2026-02-28', price: 50, expectCredit: 33.93, expectCharge: 0 },

  // ── Edge: pause Feb 1 → Feb 27, £50 → non-creditable, used = 1 day → 1 * £50/28 = £1.79
  { label: 'Pause Feb 1 → Feb 27, £50 (28-day month, day 1 covered, 1 used day)', start: '2026-02-01', end: '2026-02-27', price: 50, expectCredit: 0, expectCharge: 1.79 },
]

console.log('\n=== Pause credit fix verification (credit + post-resume charge) ===\n')
let pass = 0, fail = 0
for (const c of cases) {
  const r = calc({
    startDate: new Date(c.start + 'T00:00:00Z'),
    endDate: new Date(c.end + 'T00:00:00Z'),
    monthlyPrice: c.price
  })
  const credit = r.totalSettlementAmount
  const charge = r.totalChargeAmount

  const creditOk = approxEq(credit, c.expectCredit)
  const chargeOk = approxEq(charge, c.expectCharge)
  const ok = creditOk && chargeOk

  console.log(`${ok ? '✅' : '❌'} ${c.label}`)
  console.log(`   credit = £${credit.toFixed(2)}  (expected £${c.expectCredit.toFixed(2)})  ${creditOk ? '' : '← MISMATCH'}`)
  console.log(`   charge = £${charge.toFixed(2)}  (expected £${c.expectCharge.toFixed(2)})  ${chargeOk ? '' : '← MISMATCH'}`)
  console.log(`   full months voided: ${r.fullMonthsSkipped.join(', ') || '(none)'}`)
  for (const p of r.partialMonths) {
    console.log(`   partial: ${p.month}  paused ${p.pausedDays}/${p.totalDaysInMonth}  creditable=${p.creditable}  used=${p.usedDays}  credit=£${p.creditAmount}  charge=£${p.chargeAmount}`)
  }
  ok ? pass++ : fail++
}

console.log(`\n=== ${pass} passed, ${fail} failed ===\n`)
process.exit(fail > 0 ? 1 : 0)
