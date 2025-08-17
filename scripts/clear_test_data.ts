#!/usr/bin/env ts-node

/**
 * 🧹 PRODUCTION DATA CLEANUP SCRIPT
 * 
 * This script safely clears all test data while preserving:
 * - Business entities (with updated names)
 * - Admin users
 * - Essential configuration
 * 
 * WARNING: This will permanently delete all customer data!
 */

import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  console.log('🧹 Starting production data cleanup...')
  console.log('⚠️  This will delete ALL customer data!')
  
  // Get confirmation
  const readline = require('readline').createInterface({
    input: process.stdin,
    output: process.stdout
  })
  
  await new Promise<void>((resolve) => {
    readline.question('Are you sure you want to continue? (yes/no): ', (answer: string) => {
      readline.close()
      if (answer.toLowerCase() !== 'yes') {
        console.log('❌ Operation cancelled')
        process.exit(0)
      }
      resolve()
    })
  })

  try {
    // 1. Delete subscription audit logs first (foreign key dependency)
    console.log('🗑️  Deleting subscription audit logs...')
    const auditLogsResult = await prisma.subscriptionAuditLog.deleteMany({})
    console.log(`   ✅ Deleted ${auditLogsResult.count} audit log entries`)

    // 2. Delete payments and related data
    console.log('🗑️  Deleting payment routing decisions...')
    const routingResult = await prisma.paymentRouting.deleteMany({})
    console.log(`   ✅ Deleted ${routingResult.count} routing decisions`)

    console.log('🗑️  Deleting VAT calculations...')
    const vatResult = await prisma.vATCalculation.deleteMany({})
    console.log(`   ✅ Deleted ${vatResult.count} VAT calculations`)

    console.log('🗑️  Deleting payments...')
    const paymentsResult = await prisma.payment.deleteMany({})
    console.log(`   ✅ Deleted ${paymentsResult.count} payments`)

    // 3. Delete subscription routing
    console.log('🗑️  Deleting subscription routing...')
    const subRoutingResult = await prisma.subscriptionRouting.deleteMany({})
    console.log(`   ✅ Deleted ${subRoutingResult.count} subscription routings`)

    // 4. Delete subscriptions
    console.log('🗑️  Deleting subscriptions...')
    const subscriptionsResult = await prisma.subscription.deleteMany({})
    console.log(`   ✅ Deleted ${subscriptionsResult.count} subscriptions`)

    // 5. Delete memberships
    console.log('🗑️  Deleting memberships...')
    const membershipsResult = await prisma.membership.deleteMany({})
    console.log(`   ✅ Deleted ${membershipsResult.count} memberships`)

    // 6. Delete invoices
    console.log('🗑️  Deleting invoices...')
    const invoicesResult = await prisma.invoice.deleteMany({})
    console.log(`   ✅ Deleted ${invoicesResult.count} invoices`)

    // 7. Delete classes
    console.log('🗑️  Deleting classes...')
    const classesResult = await prisma.class.deleteMany({})
    console.log(`   ✅ Deleted ${classesResult.count} classes`)

    // 8. Delete services
    console.log('🗑️  Deleting services...')
    const servicesResult = await prisma.service.deleteMany({})
    console.log(`   ✅ Deleted ${servicesResult.count} services`)

    // 9. Delete non-admin users (keep admin accounts)
    console.log('🗑️  Deleting customer users (keeping admins)...')
    const usersResult = await prisma.user.deleteMany({
      where: {
        role: {
          notIn: ['ADMIN', 'SUPER_ADMIN']
        }
      }
    })
    console.log(`   ✅ Deleted ${usersResult.count} customer users`)

    // 10. Update business entity names and reset revenue counters
    console.log('🔄 Updating business entity names and resetting counters...')
    
    // Update Aura Tuition to IQ Learning Centre
    await prisma.businessEntity.update({
      where: { name: 'aura_tuition' },
      data: { 
        displayName: 'IQ Learning Centre',
        currentRevenue: 0
      }
    })
    console.log('   ✅ Updated: Aura Tuition → IQ Learning Centre')

    // Update Aura Wellness to Aura Fitness Centre
    await prisma.businessEntity.update({
      where: { name: 'aura_wellness' },
      data: { 
        displayName: 'Aura Fitness Centre',
        currentRevenue: 0
      }
    })
    console.log('   ✅ Updated: Aura Wellness → Aura Fitness Centre')

    // Reset revenue for all entities
    await prisma.businessEntity.updateMany({
      data: { currentRevenue: 0 }
    })
    console.log('   ✅ Reset all revenue counters to £0')

    // 11. Show final counts
    console.log('\n📊 Final database state:')
    
    const adminCount = await prisma.user.count({
      where: { role: { in: ['ADMIN', 'SUPER_ADMIN'] } }
    })
    const entityCount = await prisma.businessEntity.count()
    const customerCount = await prisma.user.count({
      where: { role: { notIn: ['ADMIN', 'SUPER_ADMIN'] } }
    })
    
    console.log(`   👥 Admin users: ${adminCount}`)
    console.log(`   🏢 Business entities: ${entityCount}`)
    console.log(`   👤 Customer users: ${customerCount}`)
    console.log(`   💰 Total revenue: £0.00`)

    console.log('\n🎉 Production cleanup completed successfully!')
    console.log('🚀 Platform is now ready for real customers!')

  } catch (error) {
    console.error('❌ Error during cleanup:', error)
    throw error
  } finally {
    await prisma.$disconnect()
  }
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
