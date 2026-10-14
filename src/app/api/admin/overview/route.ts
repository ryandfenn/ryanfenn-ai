import { NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "../_guard";

export async function GET() {
  const gate = await requireAdmin();
  if ("response" in gate) return gate.response;
  const db = createServiceSupabase();
  const { data: customers } = await db
    .from("profiles")
    .select("user_id, email, role, plan, credits, credits_reserved, subscription_status, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  const { data: projects } = await db
    .from("projects")
    .select("project_id, user_id, totalum_spent, rf_spent, created_at")
    .order("created_at", { ascending: false })
    .limit(500);
  const { data: plans } = await db.from("plans").select("*").order("price_cents");
  const { data: packs } = await db.from("credit_packs").select("*").order("sort_order");
  const { data: settings } = await db.from("platform_settings").select("*");
  const totalum = (projects ?? []).reduce((s, p) => s + Number(p.totalum_spent || 0), 0);
  const rf = (projects ?? []).reduce((s, p) => s + Number(p.rf_spent || 0), 0);
  return NextResponse.json({
    ok: true,
    data: {
      customers: customers ?? [],
      projects: projects ?? [],
      plans: plans ?? [],
      packs: packs ?? [],
      settings: Object.fromEntries((settings ?? []).map((s) => [s.key, s.value])),
      totals: { customers: customers?.length ?? 0, projects: projects?.length ?? 0, totalumSpent: totalum, rfSpent: rf },
    },
  });
}
