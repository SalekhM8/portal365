#!/usr/bin/env node

/**
 * 🔍 CRITICAL TEST: What happens when we create auto_advance invoice?
 * 
 * This will test the EXACT behavior of Stripe invoices to understand
 * if payments are actually being collected or failing silently
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

async function testStripeInvoiceBehavior() {
  console.log('🔍 TESTING STRIPE INVOICE BEHAVIOR...\n');
  
  try {
    // Test 1: Create a customer
    console.log('📝 Step 1: Creating test customer...');
    const customer = await stripe.customers.create({
      email: 'test@example.com',
      name: 'Test Customer'
    });
    console.log(`✅ Customer created: ${customer.id}\n`);
    
    // Test 2: Create a payment method (card)
    console.log('💳 Step 2: Creating test payment method...');
    const paymentMethod = await stripe.paymentMethods.create({
      type: 'card',
      card: {
        number: '4242424242424242', // Test card that always succeeds
        exp_month: 12,
        exp_year: 2025,
        cvc: '123'
      }
    });
    console.log(`✅ Payment method created: ${paymentMethod.id}\n`);
    
    // Test 3: Attach payment method to customer
    console.log('🔗 Step 3: Attaching payment method to customer...');
    await stripe.paymentMethods.attach(paymentMethod.id, {
      customer: customer.id
    });
    
    await stripe.customers.update(customer.id, {
      invoice_settings: {
        default_payment_method: paymentMethod.id
      }
    });
    console.log(`✅ Payment method attached and set as default\n`);
    
    // Test 4: Create invoice item
    console.log('📋 Step 4: Creating invoice item for £12.90...');
    const invoiceItem = await stripe.invoiceItems.create({
      customer: customer.id,
      amount: 1290, // £12.90 in pence
      currency: 'gbp',
      description: 'Test prorated payment'
    });
    console.log(`✅ Invoice item created: ${invoiceItem.id}\n`);
    
    // Test 5: Create auto-advance invoice
    console.log('🚀 Step 5: Creating auto_advance invoice...');
    const invoice = await stripe.invoices.create({
      customer: customer.id,
      auto_advance: true // This should charge immediately
    });
    console.log(`✅ Invoice created: ${invoice.id}`);
    console.log(`📊 Invoice status: ${invoice.status}`);
    console.log(`💰 Invoice amount: £${invoice.amount_due / 100}`);
    console.log(`🔄 Auto advance: ${invoice.auto_advance}\n`);
    
    // Test 6: Check invoice after creation
    console.log('⏰ Step 6: Checking invoice status after creation...');
    const updatedInvoice = await stripe.invoices.retrieve(invoice.id);
    console.log(`📊 Updated invoice status: ${updatedInvoice.status}`);
    console.log(`💰 Amount paid: £${updatedInvoice.amount_paid / 100}`);
    console.log(`💸 Amount due: £${updatedInvoice.amount_due / 100}`);
    
    if (updatedInvoice.status === 'paid') {
      console.log('✅ SUCCESS: Invoice was automatically paid!');
    } else if (updatedInvoice.status === 'open') {
      console.log('⚠️  WARNING: Invoice is still open - payment not collected!');
    } else {
      console.log(`❌ UNEXPECTED: Invoice status is ${updatedInvoice.status}`);
    }
    
    // Test 7: Clean up
    console.log('\n🧹 Cleaning up test data...');
    await stripe.customers.del(customer.id);
    console.log('✅ Test customer deleted');
    
    return {
      success: true,
      invoiceStatus: updatedInvoice.status,
      amountPaid: updatedInvoice.amount_paid / 100,
      amountDue: updatedInvoice.amount_due / 100
    };
    
  } catch (error) {
    console.error('❌ Test failed:', error.message);
    
    if (error.type === 'StripeCardError') {
      console.log('💳 Card was declined - this is expected behavior');
      return {
        success: false,
        error: 'card_declined',
        message: 'Payment failed due to card decline'
      };
    }
    
    return {
      success: false,
      error: error.type || 'unknown',
      message: error.message
    };
  }
}

// Run the test
testStripeInvoiceBehavior().then(result => {
  console.log('\n🎯 TEST RESULTS:');
  console.log(JSON.stringify(result, null, 2));
  
  console.log('\n🔍 ANALYSIS:');
  if (result.success && result.invoiceStatus === 'paid') {
    console.log('✅ GOOD: auto_advance invoices DO charge immediately when payment method is valid');
    console.log('🚨 BUG CONFIRMED: Our code marks subscriptions ACTIVE before checking if payment succeeded');
  } else if (result.success && result.invoiceStatus === 'open') {
    console.log('⚠️  ISSUE: auto_advance invoice was created but payment not collected');
    console.log('🚨 This suggests payment method attachment or charging failed');
  } else if (!result.success && result.error === 'card_declined') {
    console.log('✅ EXPECTED: Card declines are handled properly by Stripe');
    console.log('🚨 BUG: Our code would still mark subscription ACTIVE even if card declined');
  }
}).catch(console.error);
