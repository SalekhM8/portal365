-- CreateTable
CREATE TABLE "business_entities" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "goCardlessToken" TEXT,
    "goCardlessEnv" TEXT NOT NULL DEFAULT 'sandbox',
    "webhookSecret" TEXT,
    "stripePublishableKey" TEXT,
    "stripeSecretKey" TEXT,
    "stripeWebhookSecret" TEXT,
    "vatThreshold" REAL NOT NULL DEFAULT 90000.00,
    "currentRevenue" REAL NOT NULL DEFAULT 0.00,
    "vatYearStart" DATETIME NOT NULL,
    "vatYearEnd" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "bankDetails" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "vat_calculations" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "entityId" TEXT NOT NULL,
    "calculationDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "vatYearStart" DATETIME NOT NULL,
    "vatYearEnd" DATETIME NOT NULL,
    "totalRevenue" REAL NOT NULL DEFAULT 0.00,
    "monthlyAverage" REAL NOT NULL DEFAULT 0.00,
    "projectedYearEnd" REAL NOT NULL DEFAULT 0.00,
    "headroomRemaining" REAL NOT NULL DEFAULT 90000.00,
    "riskLevel" TEXT NOT NULL DEFAULT 'LOW',
    "calculationTimeMs" INTEGER,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "lastPaymentDate" DATETIME,
    CONSTRAINT "vat_calculations_entityId_fkey" FOREIGN KEY ("entityId") REFERENCES "business_entities" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "email" TEXT NOT NULL,
    "emailVerified" DATETIME,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "dateOfBirth" DATETIME,
    "emergencyContact" TEXT,
    "medicalInfo" TEXT,
    "password" TEXT,
    "role" TEXT NOT NULL DEFAULT 'CUSTOMER',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "communicationPrefs" TEXT,
    "profileImage" TEXT,
    "lastLoginAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "membershipType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endDate" DATETIME,
    "monthlyPrice" REAL NOT NULL,
    "setupFee" REAL NOT NULL DEFAULT 0.00,
    "accessPermissions" TEXT NOT NULL,
    "scheduleAccess" TEXT NOT NULL,
    "ageCategory" TEXT NOT NULL,
    "billingDay" INTEGER NOT NULL DEFAULT 1,
    "nextBillingDate" DATETIME NOT NULL,
    "familyGroupId" TEXT,
    "isPrimaryMember" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "memberships_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "description" TEXT NOT NULL,
    "paymentProvider" TEXT,
    "goCardlessPaymentId" TEXT,
    "goCardlessMandateId" TEXT,
    "goCardlessStatus" TEXT,
    "stripePaymentIntentId" TEXT,
    "stripePaymentMethodId" TEXT,
    "stripePaymentStatus" TEXT,
    "externalPaymentId" TEXT,
    "externalCustomerId" TEXT,
    "externalMandateId" TEXT,
    "externalStatus" TEXT,
    "routedEntityId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "maxRetries" INTEGER NOT NULL DEFAULT 3,
    "scheduledFor" DATETIME,
    "processedAt" DATETIME,
    "failedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "payments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payments_routedEntityId_fkey" FOREIGN KEY ("routedEntityId") REFERENCES "business_entities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "payment_routing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "paymentId" TEXT NOT NULL,
    "selectedEntityId" TEXT NOT NULL,
    "availableEntities" TEXT NOT NULL,
    "routingReason" TEXT NOT NULL,
    "routingMethod" TEXT NOT NULL,
    "confidence" TEXT NOT NULL,
    "vatPositionSnapshot" TEXT NOT NULL,
    "thresholdDistance" REAL NOT NULL,
    "adminOverride" BOOLEAN NOT NULL DEFAULT false,
    "overrideReason" TEXT,
    "overrideUserId" TEXT,
    "decisionTimeMs" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "payment_routing_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "payment_routing_selectedEntityId_fkey" FOREIGN KEY ("selectedEntityId") REFERENCES "business_entities" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "services" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "basePrice" REAL NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'GBP',
    "duration" INTEGER,
    "maxParticipants" INTEGER,
    "ageRestrictions" TEXT,
    "preferredEntityId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "availableDays" TEXT NOT NULL,
    "availableTimes" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "services_preferredEntityId_fkey" FOREIGN KEY ("preferredEntityId") REFERENCES "business_entities" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "classes" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "classes_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "services" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "access_logs" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "accessMethod" TEXT NOT NULL,
    "accessGranted" BOOLEAN NOT NULL,
    "accessReason" TEXT NOT NULL,
    "location" TEXT NOT NULL DEFAULT 'Main Entrance',
    "accessTime" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "membershipStatus" TEXT,
    "paymentStatus" TEXT,
    "biometricUsed" BOOLEAN NOT NULL DEFAULT false,
    CONSTRAINT "access_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "biometric_data" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "biometricHash" TEXT NOT NULL,
    "enrollmentDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsed" DATETIME,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "biometric_data_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "system_settings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL DEFAULT 'general',
    "dataType" TEXT NOT NULL DEFAULT 'string',
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    "updatedBy" TEXT
);

-- CreateTable
CREATE TABLE "bookings" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT NOT NULL,
    "classId" TEXT,
    "serviceName" TEXT NOT NULL,
    "bookingDate" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attendanceDate" DATETIME NOT NULL,
    "attended" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    CONSTRAINT "bookings_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "business_entities_name_key" ON "business_entities"("name");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "payment_routing_paymentId_key" ON "payment_routing"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "biometric_data_userId_key" ON "biometric_data"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "system_settings_key_key" ON "system_settings"("key");
