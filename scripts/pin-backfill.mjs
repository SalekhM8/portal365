import dotenv from 'dotenv'
dotenv.config({ path: '.env.vercel', override: true })
const { PrismaClient } = await import('@prisma/client')
const bcrypt=(await import('bcryptjs')).default
const prisma=new PrismaClient()
// verify column exists (prod)
const probe=await prisma.user.findFirst({select:{id:true,pin:true}})
console.log('✅ prod has pin column (probe ok)')

// ---- backfill unique PINs for everyone without one ----
const WEAK=new Set(['0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','1234','4321','0123','1122'])
const users=await prisma.user.findMany({where:{pin:null},select:{id:true}})
const taken=new Set((await prisma.user.findMany({where:{pin:{not:null}},select:{pin:true}})).map(u=>u.pin))
let assigned=0
for(const u of users){
  let pin
  do{ pin=String(Math.floor(Math.random()*10000)).padStart(4,'0') }while(taken.has(pin)||WEAK.has(pin))
  taken.add(pin)
  await prisma.user.update({where:{id:u.id},data:{pin}})
  assigned++
}
console.log(`✅ PINs assigned: ${assigned} (total with PIN now: ${taken.size})`)

// ---- tracker365 reception account ----
const EMAIL='tracker365@portal365.local'
const exists=await prisma.user.findUnique({where:{email:EMAIL}})
if(!exists){
  await prisma.user.create({data:{email:EMAIL,firstName:'Reception',lastName:'Desk',role:'RECEPTIONIST',status:'ACTIVE',password:await bcrypt.hash('aura2026',10)}})
  console.log(`✅ Reception account created: login "tracker365" / password "aura2026" (role RECEPTIONIST)`)
}else console.log('reception account already exists')
await prisma.$disconnect()
