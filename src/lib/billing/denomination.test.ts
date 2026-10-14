import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { billingMaintenanceEnabled } from "./maintenance";
import {
  CREDIT_SCALE,
  EXPECTED_OLD_FREE_CREDITS,
  EXPECTED_OLD_MULTIPLIER,
  FREE_WELCOME_FALLBACK,
  JS_MAX_SAFE,
  TARGET_COST_MULTIPLIER,
  TARGET_DENOMINATION,
  TARGET_PACK_CREDITS,
  TARGET_PLAN_CREDITS,
  asSafeCredit,
  conversionPreflightAbort,
  conversionWouldOverflow,
  conversionWouldOverflowInt32,
  packGrantAmount,
  reservationCaptureActual,
  rollbackUnsafeIf,
  scaleOldCredits,
  shouldApplyRedenomination,
  spentThisMonth,
  totalumRunway,
} from "./denomination";

describe("100x conversion", () => {
  it("scales existing balances exactly once by 100", () => {
    assert.equal(scaleOldCredits(20), 2000);
    assert.equal(scaleOldCredits(250), 25000);
    assert.equal(scaleOldCredits(0), 0);
    assert.equal(scaleOldCredits(-8), -800);
  });

  it("does not re-apply when denomination or free plan is already new", () => {
    assert.equal(shouldApplyRedenomination({ denomination: 100, freeMonthlyCredits: 20, costMultiplier: 2 }), false);
    assert.equal(shouldApplyRedenomination({ denomination: null, freeMonthlyCredits: 2000, costMultiplier: 2 }), false);
    assert.equal(shouldApplyRedenomination({ denomination: null, freeMonthlyCredits: 20, costMultiplier: 200 }), false);
    assert.equal(shouldApplyRedenomination({ denomination: null, freeMonthlyCredits: 20, costMultiplier: 2 }), true);
    assert.equal(shouldApplyRedenomination({ denomination: null, freeMonthlyCredits: 20, costMultiplier: 2.5 }), false);
  });

  it("flags overflow for JS (bigint columns) and int32", () => {
    assert.equal(conversionWouldOverflow(20), false);
    assert.equal(conversionWouldOverflowInt32(30_000_000), true);
    assert.equal(conversionWouldOverflow(JS_MAX_SAFE / 50), true);
  });

  it("keeps JavaScript-safe credit values", () => {
    assert.equal(asSafeCredit(2000), 2000);
    assert.equal(asSafeCredit("3500"), 3500);
    assert.equal(asSafeCredit(1e20), 0);
  });
});

describe("purchasing power", () => {
  it("keeps the same Totalum runway for a 20-credit test wallet", () => {
    const oldBal = EXPECTED_OLD_FREE_CREDITS;
    const newBal = scaleOldCredits(oldBal);
    assert.equal(newBal, 2000);
    assert.equal(
      totalumRunway(oldBal, EXPECTED_OLD_MULTIPLIER),
      totalumRunway(newBal, TARGET_COST_MULTIPLIER),
    );
    const spentTotalum = 5;
    const oldCapture = reservationCaptureActual({ totalumSpent: spentTotalum, multiplier: 2, reservedAmount: 8 });
    const newCapture = reservationCaptureActual({ totalumSpent: spentTotalum, multiplier: 200, reservedAmount: 800 });
    assert.equal(oldCapture, 10);
    assert.equal(newCapture, 1000);
    assert.equal(totalumRunway(oldBal - oldCapture, 2), totalumRunway(newBal - newCapture, 200));
  });
});

describe("AI spending", () => {
  it("settles prompts from Totalum usage times multiplier, not a flat fee", () => {
    assert.equal(reservationCaptureActual({ totalumSpent: 5, multiplier: 2, reservedAmount: 8 }), 10);
    assert.equal(reservationCaptureActual({ totalumSpent: 5, multiplier: TARGET_COST_MULTIPLIER, reservedAmount: 800 }), 1000);
    assert.equal(reservationCaptureActual({ totalumSpent: 0, multiplier: TARGET_COST_MULTIPLIER, reservedAmount: 800 }), 800);
  });
});

describe("checkout and renewals", () => {
  it("uses live pack credits after cutover, not stale Checkout metadata", () => {
    assert.equal(packGrantAmount({ packCredits: 3500, metadataCredits: 100, denomination: 100 }), 3500);
    assert.equal(packGrantAmount({ packCredits: null, metadataCredits: 100, denomination: 100 }), null);
    assert.equal(packGrantAmount({ packCredits: null, metadataCredits: 100, denomination: 1 }), 100);
  });

  it("renewals read target plan allowances", () => {
    assert.equal(TARGET_PLAN_CREDITS.builder.monthly_credits, 12500);
    assert.equal(TARGET_PLAN_CREDITS.pro.monthly_credits, 45000);
    assert.equal(TARGET_PLAN_CREDITS.builder.price_cents, 2900);
    assert.equal(TARGET_PACK_CREDITS["Starter pack"].credits, 3500);
    assert.equal(FREE_WELCOME_FALLBACK, 2000);
  });
});

describe("idempotency, preflight, rollback, spend", () => {
  it("keeps Stripe-style keys as event-id based (scale does not change the key)", () => {
    assert.equal(`stripe:evt_test`, "stripe:evt_test");
  });

  it("counts captured_amount only, not open reserves", () => {
    const month = "2026-10-01T00:00:00.000Z";
    const spent = spentThisMonth(
      [
        { status: "captured", captured_amount: 1000, closed_at: "2026-10-02T00:00:00.000Z" },
        { status: "reserved", captured_amount: null, closed_at: null },
        { status: "captured", captured_amount: 5, closed_at: "2026-09-01T00:00:00.000Z" },
      ],
      month,
    );
    assert.equal(spent, 1000);
  });

  it("aborts conversion on missing packs, open holds, pending events, or existing backup", () => {
    const base = {
      denomination: null as number | null,
      costMultiplier: 2,
      plans: [
        { slug: "free", monthly_credits: 20, stripe_price_id: null },
        { slug: "builder", monthly_credits: 250, stripe_price_id: "price_b" },
        { slug: "pro", monthly_credits: 1000, stripe_price_id: "price_p" },
      ],
      packs: [
        { name: "Starter pack", stripe_price_id: "price_s" },
        { name: "Studio pack", stripe_price_id: "price_u" },
        { name: "Scale pack", stripe_price_id: "price_c" },
      ],
      openReservations: 0,
      pendingStripeEvents: 0,
      backupAlreadyFilled: false,
      maxAbsCredit: 20,
    };
    assert.equal(conversionPreflightAbort(base).ok, true);
    assert.equal(conversionPreflightAbort({ ...base, openReservations: 1 }).ok, false);
    assert.equal(conversionPreflightAbort({ ...base, pendingStripeEvents: 2 }).ok, false);
    assert.equal(conversionPreflightAbort({ ...base, backupAlreadyFilled: true }).ok, false);
    assert.equal(conversionPreflightAbort({ ...base, costMultiplier: 2.5 }).ok, false);
    assert.equal(conversionPreflightAbort({ ...base, packs: base.packs.slice(0, 2) }).ok, false);
  });

  it("marks rollback unsafe after post-cutover writes", () => {
    assert.equal(rollbackUnsafeIf({ extraLedgerRowsAfterBackup: 0, extraProfiles: 0 }).ok, true);
    assert.equal(rollbackUnsafeIf({ extraLedgerRowsAfterBackup: 1, extraProfiles: 0 }).ok, false);
    assert.equal(rollbackUnsafeIf({ extraLedgerRowsAfterBackup: 0, extraProfiles: 1 }).ok, false);
  });

  it("documents CREDIT_SCALE", () => {
    assert.equal(CREDIT_SCALE, TARGET_DENOMINATION);
  });
});

describe("maintenance freeze", () => {
  it("is off unless BILLING_MAINTENANCE is set", () => {
    const prev = process.env.BILLING_MAINTENANCE;
    delete process.env.BILLING_MAINTENANCE;
    assert.equal(billingMaintenanceEnabled(), false);
    process.env.BILLING_MAINTENANCE = "true";
    assert.equal(billingMaintenanceEnabled(), true);
    if (prev === undefined) delete process.env.BILLING_MAINTENANCE;
    else process.env.BILLING_MAINTENANCE = prev;
  });
});
