"use client"

import * as React from "react"
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon, X, Pause, Play, Trash2, AlertCircle, CheckCircle } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

interface PauseWindow {
  id: string
  startDate: string
  endDate: string
  pausedDays: number
  creditAmount: number
  status: string
  reason?: string
  createdBy?: string
  createdAt: string
}

interface PauseCalendarProps {
  customerId: string
  customerName: string
  monthlyPrice: number
  membershipType: string
  isOpen: boolean
  onClose: () => void
  onPauseCreated?: () => void
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate()
}

function getFirstDayOfMonth(year: number, month: number): number {
  const day = new Date(year, month, 1).getDay()
  return day === 0 ? 6 : day - 1
}

function formatDate(date: Date): string {
  return date.toISOString().split('T')[0]
}

function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00Z')
}

function formatShortDate(date: Date): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
  return `${months[date.getMonth()]} ${date.getDate()}, ${date.getFullYear()}`
}

function isDateInRange(date: Date, start: Date, end: Date): boolean {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()))
  const s = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()))
  const e = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()))
  return d >= s && d <= e
}

function calculateDaysBetween(start: Date, end: Date): number {
  const s = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()))
  const e = new Date(Date.UTC(end.getFullYear(), end.getMonth(), end.getDate()))
  return Math.floor((e.getTime() - s.getTime()) / (1000 * 60 * 60 * 24)) + 1
}

function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && 
         a.getMonth() === b.getMonth() && 
         a.getDate() === b.getDate()
}

export function PauseCalendar({
  customerId,
  customerName,
  monthlyPrice,
  membershipType,
  isOpen,
  onClose,
  onPauseCreated
}: PauseCalendarProps) {
  const today = new Date()
  const [currentMonth, setCurrentMonth] = React.useState(today.getMonth())
  const [currentYear, setCurrentYear] = React.useState(today.getFullYear())
  
  // Two-click selection state
  const [startDate, setStartDate] = React.useState<Date | null>(null)
  const [endDate, setEndDate] = React.useState<Date | null>(null)
  const [selectingEnd, setSelectingEnd] = React.useState(false)
  
  // Existing pauses
  const [pauseWindows, setPauseWindows] = React.useState<PauseWindow[]>([])
  const [loading, setLoading] = React.useState(false)
  const [saving, setSaving] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [success, setSuccess] = React.useState<string | null>(null)
  
  // Pause reason
  const [reason, setReason] = React.useState('')

  // Load existing pause windows
  React.useEffect(() => {
    if (isOpen && customerId) {
      loadPauseWindows()
    }
  }, [isOpen, customerId])

  async function loadPauseWindows() {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/pause-windows`)
      const data = await res.json()
      if (data.success) {
        setPauseWindows(data.pauseWindows || [])
      } else {
        setError(data.error || 'Failed to load pause windows')
      }
    } catch (e) {
      setError('Failed to load pause windows')
    } finally {
      setLoading(false)
    }
  }

  // Calculate pause breakdown - full months skipped vs partial month settlement
  const pauseBreakdown = React.useMemo(() => {
    if (!startDate || !endDate) return null
    
    // Sort dates so start is always before end
    const [actualStart, actualEnd] = startDate <= endDate 
      ? [startDate, endDate] 
      : [endDate, startDate]
    
    const totalDays = calculateDaysBetween(actualStart, actualEnd)
    
    // Calculate which full billing months are covered
    // Assuming billing on 1st of each month
    const fullMonthsSkipped: string[] = []
    const partialMonths: { month: string; days: number; totalDays: number; credit: number }[] = []
    
    let currentDate = new Date(actualStart)
    
    while (currentDate <= actualEnd) {
      const year = currentDate.getFullYear()
      const month = currentDate.getMonth()
      const firstOfMonth = new Date(year, month, 1)
      const lastOfMonth = new Date(year, month + 1, 0)
      const daysInMonth = lastOfMonth.getDate()
      const monthName = MONTHS[month].slice(0, 3) + ' ' + year
      
      // Calculate overlap of pause window with this month
      const overlapStart = currentDate > firstOfMonth ? currentDate : firstOfMonth
      const overlapEnd = actualEnd < lastOfMonth ? actualEnd : lastOfMonth
      const daysInPause = calculateDaysBetween(overlapStart, overlapEnd)
      
      if (daysInPause === daysInMonth) {
        // Full month covered
        fullMonthsSkipped.push(monthName)
      } else if (daysInPause > 0) {
        // Partial month - needs settlement
        const dailyRate = monthlyPrice / daysInMonth
        const credit = daysInPause * dailyRate
        partialMonths.push({
          month: monthName,
          days: daysInPause,
          totalDays: daysInMonth,
          credit: Math.round(credit * 100) / 100
        })
      }
      
      // Move to first of next month
      currentDate = new Date(year, month + 1, 1)
    }
    
    // Total settlement is ONLY for partial months
    const totalSettlement = partialMonths.reduce((sum, p) => sum + p.credit, 0)
    
    return {
      totalDays,
      startDate: actualStart,
      endDate: actualEnd,
      fullMonthsSkipped,
      partialMonths,
      totalSettlement: Math.round(totalSettlement * 100) / 100
    }
  }, [startDate, endDate, monthlyPrice])

  // Navigation
  function prevMonth() {
    if (currentMonth === 0) {
      setCurrentMonth(11)
      setCurrentYear(y => y - 1)
    } else {
      setCurrentMonth(m => m - 1)
    }
  }

  function nextMonth() {
    if (currentMonth === 11) {
      setCurrentMonth(0)
      setCurrentYear(y => y + 1)
    } else {
      setCurrentMonth(m => m + 1)
    }
  }

  // Date click handler - two-click selection
  function handleDayClick(date: Date) {
    const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
    if (date < todayStart) return
    if (isDatePaused(date)) return
    
    setError(null)
    setSuccess(null)
    
    if (!selectingEnd) {
      // First click - set start date
      setStartDate(date)
      setEndDate(null)
      setSelectingEnd(true)
    } else {
      // Second click - set end date
      setEndDate(date)
      setSelectingEnd(false)
    }
  }

  function clearSelection() {
    setStartDate(null)
    setEndDate(null)
    setSelectingEnd(false)
    setReason('')
    setError(null)
    setSuccess(null)
  }

  // Check if date is already paused
  function isDatePaused(date: Date): boolean {
    for (const pw of pauseWindows) {
      if (pw.status === 'CANCELLED') continue
      const start = parseDate(pw.startDate.split('T')[0])
      const end = parseDate(pw.endDate.split('T')[0])
      if (isDateInRange(date, start, end)) return true
    }
    return false
  }

  // Check if date is in current selection
  function isDateSelected(date: Date): boolean {
    if (!startDate) return false
    if (!endDate) return isSameDay(date, startDate)
    
    const [actualStart, actualEnd] = startDate <= endDate 
      ? [startDate, endDate] 
      : [endDate, startDate]
    
    return isDateInRange(date, actualStart, actualEnd)
  }

  function isStartDate(date: Date): boolean {
    if (!startDate) return false
    if (!endDate) return isSameDay(date, startDate)
    const actualStart = startDate <= endDate ? startDate : endDate
    return isSameDay(date, actualStart)
  }

  function isEndDate(date: Date): boolean {
    if (!endDate) return false
    const actualEnd = startDate && startDate <= endDate ? endDate : startDate!
    return isSameDay(date, actualEnd)
  }

  // Create pause
  async function handleCreatePause() {
    if (!pauseBreakdown) return
    
    setSaving(true)
    setError(null)
    
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/pause-windows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startDate: formatDate(pauseBreakdown.startDate),
          endDate: formatDate(pauseBreakdown.endDate),
          reason: reason || undefined,
          // Send breakdown info for smarter handling
          fullMonthsSkipped: pauseBreakdown.fullMonthsSkipped,
          partialMonths: pauseBreakdown.partialMonths,
          settlementAmount: pauseBreakdown.totalSettlement
        })
      })
      
      const data = await res.json()
      
      if (data.success) {
        const hasSettlement = pauseBreakdown.totalSettlement > 0
        const msg = hasSettlement 
          ? `Pause scheduled! Settlement of £${pauseBreakdown.totalSettlement.toFixed(2)} will apply.`
          : `Pause scheduled! ${pauseBreakdown.fullMonthsSkipped.length} billing month(s) will be skipped.`
        setSuccess(msg)
        clearSelection()
        await loadPauseWindows()
        onPauseCreated?.()
      } else {
        setError(data.error || 'Failed to create pause')
      }
    } catch (e) {
      setError('Failed to create pause')
    } finally {
      setSaving(false)
    }
  }

  // Cancel pause
  async function handleCancelPause(windowId: string) {
    try {
      const res = await fetch(`/api/admin/customers/${customerId}/pause-windows?windowId=${windowId}`, {
        method: 'DELETE'
      })
      
      const data = await res.json()
      
      if (data.success) {
        setSuccess('Pause cancelled successfully')
        await loadPauseWindows()
        onPauseCreated?.()
      } else {
        setError(data.error || 'Failed to cancel pause')
      }
    } catch (e) {
      setError('Failed to cancel pause')
    }
  }

  // Render calendar grid
  function renderCalendar() {
    const daysInMonth = getDaysInMonth(currentYear, currentMonth)
    const firstDay = getFirstDayOfMonth(currentYear, currentMonth)
    const days: React.ReactNode[] = []
    
    // Empty cells for days before the 1st
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="aspect-square" />)
    }
    
    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const date = new Date(currentYear, currentMonth, day)
      const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate())
      const isPast = date < todayStart
      const isToday = date.getTime() === todayStart.getTime()
      const isPaused = isDatePaused(date)
      const isSelected = isDateSelected(date)
      const isStart = isStartDate(date)
      const isEnd = isEndDate(date)
      const isMid = isSelected && !isStart && !isEnd
      
      days.push(
        <button
          key={day}
          onClick={() => handleDayClick(date)}
          disabled={isPast || isPaused}
          className={cn(
            "aspect-square flex items-center justify-center text-sm font-medium rounded-lg transition-all duration-150 relative",
            isPast && "text-white/20 cursor-not-allowed",
            isToday && !isSelected && !isPaused && "ring-2 ring-red-500/50",
            isPaused && "bg-amber-500/20 text-amber-400 cursor-not-allowed",
            // Selection styling
            isStart && "bg-red-500 text-white rounded-l-lg rounded-r-none",
            isEnd && "bg-red-500 text-white rounded-r-lg rounded-l-none",
            isStart && isEnd && "rounded-lg", // Single day selection
            isMid && "bg-red-500/30 text-white rounded-none",
            !isPast && !isPaused && !isSelected && "hover:bg-white/10 text-white/90 cursor-pointer"
          )}
        >
          {day}
          {isPaused && (
            <Pause className="absolute w-2.5 h-2.5 text-amber-400/60 top-0.5 right-0.5" />
          )}
        </button>
      )
    }
    
    return days
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl p-0">
        <div className="p-6 pb-0">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <CalendarIcon className="w-5 h-5 text-red-500" />
              Schedule Pause
            </DialogTitle>
            <DialogDescription className="text-white/60">
              {customerName} • {membershipType} • £{monthlyPrice.toFixed(2)}/month
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="px-6 py-4 space-y-4">
          {/* Instructions */}
          <div className={cn(
            "p-3 rounded-lg border text-sm",
            selectingEnd 
              ? "bg-red-500/10 border-red-500/30 text-red-300" 
              : "bg-white/5 border-white/10 text-white/70"
          )}>
            {selectingEnd ? (
              <span className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                Now click the <strong>end date</strong> (navigate months with arrows)
              </span>
            ) : startDate && endDate ? (
              <span>✅ Selection complete! Review below and apply.</span>
            ) : (
              <span>👆 Click a date to set the <strong>start date</strong></span>
            )}
          </div>

          {/* Error/Success messages */}
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}
          {success && (
            <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-sm">
              <CheckCircle className="w-4 h-4 shrink-0" />
              {success}
            </div>
          )}

          {/* Calendar */}
          <div className="bg-white/5 rounded-xl p-4 border border-white/10">
            {/* Month navigation */}
            <div className="flex items-center justify-between mb-4">
              <Button
                variant="ghost"
                size="icon"
                onClick={prevMonth}
                className="hover:bg-white/10 h-9 w-9"
              >
                <ChevronLeft className="w-5 h-5" />
              </Button>
              <h3 className="text-lg font-semibold">
                {MONTHS[currentMonth]} {currentYear}
              </h3>
              <Button
                variant="ghost"
                size="icon"
                onClick={nextMonth}
                className="hover:bg-white/10 h-9 w-9"
              >
                <ChevronRight className="w-5 h-5" />
              </Button>
            </div>

            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-1 mb-2">
              {WEEKDAYS.map(day => (
                <div key={day} className="text-center text-xs font-medium text-white/50 py-1">
                  {day}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-1">
              {loading ? (
                <div className="col-span-7 py-8 text-center text-white/50">
                  Loading...
                </div>
              ) : (
                renderCalendar()
              )}
            </div>

            {/* Legend */}
            <div className="flex flex-wrap items-center gap-3 mt-4 pt-3 border-t border-white/10 text-xs text-white/50">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-red-500" />
                <span>Selected</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded bg-amber-500/30" />
                <span>Paused</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-3 rounded ring-2 ring-red-500/50" />
                <span>Today</span>
              </div>
            </div>
          </div>

          {/* Selection preview */}
          {pauseBreakdown && (
            <div className="bg-gradient-to-r from-red-500/10 to-orange-500/10 rounded-xl p-4 border border-red-500/20 space-y-3">
              {/* Header with dates */}
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h4 className="font-semibold text-white mb-1">
                    📅 {formatShortDate(pauseBreakdown.startDate)} → {formatShortDate(pauseBreakdown.endDate)}
                  </h4>
                  <p className="text-sm text-white/60">
                    {pauseBreakdown.totalDays} days total
                  </p>
                </div>
              </div>

              {/* Full months - NO CHARGE */}
              {pauseBreakdown.fullMonthsSkipped.length > 0 && (
                <div className="bg-green-500/10 border border-green-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-green-400 font-medium text-sm mb-1">
                    <CheckCircle className="w-4 h-4" />
                    Billing Skipped (No Charge)
                  </div>
                  <p className="text-white text-sm">
                    {pauseBreakdown.fullMonthsSkipped.join(', ')}
                  </p>
                </div>
              )}

              {/* Partial months - SETTLEMENT */}
              {pauseBreakdown.partialMonths.length > 0 && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                  <div className="flex items-center gap-2 text-amber-400 font-medium text-sm mb-2">
                    <AlertCircle className="w-4 h-4" />
                    Settlement (Partial Months)
                  </div>
                  <div className="space-y-1">
                    {pauseBreakdown.partialMonths.map((pm, idx) => (
                      <div key={idx} className="flex justify-between text-sm">
                        <span className="text-white/80">
                          {pm.month}: {pm.days}/{pm.totalDays} days
                        </span>
                        <span className="text-green-400 font-medium">
                          -£{pm.credit.toFixed(2)}
                        </span>
                      </div>
                    ))}
                  </div>
                  {pauseBreakdown.totalSettlement > 0 && (
                    <div className="flex justify-between text-sm mt-2 pt-2 border-t border-white/10">
                      <span className="text-white font-medium">Total Credit</span>
                      <span className="text-green-400 font-bold">
                        -£{pauseBreakdown.totalSettlement.toFixed(2)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* No settlement needed message */}
              {pauseBreakdown.partialMonths.length === 0 && pauseBreakdown.fullMonthsSkipped.length > 0 && (
                <p className="text-xs text-white/50 text-center">
                  ✨ No settlement needed - entire months will be skipped
                </p>
              )}

              {/* Reason input */}
              <input
                type="text"
                placeholder="Reason for pause (optional)"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-sm text-white placeholder-white/30 focus:outline-none focus:ring-2 focus:ring-red-500/50"
              />

              {/* Action buttons */}
              <div className="flex gap-2">
                <Button
                  variant="ghost"
                  onClick={clearSelection}
                  className="flex-1 text-white/70 hover:bg-white/10"
                >
                  <X className="w-4 h-4 mr-1" />
                  Clear
                </Button>
                <Button
                  onClick={handleCreatePause}
                  disabled={saving}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white"
                >
                  {saving ? 'Saving...' : 'Apply Pause'}
                </Button>
              </div>
            </div>
          )}

          {/* Existing pauses */}
          {pauseWindows.filter(pw => pw.status !== 'CANCELLED').length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm font-medium text-white/70">Scheduled Pauses</h4>
              <div className="space-y-2 max-h-40 overflow-y-auto">
                {pauseWindows
                  .filter(pw => pw.status !== 'CANCELLED')
                  .map(pw => (
                    <div
                      key={pw.id}
                      className="flex items-center justify-between p-3 bg-white/5 rounded-lg border border-white/10"
                    >
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "w-8 h-8 rounded-full flex items-center justify-center shrink-0",
                          pw.status === 'SCHEDULED' && "bg-amber-500/20",
                          pw.status === 'CREDIT_APPLIED' && "bg-green-500/20"
                        )}>
                          {pw.status === 'SCHEDULED' && <Pause className="w-4 h-4 text-amber-400" />}
                          {pw.status === 'CREDIT_APPLIED' && <CheckCircle className="w-4 h-4 text-green-400" />}
                        </div>
                        <div>
                          <div className="text-sm font-medium text-white">
                            {formatShortDate(parseDate(pw.startDate.split('T')[0]))} → {formatShortDate(parseDate(pw.endDate.split('T')[0]))}
                          </div>
                          <div className="text-xs text-white/50">
                            {pw.pausedDays} days • -£{pw.creditAmount?.toFixed(2) || '0.00'}
                            {pw.status === 'CREDIT_APPLIED' && ' ✓ applied'}
                          </div>
                        </div>
                      </div>
                      {pw.status === 'SCHEDULED' && (
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleCancelPause(pw.id)}
                          className="text-red-400 hover:text-red-300 hover:bg-red-500/10 h-8 w-8"
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-white/10 bg-white/5">
          <Button
            variant="ghost"
            onClick={() => {
              clearSelection()
              onClose()
            }}
            className="w-full text-white/70 hover:bg-white/10"
          >
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
