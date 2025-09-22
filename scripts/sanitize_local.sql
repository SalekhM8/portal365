-- Sanitize sensitive data and break live processor links for safe local testing

-- Users: scrub emails and passwords
UPDATE users
SET email = CONCAT('test+', id, '@example.com'),
    password = NULL
WHERE email NOT LIKE 'test+%@example.com';

-- Payments: ensure no external live IDs linger (if applicable)
UPDATE payments
SET goCardlessPaymentId = NULL,
    goCardlessMandateId = NULL,
    goCardlessStatus = NULL;

-- Subscriptions: break live Stripe identifiers so local test keys won’t collide
UPDATE subscriptions
SET stripeSubscriptionId = CONCAT('stg_', id),
    stripeCustomerId = CONCAT('stg_', userId);

-- Invoices: break live Stripe invoice identifiers
UPDATE invoices
SET stripeInvoiceId = CONCAT('stg_', id);

-- Clear sessions/tokens if using auth tables (uncomment if applicable)
-- DELETE FROM sessions;
-- DELETE FROM accounts;

-- Optional: reset memberships to ACTIVE for easier testing
-- UPDATE memberships SET status = 'ACTIVE' WHERE status <> 'ACTIVE';

