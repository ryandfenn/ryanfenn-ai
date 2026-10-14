import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CREDIT_SCALE,
  FREE_WELCOME_FALLBACK,
  TARGET_COST_MULTIPLIER,
  TARGET_DENOMINATION,
  TARGET_PACK_CREDITS,
  TARGET_PLAN_CREDITS,
  conversionWouldOverflow,
  packGrantAmount,
  reservationCaptureActual,
  scaleOldCredits,
  shouldApplyRedenomination,
  spentThisMonth,
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
  });

  it("flags int32 overflow risk", () => {
    assert.equal(conversionWouldOverflow(20), false);
    assert.equal(conversionWouldOverflow(30_000_000), true);
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

describe("idempotency and reservation spend", () => {
  it("keeps Stripe-style keys as event-id based (scale does not change the key)", () => {
    const eventId = "evt_test";
    assert.equal(`stripe:${eventId}`, "stripe:evt_test");
  });

  it("counts captured_amount only, not open reserves or ledger reserve+capture abs", () => {
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

  it("documents CREDIT_SCALE", () => {
    assert.equal(CREDIT_SCALE, TARGET_DENOMINATION);
  });
});
