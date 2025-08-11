-- CreateTable
CREATE TABLE "business_entities" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "goCardlessToken" TEXT,
    "goCardlessEnv" TEXT NOT NULL DEFAULT 'sandbox',
    "webhookSecret" TEXT,
    "vatThreshold" DECIMAL(10,2) NOT NULL DEFAULT 90000.00,
    "currentRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "vatYearStart" TIMESTAMP(3) NOT NULL,
    "vatYearEnd" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "bankDetails" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_entities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vat_calculations" (
    "id" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "calculationDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vatYearStart" TIMESTAMP(3) NOT NULL,
    "vatYearEnd" TIMESTAMP(3) NOT NULL,
    "totalRevenue" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "monthlyAverage" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "projectedYearEnd" DECIMAL(12,2) NOT NULL DEFAULT 0.00,
    "headroomRemaining" DECIMAL(12,2) NOT NULL DEFAULT 90000.00,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "calculationTimeMs" INTEGER,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "lastPaymentDate" TIMESTAMP(3),

    CONSTRAINT "vat_calculations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "emergencyContact" TEXT,
    "medicalInfo" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "communicationPrefs" TEXT,
    "profileImage" TEXT,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "membershipType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" TIMESTAMP(3),
    "monthlyPrice" DOUBLE PRECISION NOT NULL,
    "setupFee" DOUBLE PRECISION NOT NULL DEFAULT 0.00,
    "accessPermissions" TEXT NOT NULL,
    "scheduleAccess" TEXT NOT NULL,
    "ageCategory" TEXT NOT NULL,
    "billingDay" INTEGER NOT NULL DEFAULT 1,
    "nextBillingDate" TIMESTAMP(3) NOT NULL,
    "familyGroupId" TEXT,
    "isPrimaryMember" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "description" TEXT NOT NULL,
    "goCardlessPaymentId" TEXT,
    "goCardlessMandateId" TEXT,
    "goCardlessStatus" TEXT,
    "routedEntityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_routing" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "selectedEntityId" TEXT NOT NULL,
    "availableEntities" TEXT NOT NULL,
    "routingReason" TEXT NOT NULL,
    "routingMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "vatPositionSnapshot" TEXT NOT NULL,
    "thresholdDistance" DOUBLE PRECISION NOT NULL,
    "adminOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overrideUserId" TEXT,
    "decisionTimeMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "basePrice" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "duration" INTEGER,
    "maxParticipants" INTEGER,
    "ageRestrictions" TEXT,
    "preferredEntityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "availableDays" TEXT NOT NULL,
    "availableTimes" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL,
    "serviceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructorName" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "duration" INTEGER NOT NULL,
    "maxParticipants" INTEGER NOT NULL DEFAULT 30,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiredMemberships" TEXT NOT NULL,
    "ageRestrictions" TEXT,
    "location" TEXT NOT NULL DEFAULT 'Main Gym',
    "equipment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "classes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessMethod" TEXT NOT NULL,
    "accessGranted" BOOLEAN NOT NULL,
    "accessReason" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT 'Main Entrance',
    "accessTime" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "membershipStatus" TEXT,
    "paymentStatus" TEXT,
    "biometricUsed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "biometric_data" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "biometricHash" TEXT NOT NULL,
    "enrollmentDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "biometric_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "dataType" TEXT NOT NULL DEFAULT 'string',
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "updatedBy" TEXT,

    CONSTRAINT "system_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "classId" TEXT,
    "serviceName" TEXT NOT NULL,
    "bookingDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendanceDate" TIMESTAMP(3) NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,

    CONSTRAINT "bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "stripeCustomerId" TEXT NOT NULL,
    "routedEntityId" TEXT NOT NULL,
    "membershipType" TEXT NOT NULL,
    "monthlyPrice" DECIMAL(10,2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "currentPeriodStart" TIMESTAMP(3) NOT NULL,
    "currentPeriodEnd" TIMESTAMP(3) NOT NULL,
    "nextBillingDate" TIMESTAMP(3) NOT NULL,
    "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_routing" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "selectedEntityId" TEXT NOT NULL,
    "availableEntities" TEXT NOT NULL,
    "routingReason" TEXT NOT NULL,
    "routingMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "vatPositionSnapshot" TEXT NOT NULL,
    "thresholdDistance" DOUBLE PRECISION NOT NULL,
    "decisionTimeMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_routing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "status" TEXT NOT NULL,
    "billingPeriodStart" TIMESTAMP(3) NOT NULL,
    "billingPeriodEnd" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_entities_name_key" ON "business_entities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "payments_goCardlessPaymentId_key" ON "payments"("goCardlessPaymentId");

-- CreateIndex
CREATE INDEX "payments_status_createdAt_idx" ON "payments"("status", "createdAt");

-- CreateIndex
CREATE INDEX "payments_userId_createdAt_idx" ON "payments"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_routing_paymentId_key" ON "payment_routing"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_data_userId_key" ON "biometric_data"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_stripeSubscriptionId_key" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_userId_idx" ON "subscriptions"("userId");

-- CreateIndex
CREATE INDEX "subscriptions_stripeSubscriptionId_idx" ON "subscriptions"("stripeSubscriptionId");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscription_routing_subscriptionId_idx" ON "subscription_routing"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_stripeInvoiceId_key" ON "invoices"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "invoices_subscriptionId_idx" ON "invoices"("subscriptionId");

-- CreateIndex
CREATE INDEX "invoices_stripeInvoiceId_idx" ON "invoices"("stripeInvoiceId");

-- AddForeignKey
ALTER TABLE "vat_calculations" ADD CONSTRAINT "vat_calculations_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "business_entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_routedEntityId_fkey" FOREIGN KEY ("routedEntityId") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_routing" ADD CONSTRAINT "payment_routing_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_routing" ADD CONSTRAINT "payment_routing_selectedEntityId_fkey" FOREIGN KEY ("selectedEntityId") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "services" ADD CONSTRAINT "services_preferredEntityId_fkey" FOREIGN KEY ("preferredEntityId") REFERENCES "business_entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "classes" ADD CONSTRAINT "classes_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "access_logs" ADD CONSTRAINT "access_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "biometric_data" ADD CONSTRAINT "biometric_data_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_routedEntityId_fkey" FOREIGN KEY ("routedEntityId") REFERENCES "business_entities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_routing" ADD CONSTRAINT "subscription_routing_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
