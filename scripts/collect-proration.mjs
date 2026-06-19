// Phase 3: collect owed prorations from named people. DRY-RUN by default; --apply charges.
// Hardened: idempotency key (cannot double-charge), verify paid, write Payment row only if paid.
import dotenv from 'dotenv'
dotenv.config({ path: '.env.vercel', override: true })
const Stripe=(await import('stripe')).default
const { PrismaClient } = await import('@prisma/client')
const prisma=new PrismaClient()
const APPLY=process.argv.includes('--apply')
const keys={SU:process.env.STRIPE_SECRET_KEY,IQ:process.env.STRIPE_IQ_SECRET_KEY,AURA:process.env.STRIPE_AURA_SECRET_KEY,AURAUP:process.env.STRIPE_AURAUP_SECRET_KEY,AFC:process.env.STRIPE_AFC_SECRET_KEY}
const cli=Object.fromEntries(Object.entries(keys).filter(([,v])=>v).map(([k,v])=>[k,new Stripe(v)]))

// EXACT sub IDs (not name-matching). Fill/trim once user names the people.
const PEOPLE=[
  { subId:'cmp3yx6y20004lg04puly117y', amountGBP:16.00, reason:'upgrade Kids4-6 (GBP25) -> KIDS_UNLIMITED (GBP55) on 15 Jun, mid-month diff (Ayaan Hussain)' },
]

async function chargeProration(stripe, customerId, amountPence, description, metadata, ik){
  await stripe.invoiceItems.create({ customer:customerId, amount:amountPence, currency:'gbp', description, metadata }, { idempotencyKey:`${ik}:ii` })
  const inv = await stripe.invoices.create({ customer:customerId, collection_method:'charge_automatically', auto_advance:false, pending_invoice_items_behavior:'include', description, metadata }, { idempotencyKey:`${ik}:inv` })
  const finalized = await stripe.invoices.finalizeInvoice(inv.id)
  let paid
  try { paid = await stripe.invoices.pay(finalized.id) } catch(e){ return { paid:false, invoiceId:finalized.id, error:e?.raw?.message||e.message } }
  return { paid: paid.status==='paid', invoiceId:finalized.id, amountPaid:(paid.amount_paid||0)/100 }
}

console.log(`MODE: ${APPLY?'APPLY (CHARGES CARDS)':'DRY-RUN (no charge)'}\n`)
for(const p of PEOPLE){
  const sub=await prisma.subscription.findUnique({where:{id:p.subId},include:{user:true}})
  if(!sub){console.log(`❌ ${p.subId}: sub not found`);continue}
  const stripe=cli[sub.stripeAccountKey]
  const cust=await stripe.customers.retrieve(sub.stripeCustomerId,{expand:['invoice_settings.default_payment_method']})
  const pm=cust.invoice_settings?.default_payment_method
  const card=pm?.card
  const expOk=card?(card.exp_year*100+card.exp_month)>=(2026*100+6):false
  const ik=`recover-proration:${p.subId}:${Math.round(p.amountGBP*100)}`
  console.log(`${sub.user.firstName} ${sub.user.lastName} <${sub.user.email}> [${sub.stripeAccountKey}]`)
  console.log(`   amount: £${p.amountGBP}  reason: ${p.reason}`)
  console.log(`   card: ${card?`${card.brand} ****${card.last4} exp ${card.exp_month}/${card.exp_year} ${expOk?'✅':'❌EXPIRED'}`:'⚠️ NONE'}`)
  // already collected? (idempotency at the DB level too)
  const existing=await prisma.payment.findFirst({where:{userId:sub.userId,description:{contains:`[recover:${p.subId}]`}}})
  if(existing){console.log(`   ⏭️ already recovered (payment ${existing.id}) — skip`);continue}
  if(!APPLY){console.log(`   → would charge £${p.amountGBP} to card on file\n`);continue}
  if(!card||!expOk){console.log(`   ⏭️ no valid card — SKIP (not charging)\n`);continue}
  const res=await chargeProration(stripe, sub.stripeCustomerId, Math.round(p.amountGBP*100), `Proration recovery: ${p.reason}`, {reason:'proration_recovery', subId:p.subId, userId:sub.userId}, ik)
  if(res.paid){
    await prisma.payment.create({data:{userId:sub.userId,amount:p.amountGBP,currency:'GBP',status:'CONFIRMED',description:`Proration recovery: ${p.reason} [recover:${p.subId}] [inv:${res.invoiceId}]`,routedEntityId:sub.routedEntityId,processedAt:new Date()}})
    console.log(`   ✅ CHARGED £${res.amountPaid} (invoice ${res.invoiceId}), payment row written\n`)
  } else {
    console.log(`   ❌ charge FAILED: ${res.error} — no payment row, access unaffected\n`)
  }
}
await prisma.$disconnect()
