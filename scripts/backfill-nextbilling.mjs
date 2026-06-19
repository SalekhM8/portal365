import dotenv from 'dotenv'
dotenv.config({ path: '.env.vercel', override: true })
const Stripe=(await import('stripe')).default
const { PrismaClient } = await import('@prisma/client')
const prisma=new PrismaClient()
const APPLY=process.argv.includes('--apply')
const keys={SU:process.env.STRIPE_SECRET_KEY,IQ:process.env.STRIPE_IQ_SECRET_KEY,AURA:process.env.STRIPE_AURA_SECRET_KEY,AURAUP:process.env.STRIPE_AURAUP_SECRET_KEY,AFC:process.env.STRIPE_AFC_SECRET_KEY}
const cli=Object.fromEntries(Object.entries(keys).filter(([,v])=>v).map(([k,v])=>[k,new Stripe(v)]))
function period(sub){const it=sub?.items?.data?.[0];const s=it?.current_period_start??sub?.current_period_start;const e=it?.current_period_end??sub?.current_period_end;return{start:typeof s==='number'&&s>0?s:null,end:typeof e==='number'&&e>0?e:null}}
const subs=await prisma.subscription.findMany({where:{status:{in:['ACTIVE','PAST_DUE']},stripeSubscriptionId:{startsWith:'sub_'}}})
console.log(`MODE: ${APPLY?'APPLY':'DRY-RUN'} | checking ${subs.length} subs`)
let fixed=0,errs=0
for(const s of subs){
  const c=cli[s.stripeAccountKey];if(!c)continue
  let ss;try{ss=await c.subscriptions.retrieve(s.stripeSubscriptionId)}catch{errs++;continue}
  const {start,end}=period(ss)
  if(!end)continue
  const truthEnd=new Date(end*1000)
  const dbEnd=s.nextBillingDate?new Date(s.nextBillingDate):null
  if(dbEnd && Math.abs(dbEnd.getTime()-truthEnd.getTime())<86400000) continue // already correct (within a day)
  fixed++
  if(fixed<=10) console.log(`  ${s.id} ${s.stripeAccountKey}: nextBilling ${dbEnd?dbEnd.toISOString().slice(0,10):'-'} -> ${truthEnd.toISOString().slice(0,10)}`)
  if(APPLY){
    await prisma.subscription.update({where:{id:s.id},data:{nextBillingDate:truthEnd, currentPeriodEnd:truthEnd, ...(start?{currentPeriodStart:new Date(start*1000)}:{})}})
    await prisma.membership.updateMany({where:{userId:s.userId},data:{nextBillingDate:truthEnd}}).catch(()=>{})
  }
}
console.log(`\n${APPLY?'Fixed':'Would fix'}: ${fixed} subs (${errs} stripe errors). ${APPLY?'':'Re-run with --apply.'}`)
await prisma.$disconnect()
