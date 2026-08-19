// Re-check-in gate: a member cannot check in again within this window.
// Enforced server-side in /api/reception/checkin (the UIs also pre-block,
// but the endpoint is the gate — screens can't bypass it).
export const CHECKIN_BLOCK_HOURS = 2
export const CHECKIN_BLOCK_MS = CHECKIN_BLOCK_HOURS * 60 * 60 * 1000
