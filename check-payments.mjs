import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

async function main() {
  // Total payments
  const total = await prisma.payment.count({ where: { amount: { gt: 0 } } });
  console.log(`Total payments: ${total}`);
  
  // Payments by month
  const payments = await prisma.payment.findMany({
    where: { amount: { gt: 0 } },
    select: { createdAt: true },
    orderBy: { createdAt: 'desc' }
  });
  
  const byMonth = {};
  for (const p of payments) {
    const key = p.createdAt.toISOString().slice(0, 7);
    byMonth[key] = (byMonth[key] || 0) + 1;
  }
  
  console.log("\nPayments by month:");
  Object.keys(byMonth).sort().forEach(m => console.log(`  ${m}: ${byMonth[m]}`));
  
  // Check if take:500 would exclude older payments
  const top500 = await prisma.payment.findMany({
    where: { amount: { gt: 0 } },
    orderBy: [{ processedAt: 'desc' }, { createdAt: 'desc' }],
    take: 500,
    select: { createdAt: true, processedAt: true }
  });
  
  const oldest500 = top500.length > 0 ? top500[top500.length - 1] : null;
  console.log(`\nWith take:500, oldest payment shown:`);
  console.log(`  createdAt: ${oldest500?.createdAt?.toISOString()}`);
  console.log(`  processedAt: ${oldest500?.processedAt?.toISOString()}`);
  console.log(`Total in top 500: ${top500.length}`);
}

main().catch(console.error).finally(() => prisma.$disconnect());
