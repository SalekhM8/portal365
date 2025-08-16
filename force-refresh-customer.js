// Quick script to check what's actually in the database
// Run this in browser console on admin page after resume:

async function checkCustomerStatus(customerId) {
  try {
    const response = await fetch('/api/admin/dashboard')
    const data = await response.json()
    const customer = data.customers.find(c => c.id === customerId)
    console.log('Current customer data:', customer)
    console.log('Status:', customer?.status)
    console.log('Subscription Status:', customer?.subscriptionStatus)
    console.log('Membership Status:', customer?.membershipStatus)
  } catch (error) {
    console.error('Failed to fetch:', error)
  }
}

// Usage: checkCustomerStatus('cmee296930000l804glht4lnt')
