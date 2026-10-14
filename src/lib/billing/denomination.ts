/** Display/wallet scale vs Totalum. 1 old RF credit = 100 new RF credits. */

export const CREDIT_SCALE = 100;
export const CREDIT_DENOMINATION_KEY = "credit_denomination";
export const TARGET_DENOMINATION = 100;
export const TARGET_COST_MULTIPLIER = 200;

export const TARGET_PLAN_CREDITS: Record<string, { monthly_credits: number; price_cents: number }> = {
  free: { monthly_credits: 2000, price_cents: 0 },
  builder: { monthly_credits: 12500, price_cents: 2900 },
  pro: { monthly_credits: 45000, price_cents: 9900 },
};

export const TARGET_PACK_CREDITS: Record<string, { credits: number; price_cents: number }> = {
  "Starter pack": { credits: 3500, price_cents: 900 },
  "Studio pack": { credits: 17500, price_cents: 3900 },
  "Scale pack": { credits: 60000, price_cents: 12900 },
};

export const FREE_WELCOME_FALLBACK = TARGET_PLAN_CREDITS.free.monthly_credits;

export const INT32_MAX = 2_147_483_647;

export function scaleOldCredits(amount: number, scale = CREDIT_SCALE): number {
  return Math.round(amount) * scale;
}

export function conversionWouldOverflow(maxAbsAmount: number, scale = CREDIT_SCALE): boolean {
  return !Number.isFinite(maxAbsAmount) || Math.abs(maxAbsAmount) * scale > INT32_MAX;
}

/** After conversion, Totalum spend still uses ceil(totalum * multiplier). */
export function rfFromTotalum(totalumCredits: number, multiplier: number): number {
  if (!Number.isFinite(totalumCredits) || totalumCredits <= 0) return 0;
  return Math.max(1, Math.ceil(totalumCredits * multiplier));
}

/**
 * Pack grants after cutover must use the live pack row, not Checkout metadata
 * (which may have been written in old units).
 */
export function packGrantAmount(opts: {
  packCredits: number | null | undefined;
  metadataCredits: number | null | undefined;
  denomination: number;
}): number | null {
  if (opts.packCredits != null && Number.isFinite(opts.packCredits) && opts.packCredits > 0) {
    return Math.round(opts.packCredits);
  }
  if (opts.denomination >= TARGET_DENOMINATION) return null;
  const meta = Number(opts.metadataCredits);
  if (Number.isFinite(meta) && meta > 0) return Math.round(meta);
  return null;
}

export function shouldApplyRedenomination(opts: {
  denomination: number | null;
  freeMonthlyCredits: number | null;
  costMultiplier: number | null;
}): boolean {
  if (opts.denomination === TARGET_DENOMINATION) return false;
  if (opts.freeMonthlyCredits === TARGET_PLAN_CREDITS.free.monthly_credits) return false;
  if ((opts.costMultiplier ?? 0) >= TARGET_COST_MULTIPLIER) return false;
  return opts.freeMonthlyCredits === 20;
}

export type SpendRow = {
  status: string;
  captured_amount: number | null;
  closed_at: string | null;
};

/** Spend = captured_amount on captured reservations. Open holds are not spend. */
export function spentThisMonth(rows: SpendRow[], monthStartIso: string): number {
  return rows
    .filter((r) => r.status === "captured" && r.closed_at && r.closed_at >= monthStartIso)
    .reduce((sum, r) => sum + Math.abs(Number(r.captured_amount) || 0), 0);
}

export function reservationCaptureActual(opts: {
  totalumSpent: number;
  multiplier: number;
  reservedAmount: number;
}): number {
  if (opts.totalumSpent > 0) return rfFromTotalum(opts.totalumSpent, opts.multiplier);
  return opts.reservedAmount;
}
