import { NextResponse } from "next/server";

/** Env-only freeze so cutover can halt spend before and after the SQL runs. */
export function billingMaintenanceEnabled(): boolean {
  const v = (process.env.BILLING_MAINTENANCE || "").trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes";
}

export function billingMaintenanceResponse(): NextResponse {
  return NextResponse.json(
    {
      ok: false,
      error: "Billing is paused for a short maintenance window. Please try again in a few minutes.",
      code: "BILLING_MAINTENANCE",
      data: null,
    },
    { status: 503 },
  );
}
