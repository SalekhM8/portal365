export function isPlansDbEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PLANS_DB_ENABLED === 'true' || process.env.PLANS_DB_ENABLED === 'true'
}

export function isPlansAdminEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PLANS_ADMIN_ENABLED === 'true' || process.env.PLANS_ADMIN_ENABLED === 'true'
}

export function isDunningEmailEnabled(): boolean {
  return process.env.DUNNING_EMAIL_ENABLED === 'true'
}

export function isDunningSmsEnabled(): boolean {
  return process.env.DUNNING_SMS_ENABLED === 'true'
}

export function isAutoSuspendEnabled(): boolean {
  return process.env.AUTO_SUSPEND_AFTER_3_FAILS === 'true'
}

export function isPauseCollectionEnabled(): boolean {
  return process.env.PAUSE_COLLECTION_AFTER_3_FAILS === 'true'
}

export function isCardOnlyForNewEnabled(): boolean {
  return process.env.CARD_ONLY_FOR_NEW_SIGNUPS === 'true'
}


