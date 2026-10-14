import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "../_guard";
import { billingMaintenanceEnabled, billingMaintenanceResponse } from "@/lib/billing/maintenance";

export async function POST(req: NextRequest) {
  if (billingMaintenanceEnabled()) return billingMaintenanceResponse();
  const gate = await requireAdmin();
  if ("response" in gate) return gate.response;
  const body = (await req.json().catch(() => ({}))) as { userId?: string; amount?: number; note?: string };
  if (!body.userId || !Number.isFinite(body.amount)) {
    return NextResponse.json({ ok: false, error: "userId and amount required" }, { status: 400 });
  }
  const db = createServiceSupabase();
  const { data, error } = await db.rpc("adjust_credits", {
    p_user_id: body.userId,
    p_amount: Math.round(body.amount),
    p_note: body.note || `Admin adjustment by ${gate.team.email || "admin"}`,
    p_idempotency_key: `admin:${body.userId}:${Date.now()}`,
  });
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, data: { credits: data } });
}
