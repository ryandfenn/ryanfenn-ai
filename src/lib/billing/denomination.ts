/** Display/wallet scale vs Totalum. 1 old RF credit = 100 new RF credits. */

export const CREDIT_SCALE = 100;
export const CREDIT_DENOMINATION_KEY = "credit_denomination";
export const TARGET_DENOMINATION = 100;
export const TARGET_COST_MULTIPLIER = 200;
export const EXPECTED_OLD_FREE_CREDITS = 20;
export const EXPECTED_OLD_MULTIPLIER = 2;

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

export const EXPECTED_PLAN_SLUGS = ["free", "builder", "pro"] as const;
export const EXPECTED_PACK_NAMES = ["Starter pack", "Studio pack", "Scale pack"] as const;

export const FREE_WELCOME_FALLBACK = TARGET_PLAN_CREDITS.free.monthly_credits;

export const INT32_MAX = 2_147_483_647;
export const JS_MAX_SAFE = Number.MAX_SAFE_INTEGER;

export function scaleOldCredits(amount: number, scale = CREDIT_SCALE): number {
  return Math.round(amount) * scale;
}

export function conversionWouldOverflowInt32(maxAbsAmount: number, scale = CREDIT_SCALE): boolean {
  return !Number.isFinite(maxAbsAmount) || Math.abs(maxAbsAmount) * scale > INT32_MAX;
}

/** After bigint columns, the limit that matters to this Node app is IEEE-754. */
export function conversionWouldOverflowJs(maxAbsAmount: number, scale = CREDIT_SCALE): boolean {
  return !Number.isFinite(maxAbsAmount) || Math.abs(maxAbsAmount) * scale > JS_MAX_SAFE;
}

export function conversionWouldOverflow(maxAbsAmount: number, scale = CREDIT_SCALE): boolean {
  return conversionWouldOverflowJs(maxAbsAmount, scale);
}

/** Coerce PostgREST numerics; reject values JS cannot represent exactly. */
export function asSafeCredit(value: unknown, fallback = 0): number {
  if (value == null || value === "") return fallback;
  if (typeof value === "bigint") {
    if (value > BigInt(JS_MAX_SAFE) || value < -BigInt(JS_MAX_SAFE)) return fallback;
    return Number(value);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (Math.abs(n) > JS_MAX_SAFE) return fallback;
  return n;
}

/** After conversion, Totalum spend still uses ceil(totalum * multiplier). */
export function rfFromTotalum(totalumCredits: number, multiplier: number): number {
  if (!Number.isFinite(totalumCredits) || totalumCredits <= 0) return 0;
  return Math.max(1, Math.ceil(totalumCredits * multiplier));
}

/** Same Totalum runway before and after ×100 when multiplier also ×100. */
export function totalumRunway(rfCredits: number, multiplier: number): number {
  if (!Number.isFinite(rfCredits) || !Number.isFinite(multiplier) || multiplier <= 0) return 0;
  return rfCredits / multiplier;
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
  if (opts.costMultiplier != null && opts.costMultiplier !== EXPECTED_OLD_MULTIPLIER) return false;
  return opts.freeMonthlyCredits === EXPECTED_OLD_FREE_CREDITS;
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
    .reduce((sum, r) => sum + Math.abs(asSafeCredit(r.captured_amount)), 0);
}

export function reservationCaptureActual(opts: {
  totalumSpent: number;
  multiplier: number;
  reservedAmount: number;
}): number {
  if (opts.totalumSpent > 0) return rfFromTotalum(opts.totalumSpent, opts.multiplier);
  return opts.reservedAmount;
}

export type ConversionAbort = { ok: true } | { ok: false; reason: string };

/** Mirrors the SQL preflight abort conditions (Stripe open sessions are not in Postgres). */
export function conversionPreflightAbort(opts: {
  denomination: number | null;
  costMultiplier: number | null;
  plans: { slug: string; monthly_credits: number; stripe_price_id: string | null }[];
  packs: { name: string; stripe_price_id: string | null }[];
  openReservations: number;
  pendingStripeEvents: number;
  backupAlreadyFilled: boolean;
  maxAbsCredit: number;
}): ConversionAbort {
  if (opts.backupAlreadyFilled) return { ok: false, reason: "migration backup tables already have rows" };
  if (opts.denomination === TARGET_DENOMINATION) return { ok: false, reason: "credit_denomination is already 100" };
  if (opts.costMultiplier !== EXPECTED_OLD_MULTIPLIER) {
    return { ok: false, reason: `cost_multiplier must be ${EXPECTED_OLD_MULTIPLIER} before conversion` };
  }
  const slugs = opts.plans.map((p) => p.slug).sort().join(",");
  if (slugs !== [...EXPECTED_PLAN_SLUGS].sort().join(",")) {
    return { ok: false, reason: "expected exactly free, builder, and pro plan rows" };
  }
  const names = opts.packs.map((p) => p.name).sort().join(",");
  if (names !== [...EXPECTED_PACK_NAMES].sort().join(",")) {
    return { ok: false, reason: "expected exactly one Starter, Studio, and Scale pack" };
  }
  const free = opts.plans.find((p) => p.slug === "free");
  if (free?.monthly_credits !== EXPECTED_OLD_FREE_CREDITS) {
    return { ok: false, reason: "free.monthly_credits must be 20 before conversion" };
  }
  for (const p of opts.plans) {
    if (p.slug !== "free" && !p.stripe_price_id) {
      return { ok: false, reason: `${p.slug} is missing stripe_price_id` };
    }
  }
  for (const p of opts.packs) {
    if (!p.stripe_price_id) return { ok: false, reason: `${p.name} is missing stripe_price_id` };
  }
  if (opts.openReservations > 0) {
    return { ok: false, reason: "open credit reservations must be captured or released first" };
  }
  if (opts.pendingStripeEvents > 0) {
    return { ok: false, reason: "pending stripe_events rows must be empty (queued webhooks)" };
  }
  if (conversionWouldOverflowJs(opts.maxAbsCredit)) {
    return { ok: false, reason: "×100 would exceed JavaScript MAX_SAFE_INTEGER" };
  }
  return { ok: true };
}

export function rollbackUnsafeIf(opts: { extraLedgerRowsAfterBackup: number; extraProfiles: number }): ConversionAbort {
  if (opts.extraProfiles > 0) return { ok: false, reason: "users were created after cutover; rollback would mix denominations" };
  if (opts.extraLedgerRowsAfterBackup > 0) {
    return { ok: false, reason: "wallet writes happened after cutover; rollback cannot undo them cleanly" };
  }
  return { ok: true };
}
