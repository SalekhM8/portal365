import nodemailer from 'nodemailer'
import fs from 'fs'
import path from 'path'
import { prisma } from '@/lib/prisma'

function get(name: string): string | undefined { return process.env[name] }

export function isDunningEmailEnabled(): boolean {
  return process.env.DUNNING_EMAIL_ENABLED === 'true'
}

export function getEmailAttemptSet(): Set<number> {
  const raw = get('EMAIL_ON_ATTEMPTS') || '1,2,3'
  const set = new Set<number>()
  for (const p of raw.split(',').map(s => s.trim()).filter(Boolean)) {
    const n = Number(p)
    if (!Number.isNaN(n)) set.add(n)
  }
  return set.size ? set : new Set([1, 2, 3])
}

function transporter() {
  const host = get('SMTP_HOST')
  const port = Number(get('SMTP_PORT') || '587')
  const user = get('SMTP_USER')
  const pass = get('SMTP_PASS')
  if (!host || !user || !pass) throw new Error('SMTP env missing')
  return nodemailer.createTransport({ host, port, secure: port === 465, auth: { user, pass } })
}

function getBaseUrl(): string {
  return (get('NEXT_PUBLIC_BASE_URL') || get('FRONTEND_BASE_URL') || get('NEXTAUTH_URL') || '').replace(/\/$/, '')
}

function isHttpUrl(url?: string | null): boolean {
  if (!url) return false
  return /^https?:\/\//i.test(url)
}

function getLogoUrlFallback(): string {
  const configuredLogo = get('EMAIL_LOGO_URL')
  const base = getBaseUrl()
  return configuredLogo || `${base || ''}/images/auralogo.png`
}

function renderHtml(opts: { title: string; paragraphs: string[]; ctaLabel?: string; ctaUrl?: string }): string {
  const configuredLogo = get('EMAIL_LOGO_URL')
  const logoSrc = isHttpUrl(configuredLogo) ? (configuredLogo as string) : 'cid:auralogo'
  const pHtml = opts.paragraphs.map(p => `<p style="margin:0 0 12px;color:#111;font-size:15px;line-height:22px">${p}</p>`).join('')
  const btn = opts.ctaLabel && opts.ctaUrl
    ? `<div style="margin:16px 0"><a href="${opts.ctaUrl}" style="background:#111;color:#fff;padding:10px 14px;border-radius:8px;text-decoration:none;display:inline-block">${opts.ctaLabel}</a></div>`
    : ''
  return `<!doctype html><html><body style="margin:0;padding:0;background:#f6f7f9">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
  <table role="presentation" width="620" cellspacing="0" cellpadding="0" style="background:#fff;margin:20px;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.06)">
    <tr><td style="padding:24px 28px">
      <h2 style="margin:0 0 12px;color:#111;font-size:20px">${opts.title}</h2>
      ${pHtml}
      ${btn}
      <p style="margin:16px 0 0;color:#111;font-size:15px;line-height:22px">Thank you,<br/>Aura MMA</p>
      <p style="margin:6px 0 0;color:#555;font-size:13px">Questions? Call 07825 443 999</p>
    </td></tr>
    <tr><td style="padding:12px 28px 24px" align="center">
      <img src="${logoSrc}" alt="Aura MMA" width="96" height="96" style="opacity:.8"/>
    </td></tr>
  </table>
  </td></tr></table>
  </body></html>`
}

async function sendMail(to: string, subject: string, text: string, html?: string) {
  const from = get('SMTP_FROM') || 'Portal365 <no-reply@portal365>'
  const t = transporter()
  let finalHtml = html
  const attachments: Array<{ filename: string; path: string; cid: string }> = []
  if (finalHtml && finalHtml.includes('cid:auralogo')) {
    const logoPath = path.join(process.cwd(), 'public', 'images', 'auralogo.png')
    if (fs.existsSync(logoPath)) {
      attachments.push({ filename: 'auralogo.png', path: logoPath, cid: 'auralogo' })
    } else {
      // Fallback to URL if file missing (e.g., unusual deploy env)
      const fallbackUrl = getLogoUrlFallback()
      finalHtml = finalHtml.replace(/cid:auralogo/g, fallbackUrl)
    }
  }
  await t.sendMail({ from, to, subject, text, html: finalHtml, attachments })
}

async function once(key: string): Promise<boolean> {
  try {
    await prisma.systemSetting.create({ data: { key, value: '1', category: 'email-dunning' } })
    return true
  } catch {
    return false
  }
}

export async function sendDunningAttemptEmail(opts: {
  to?: string | null
  attempt: number
  total: number
  nextRetryISO?: string | null
  manageUrl: string
  hostedUrl?: string | null
  invoiceId: string
}): Promise<void> {
  if (!isDunningEmailEnabled() || !opts.to) return
  const allow = getEmailAttemptSet().has(opts.attempt)
  if (!allow) return
  const key = `email:dunning:${opts.invoiceId}:${opts.attempt}`
  if (!(await once(key))) return
  const next = opts.nextRetryISO ? new Date(opts.nextRetryISO).toLocaleDateString('en-GB') : 'tomorrow'
  const subject = `Payment failed (${opts.attempt}/${opts.total})`
  const text = `Hi,\n\nYour membership payment failed (attempt ${opts.attempt}/${opts.total}). We'll retry on ${next}.\n\nPlease update your card here: ${opts.manageUrl}\n\nIf you have questions, call 07825 443 999.\n\nThank you,\nAura MMA`
  // Prefer hosted invoice link when available so the member can pay/3DS without logging in
  const link = opts.hostedUrl || opts.manageUrl
  const html = renderHtml({
    title: 'Payment attempt failed',
    paragraphs: [
      `We couldn’t process your membership payment (attempt ${opts.attempt} of ${opts.total}).`,
      `We’ll try again on ${next}. To avoid service interruption, please complete payment or update your card now.`,
    ],
    ctaLabel: 'Resolve payment',
    ctaUrl: link
  })
  await sendMail(opts.to, subject, text, html)
}

export async function sendSuspendedEmail(opts: { to?: string | null; manageUrl: string; invoiceId: string }): Promise<void> {
  if (!isDunningEmailEnabled() || !opts.to) return
  const key = `email:suspended:${opts.invoiceId}`
  if (!(await once(key))) return
  const subject = 'Membership suspended after payment retries'
  const text = `Hi,\n\nYour membership payment failed after 3 retries and access has been suspended.\n\nUpdate your card to restore access: ${opts.manageUrl}\n\nIf you need help, call 07825 443 999.\n\nThank you,\nAura MMA`
  const html = renderHtml({
    title: 'Membership suspended',
    paragraphs: [
      'We weren’t able to collect your membership payment after three attempts, so your access is currently suspended.',
      'Please update your card. As soon as the payment succeeds, your access will be restored automatically.'
    ],
    ctaLabel: 'Update payment method',
    ctaUrl: opts.manageUrl
  })
  await sendMail(opts.to, subject, text, html)
}

export async function sendActionRequiredEmail(opts: { to?: string | null; hostedUrl?: string | null; manageUrl: string; invoiceId: string; attempt: number }): Promise<void> {
  if (!isDunningEmailEnabled() || !opts.to) return
  const allow = getEmailAttemptSet().has(opts.attempt)
  if (!allow) return
  const key = `email:action_required:${opts.invoiceId}:${opts.attempt}`
  if (!(await once(key))) return
  const link = opts.hostedUrl || opts.manageUrl
  const subject = 'Action required to complete your payment'
  const text = `Hi,\n\nYour bank/wallet needs you to authenticate this payment. Please complete it here: ${link}\n\nIf you have questions, call 07825 443 999.\n\nThank you,\nAura MMA`
  const html = renderHtml({
    title: 'Action required to complete your payment',
    paragraphs: [
      'Your bank or wallet is asking you to verify this charge.',
      'Tap the button below to securely complete authentication.'
    ],
    ctaLabel: 'Complete authentication',
    ctaUrl: link || opts.manageUrl
  })
  await sendMail(opts.to, subject, text, html)
}

export async function sendSuccessEmail(opts: { to?: string | null }): Promise<void> {
  if (!isDunningEmailEnabled() || !opts.to) return
  try {
    const subject = 'Payment received – access restored'
    const text = `Hi,\n\nWe’ve received your payment and your access is now active.\n\nThank you,\nAura MMA`
    const html = renderHtml({
      title: 'Payment received',
      paragraphs: [
        'Thanks for updating your details – your payment succeeded.',
        'Your membership is active again.'
      ]
    })
    await sendMail(opts.to, subject, text, html)
  } catch {}
}


