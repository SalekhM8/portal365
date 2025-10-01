export function isPlansDbEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PLANS_DB_ENABLED === 'true' || process.env.PLANS_DB_ENABLED === 'true'
}

export function isPlansAdminEnabled(): boolean {
  return process.env.NEXT_PUBLIC_PLANS_ADMIN_ENABLED === 'true' || process.env.PLANS_ADMIN_ENABLED === 'true'
}


