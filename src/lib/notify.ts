import { prisma } from '@/lib/prisma'

type SmsSendResult = { success: boolean; sid?: string; error?: string }

function getEnv(name: string): string | undefined {
  return process.env[name]
}

function isSmsEnabled(): boolean {
  return process.env.DUNNING_SMS_ENABLED === 'true'
}

async function sendTwilioSms(to: string, body: string): Promise<SmsSendResult> {
  const sid = getEnv('TWILIO_ACCOUNT_SID')
  const token = getEnv('TWILIO_AUTH_TOKEN')
  const from = getEnv('TWILIO_FROM_NUMBER')

  if (!sid || !token || !from) {
    console.warn('SMS disabled or Twilio env not set. Skipping SMS to', to)
    return { success: false, error: 'twilio_env_missing' }
  }

  try {
    const params = new URLSearchParams({ From: from, To: to, Body: body })
    const resp = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params
    })
    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      console.error('Twilio SMS failed', resp.status, text)
      return { success: false, error: `http_${resp.status}` }
    }
    const json = await resp.json().catch(() => ({} as any))
    return { success: true, sid: json.sid }
  } catch (e: any) {
    console.error('Twilio SMS error', e)
    return { success: false, error: e?.message || 'unknown' }
  }
}

async function recordIdempotentDunningKey(key: string): Promise<boolean> {
  // Returns true when newly recorded; false when already exists
  try {
    await prisma.systemSetting.create({ data: { key, value: '1', description: 'dunning-sms', category: 'dunning' } })
    return true
  } catch {
    return false
  }
}

export async function sendDunningAttemptSms(opts: {
  userPhone?: string | null
  attempt: number
  totalAttempts: number
  nextRetryDateISO?: string | null
  managePaymentUrl: string
  invoiceId: string
}): Promise<void> {
  if (!isSmsEnabled()) return
  if (!opts.userPhone) return

  const key = `dunning_sms:${opts.invoiceId}:${opts.attempt}`
  const isNew = await recordIdempotentDunningKey(key)
  if (!isNew) return

  const nextDay = opts.nextRetryDateISO ? new Date(opts.nextRetryDateISO).toLocaleDateString('en-GB') : 'tomorrow'
  const body = `Aura MMA: Payment failed (attempt ${opts.attempt}/${opts.totalAttempts}). We will retry on ${nextDay}. Update card: ${opts.managePaymentUrl}`
  await sendTwilioSms(opts.userPhone, body)
}

export async function sendSuspendedSms(opts: {
  userPhone?: string | null
  managePaymentUrl: string
  invoiceId: string
}): Promise<void> {
  if (!isSmsEnabled()) return
  if (!opts.userPhone) return

  const key = `dunning_sms:suspended:${opts.invoiceId}`
  const isNew = await recordIdempotentDunningKey(key)
  if (!isNew) return

  const body = `Aura MMA: Payment failed 3/3. Access suspended. £25 admin fee due at reception. Update card to restore access: ${opts.managePaymentUrl}`
  await sendTwilioSms(opts.userPhone, body)
}

export async function sendSuccessSms(opts: { userPhone?: string | null }): Promise<void> {
  if (!isSmsEnabled()) return
  if (!opts.userPhone) return
  const body = `Aura MMA: Payment received. Your access has been restored.`
  await sendTwilioSms(opts.userPhone, body)
}

export async function sendActionRequiredSms(opts: {
  userPhone?: string | null
  hostedInvoiceUrl?: string | null
  managePaymentUrl: string
  invoiceId: string
  attempt: number
  totalAttempts: number
}): Promise<void> {
  if (!isSmsEnabled()) return
  if (!opts.userPhone) return

  const key = `dunning_sms:action_required:${opts.invoiceId}:${opts.attempt}`
  const isNew = await recordIdempotentDunningKey(key)
  if (!isNew) return

  const url = opts.hostedInvoiceUrl || opts.managePaymentUrl
  const body = `Aura MMA: Payment needs authentication (attempt ${opts.attempt}/${opts.totalAttempts}). Complete here: ${url}`
  await sendTwilioSms(opts.userPhone, body)
}





