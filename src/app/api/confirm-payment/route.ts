import { NextRequest, NextResponse } from 'next/server'
import { handleSetupIntentConfirmation, handlePaymentIntentConfirmation } from './handlers'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    if (body.setupIntentId) {
      return await handleSetupIntentConfirmation(body)
    } else if (body.paymentIntentId) {
      return await handlePaymentIntentConfirmation(body)
    } else {
      return NextResponse.json({ success: false, error: 'Missing setupIntentId or paymentIntentId' }, { status: 400 })
    }
  } catch (error) {
    return NextResponse.json({ success: false, error: 'Confirmation failed' }, { status: 500 })
  }
} 