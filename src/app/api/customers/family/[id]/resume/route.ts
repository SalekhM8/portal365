import { NextRequest, NextResponse } from 'next/server'

// Pausing and resuming are handled by the gym (desk/admin only). The desk resume
// path charges the prorated remainder of the month on the day; this parent-facing
// path resumed with proration_behavior 'none' (free) and is disabled for the same
// reason parent self-pause was.
export async function POST(
  _request: NextRequest,
  _context: { params: Promise<{ id: string }> }
) {
  return NextResponse.json({
    error: 'Resuming is handled by the gym — please message us or speak to the desk and we\'ll sort it.'
  }, { status: 403 })
}
