/**
 * Pause Credit Calculation System
 * 
 * Implements credit-forward billing for subscription pauses:
 * - Customer pays full amount for current month
 * - Paused days are credited on NEXT invoice
 * - Uses Stripe InvoiceItems for seamless billing
 */

import { Decimal } from '@prisma/client/runtime/library'

export interface PausePeriod {
  startDate: Date
  endDate: Date
  monthlyPrice: number // in GBP
}

export interface CreditCalculation {
  pausedDays: number
  creditAmount: number // in GBP
  creditPence: number // in pence for Stripe
  description: string
  breakdown: CreditBreakdownItem[]
}

export interface CreditBreakdownItem {
  month: string // e.g., "January 2026"
  year: number
  monthNumber: number // 1-12
  daysInMonth: number
  pausedDaysInMonth: number
  dailyRate: number
  creditForMonth: number
}

/**
 * Get the number of days in a given month
 */
export function getDaysInMonth(date: Date): number {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate()
}

/**
 * Format a date as "Jan 15"
 */
export function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getDate()}`
}

/**
 * Format a date as "January 2026"
 */
export function formatMonthYear(date: Date): string {
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 
                  'July', 'August', 'September', 'October', 'November', 'December']
  return `${months[date.getMonth()]} ${date.getFullYear()}`
}

/**
 * Calculate the number of days between two dates (inclusive)
 */
export function daysBetweenInclusive(start: Date, end: Date): number {
  const startNormalized = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()))
  const endNormalized = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()))
  const diffTime = endNormalized.getTime() - startNormalized.getTime()
  const diffDays = Math.floor(diffTime / (1000 * 60 * 60 * 24))
  return diffDays + 1 // inclusive
}

/**
 * Calculate pause credit with per-month breakdown
 * 
 * Handles pauses that span multiple months by calculating
 * the credit for each month based on that month's daily rate.
 * 
 * Example:
 * - Pause Jan 25 - Feb 5
 * - January: 7 days (25-31) at £50/31 = £11.29
 * - February: 5 days (1-5) at £50/28 = £8.93
 * - Total credit: £20.22
 */
export function calculatePauseCredit(period: PausePeriod): CreditCalculation {
  const { startDate, endDate, monthlyPrice } = period
  
  // Normalize dates to UTC midnight
  const start = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()))
  const end = new Date(Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()))
  
  // Validate
  if (end < start) {
    throw new Error('End date must be after or equal to start date')
  }
  
  const breakdown: CreditBreakdownItem[] = []
  let totalPausedDays = 0
  let totalCredit = 0
  
  // Iterate through each day of the pause period
  const current = new Date(start)
  let currentMonthStart = new Date(current)
  let daysInCurrentMonth = 0
  
  while (current <= end) {
    const monthKey = `${current.getUTCFullYear()}-${current.getUTCMonth()}`
    
    // Check if we've moved to a new month
    if (breakdown.length > 0) {
      const lastEntry = breakdown[breakdown.length - 1]
      const lastKey = `${lastEntry.year}-${lastEntry.monthNumber - 1}`
      
      if (monthKey !== lastKey) {
        // Finalize the previous month entry
        currentMonthStart = new Date(current)
        daysInCurrentMonth = 0
      }
    }
    
    daysInCurrentMonth++
    totalPausedDays++
    
    // Check if we need to create/update entry for this month
    const existingEntry = breakdown.find(
      b => b.year === current.getUTCFullYear() && b.monthNumber === current.getUTCMonth() + 1
    )
    
    const daysInThisMonth = getDaysInMonth(current)
    const dailyRate = monthlyPrice / daysInThisMonth
    
    if (existingEntry) {
      existingEntry.pausedDaysInMonth++
      existingEntry.creditForMonth = existingEntry.pausedDaysInMonth * dailyRate
    } else {
      breakdown.push({
        month: formatMonthYear(current),
        year: current.getUTCFullYear(),
        monthNumber: current.getUTCMonth() + 1,
        daysInMonth: daysInThisMonth,
        pausedDaysInMonth: 1,
        dailyRate: Math.round(dailyRate * 100) / 100, // Round to 2dp
        creditForMonth: dailyRate
      })
    }
    
    // Move to next day
    current.setUTCDate(current.getUTCDate() + 1)
  }
  
  // Calculate total credit from breakdown
  totalCredit = breakdown.reduce((sum, item) => sum + item.creditForMonth, 0)
  
  // Round credit amounts
  breakdown.forEach(item => {
    item.creditForMonth = Math.round(item.creditForMonth * 100) / 100
  })
  totalCredit = Math.round(totalCredit * 100) / 100
  
  // Generate description
  const description = breakdown.length === 1
    ? `Pause credit: ${formatShortDate(start)} - ${formatShortDate(end)} (${totalPausedDays} days)`
    : `Pause credit: ${formatShortDate(start)} - ${formatShortDate(end)} (${totalPausedDays} days across ${breakdown.length} months)`
  
  return {
    pausedDays: totalPausedDays,
    creditAmount: totalCredit,
    creditPence: Math.round(totalCredit * 100),
    description,
    breakdown
  }
}

/**
 * Validate a pause window request
 */
export function validatePauseWindow(
  startDate: Date,
  endDate: Date,
  existingPauses?: { startDate: Date; endDate: Date; status: string }[]
): { valid: boolean; error?: string } {
  const today = new Date()
  today.setUTCHours(0, 0, 0, 0)
  
  const start = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()))
  const end = new Date(Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()))
  
  // Must be in the future
  if (start < today) {
    return { valid: false, error: 'Start date must be today or in the future' }
  }
  
  // End must be after or same as start
  if (end < start) {
    return { valid: false, error: 'End date must be after or equal to start date' }
  }
  
  // Max pause duration: 90 days
  const pauseDays = daysBetweenInclusive(start, end)
  if (pauseDays > 90) {
    return { valid: false, error: 'Maximum pause duration is 90 days' }
  }
  
  // Check for overlaps with existing pauses
  if (existingPauses) {
    for (const existing of existingPauses) {
      if (existing.status === 'CANCELLED') continue
      
      const existStart = new Date(Date.UTC(
        existing.startDate.getFullYear(),
        existing.startDate.getMonth(),
        existing.startDate.getDate()
      ))
      const existEnd = new Date(Date.UTC(
        existing.endDate.getFullYear(),
        existing.endDate.getMonth(),
        existing.endDate.getDate()
      ))
      
      // Check for overlap
      if (start <= existEnd && end >= existStart) {
        return { 
          valid: false, 
          error: `Overlaps with existing pause: ${formatShortDate(existing.startDate)} - ${formatShortDate(existing.endDate)}` 
        }
      }
    }
  }
  
  return { valid: true }
}

/**
 * Check if a date falls within a pause window
 */
export function isDatePaused(
  date: Date,
  pauses: { startDate: Date; endDate: Date; status: string }[]
): boolean {
  const check = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  
  for (const pause of pauses) {
    if (pause.status === 'CANCELLED') continue
    
    const start = new Date(Date.UTC(
      pause.startDate.getFullYear(),
      pause.startDate.getMonth(),
      pause.startDate.getDate()
    ))
    const end = new Date(Date.UTC(
      pause.endDate.getFullYear(),
      pause.endDate.getMonth(),
      pause.endDate.getDate()
    ))
    
    if (check >= start && check <= end) {
      return true
    }
  }
  
  return false
}

/**
 * Get all paused dates for a subscription in a given month
 * Returns array of day numbers (1-31)
 */
export function getPausedDaysInMonth(
  year: number,
  month: number, // 1-12
  pauses: { startDate: Date; endDate: Date; status: string }[]
): number[] {
  const pausedDays: number[] = []
  const daysInMonth = new Date(year, month, 0).getDate()
  
  for (let day = 1; day <= daysInMonth; day++) {
    const date = new Date(Date.UTC(year, month - 1, day))
    if (isDatePaused(date, pauses)) {
      pausedDays.push(day)
    }
  }
  
  return pausedDays
}

/**
 * Convert Prisma Decimal to number safely
 */
export function decimalToNumber(value: Decimal | number | null | undefined): number {
  if (value === null || value === undefined) return 0
  if (typeof value === 'number') return value
  return Number(value.toString())
}

/**
 * Calculate credit for a pause period, accounting for prorated first-month payments
 * 
 * This is the KEY function for accurate credit calculation:
 * - If pause is in the first billing period (prorated), use actual payment amount
 * - Otherwise, use monthly price
 * 
 * @param pauseStart - Start of pause
 * @param pauseEnd - End of pause
 * @param subscriptionStart - When subscription started (to detect first month)
 * @param firstBillingDate - When first full billing happens (usually 1st of next month)
 * @param proratedAmount - Actual amount paid for first period (if any)
 * @param monthlyPrice - Regular monthly price
 */
export interface ProratedCreditParams {
  pauseStart: Date
  pauseEnd: Date
  subscriptionStart: Date
  firstBillingDate: Date
  proratedAmount: number | null  // null if no prorated payment (e.g., started on 1st)
  monthlyPrice: number
}

export interface ProratedCreditResult {
  totalDays: number
  totalCredit: number
  totalCreditPence: number
  breakdown: {
    period: string
    daysInPeriod: number
    daysPaused: number
    amountPaidForPeriod: number
    dailyRate: number
    credit: number
  }[]
  description: string
}

export function calculateProratedCredit(params: ProratedCreditParams): ProratedCreditResult {
  const { 
    pauseStart, 
    pauseEnd, 
    subscriptionStart, 
    firstBillingDate, 
    proratedAmount, 
    monthlyPrice 
  } = params

  // Normalize all dates
  const pStart = new Date(Date.UTC(pauseStart.getFullYear(), pauseStart.getMonth(), pauseStart.getDate()))
  const pEnd = new Date(Date.UTC(pauseEnd.getFullYear(), pauseEnd.getMonth(), pauseEnd.getDate()))
  const subStart = new Date(Date.UTC(subscriptionStart.getFullYear(), subscriptionStart.getMonth(), subscriptionStart.getDate()))
  const firstBill = new Date(Date.UTC(firstBillingDate.getFullYear(), firstBillingDate.getMonth(), firstBillingDate.getDate()))

  const breakdown: ProratedCreditResult['breakdown'] = []
  let totalDays = 0
  let totalCredit = 0

  // Period 1: First billing period (prorated) - from subscription start to first billing date
  const firstPeriodEnd = new Date(firstBill)
  firstPeriodEnd.setUTCDate(firstPeriodEnd.getUTCDate() - 1) // Day before first billing

  // Check if pause overlaps with first period
  if (pStart <= firstPeriodEnd && pEnd >= subStart) {
    const overlapStart = pStart > subStart ? pStart : subStart
    const overlapEnd = pEnd < firstPeriodEnd ? pEnd : firstPeriodEnd
    
    if (overlapStart <= overlapEnd) {
      const daysInFirstPeriod = daysBetweenInclusive(subStart, firstPeriodEnd)
      const daysPausedInFirst = daysBetweenInclusive(overlapStart, overlapEnd)
      
      // Use prorated amount if available, otherwise calculate from monthly
      const amountForPeriod = proratedAmount !== null ? proratedAmount : (monthlyPrice * daysInFirstPeriod / getDaysInMonth(subStart))
      const dailyRate = amountForPeriod / daysInFirstPeriod
      const credit = daysPausedInFirst * dailyRate
      
      breakdown.push({
        period: `First period: ${formatShortDate(subStart)} - ${formatShortDate(firstPeriodEnd)}`,
        daysInPeriod: daysInFirstPeriod,
        daysPaused: daysPausedInFirst,
        amountPaidForPeriod: Math.round(amountForPeriod * 100) / 100,
        dailyRate: Math.round(dailyRate * 100) / 100,
        credit: Math.round(credit * 100) / 100
      })
      
      totalDays += daysPausedInFirst
      totalCredit += credit
    }
  }

  // Period 2+: Full billing months (use monthly price)
  let currentMonthStart = new Date(firstBill)
  
  while (currentMonthStart <= pEnd) {
    const year = currentMonthStart.getUTCFullYear()
    const month = currentMonthStart.getUTCMonth()
    const daysInMonth = getDaysInMonth(currentMonthStart)
    const monthEnd = new Date(Date.UTC(year, month, daysInMonth))
    
    // Check if pause overlaps with this month
    if (pStart <= monthEnd && pEnd >= currentMonthStart) {
      const overlapStart = pStart > currentMonthStart ? pStart : currentMonthStart
      const overlapEnd = pEnd < monthEnd ? pEnd : monthEnd
      
      if (overlapStart <= overlapEnd) {
        const daysPausedInMonth = daysBetweenInclusive(overlapStart, overlapEnd)
        const dailyRate = monthlyPrice / daysInMonth
        const credit = daysPausedInMonth * dailyRate
        
        breakdown.push({
          period: formatMonthYear(currentMonthStart),
          daysInPeriod: daysInMonth,
          daysPaused: daysPausedInMonth,
          amountPaidForPeriod: monthlyPrice,
          dailyRate: Math.round(dailyRate * 100) / 100,
          credit: Math.round(credit * 100) / 100
        })
        
        totalDays += daysPausedInMonth
        totalCredit += credit
      }
    }
    
    // Move to next month
    currentMonthStart = new Date(Date.UTC(year, month + 1, 1))
  }

  totalCredit = Math.round(totalCredit * 100) / 100

  const description = breakdown.length > 0
    ? `Pause credit: ${totalDays} days, £${totalCredit.toFixed(2)}`
    : 'No credit applicable'

  return {
    totalDays,
    totalCredit,
    totalCreditPence: Math.round(totalCredit * 100),
    breakdown,
    description
  }
}

/**
 * Smart settlement breakdown — separates full months (no charge) from partial months
 * and decides per partial month whether the next renewal should be CREDITED or
 * additionally CHARGED.
 *
 * Three kinds of months:
 * - Full month paused: Stripe pause_collection voided the invoice, nothing to do.
 * - Partial month, pause started AFTER day 1 ("creditable"): customer was charged the
 *   full month before pause took effect → credit the paused days against next renewal.
 * - Partial month, pause covered day 1 ("non-creditable"): Stripe voided the invoice
 *   for this month → customer was NOT charged. No credit. But the days between
 *   pause-end and the end of the month were used by the customer and never billed,
 *   so charge proration for `daysInMonth - pausedDaysInMonth` against next renewal.
 *
 * Example: April 15 → July 16, £50/month
 * - Apr: 16 days paused (15-30) out of 30 → creditable → credit £26.67
 * - May: 31/31 → full month → £0
 * - Jun: 30/30 → full month → £0
 * - Jul: 16 days paused (1-16) out of 31, non-creditable → charge for Jul 17-31 (15 days) = £24.19
 * - Net effect on next renewal: -26.67 + 24.19 = -£2.48
 */
export interface SettlementBreakdown {
  totalDays: number
  fullMonthsSkipped: string[] // ["May 2026", "Jun 2026"]
  partialMonths: PartialMonthSettlement[]
  totalSettlementAmount: number // Sum of creditable partial-month credits (positive £)
  totalSettlementPence: number // For Stripe (positive pence — applied as a NEGATIVE invoice item)
  totalChargeAmount: number // Sum of non-creditable post-resume charges (positive £)
  totalChargePence: number // For Stripe (positive pence — applied as a POSITIVE invoice item)
  description: string
}

export interface PartialMonthSettlement {
  month: string // "Apr 2026"
  year: number
  monthNumber: number
  pausedDays: number
  totalDaysInMonth: number
  creditAmount: number // £, only > 0 when creditable
  // True when the customer was charged for this month before pause_collection took
  // effect (pause started after day 1). False when the pause covered day 1 — Stripe
  // voided the invoice, so there is nothing to refund and the unpaused tail of the
  // month is unbilled time the customer used.
  creditable: boolean
  usedDays: number // days customer used after resume in this month (0 when creditable)
  chargeAmount: number // £, only > 0 when non-creditable and usedDays > 0
}

export function calculateSettlementBreakdown(period: PausePeriod): SettlementBreakdown {
  const { startDate, endDate, monthlyPrice } = period
  
  // Normalize dates to UTC midnight
  const start = new Date(Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate()))
  const end = new Date(Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate()))
  
  if (end < start) {
    throw new Error('End date must be after or equal to start date')
  }
  
  const fullMonthsSkipped: string[] = []
  const partialMonths: PartialMonthSettlement[] = []
  let totalDays = 0
  let totalSettlement = 0
  let totalCharge = 0

  // Iterate month by month
  let current = new Date(start)

  while (current <= end) {
    const year = current.getUTCFullYear()
    const monthNum = current.getUTCMonth()
    const daysInMonth = getDaysInMonth(current)
    const monthName = formatMonthYear(current)
    const shortMonthName = `${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][monthNum]} ${year}`

    // Calculate first and last day of this month
    const monthStart = new Date(Date.UTC(year, monthNum, 1))
    const monthEnd = new Date(Date.UTC(year, monthNum, daysInMonth))

    // Calculate overlap of pause window with this month
    const overlapStart = start > monthStart ? start : monthStart
    const overlapEnd = end < monthEnd ? end : monthEnd
    const pausedDaysInMonth = daysBetweenInclusive(overlapStart, overlapEnd)

    totalDays += pausedDaysInMonth

    if (pausedDaysInMonth === daysInMonth) {
      // Full month paused - no charge, skip billing
      fullMonthsSkipped.push(shortMonthName)
    } else if (pausedDaysInMonth > 0) {
      // Partial month. Two flavours:
      //  - "creditable": pause started AFTER day 1 → Stripe billed the full month
      //    before pause_collection took effect. Refund the paused days.
      //  - "non-creditable": pause covered day 1 → Stripe voided the month's
      //    invoice, customer was not charged. The days between pause-end and the
      //    end of the month are days the customer used but was never billed for,
      //    so charge proration on those days against the next renewal.
      const customerWasCharged = overlapStart.getTime() > monthStart.getTime()
      const dailyRate = monthlyPrice / daysInMonth
      const credit = pausedDaysInMonth * dailyRate
      const roundedCredit = Math.round(credit * 100) / 100
      const usedDays = customerWasCharged ? 0 : (daysInMonth - pausedDaysInMonth)
      const charge = usedDays * dailyRate
      const roundedCharge = Math.round(charge * 100) / 100

      partialMonths.push({
        month: shortMonthName,
        year,
        monthNumber: monthNum + 1,
        pausedDays: pausedDaysInMonth,
        totalDaysInMonth: daysInMonth,
        creditAmount: customerWasCharged ? roundedCredit : 0,
        creditable: customerWasCharged,
        usedDays,
        chargeAmount: customerWasCharged ? 0 : roundedCharge
      })

      if (customerWasCharged) {
        totalSettlement += roundedCredit
      } else if (usedDays > 0) {
        totalCharge += roundedCharge
      }
    }

    // Move to first day of next month
    current = new Date(Date.UTC(year, monthNum + 1, 1))
  }

  totalSettlement = Math.round(totalSettlement * 100) / 100
  totalCharge = Math.round(totalCharge * 100) / 100
  
  // Generate description
  const parts: string[] = []
  if (fullMonthsSkipped.length > 0) parts.push(`${fullMonthsSkipped.length} full month(s) voided`)
  if (totalSettlement > 0) parts.push(`credit £${totalSettlement.toFixed(2)}`)
  if (totalCharge > 0) parts.push(`post-resume charge £${totalCharge.toFixed(2)}`)
  const description = parts.length > 0 ? parts.join(', ') : 'No pause days calculated'

  return {
    totalDays,
    fullMonthsSkipped,
    partialMonths,
    totalSettlementAmount: totalSettlement,
    totalSettlementPence: Math.round(totalSettlement * 100),
    totalChargeAmount: totalCharge,
    totalChargePence: Math.round(totalCharge * 100),
    description
  }
}

