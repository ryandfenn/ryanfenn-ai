import { NextResponse } from "next/server";
import { authFailed, resolveVcaasContext } from "@/app/api/vcaas/_shared";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { countUserProjects, getPlan } from "@/lib/billing/credits";
import { spentThisMonth as sumCapturedSpend } from "@/lib/billing/denomination";

export async function GET() {
  const auth = await resolveVcaasContext();
  if (authFailed(auth)) return auth.response;
  const db = createServiceSupabase();
  const plan = await getPlan(auth.team.profile.plan);
  const projects = await countUserProjects(auth.team.userId);
  const { data: ledger } = await db
    .from("credit_ledger")
    .select("id, kind, amount, balance_after, note, created_at, project_id")
    .eq("user_id", auth.team.userId)
    .order("created_at", { ascending: false })
    .limit(50);
  const monthAgo = new Date();
  monthAgo.setUTCDate(1);
  monthAgo.setUTCHours(0, 0, 0, 0);
  const monthStart = monthAgo.toISOString();
  const { data: monthRows } = await db
    .from("credit_reservations")
    .select("status, captured_amount, closed_at")
    .eq("user_id", auth.team.userId)
    .eq("status", "captured")
    .gte("closed_at", monthStart);
  const spentThisMonth = sumCapturedSpend(monthRows ?? [], monthStart);
  const { data: packs } = await db.from("credit_packs").select("*").eq("active", true).order("sort_order");
  const { data: plans } = await db.from("plans").select("*").eq("active", true).order("price_cents");

  return NextResponse.json({
    ok: true,
    data: {
      profile: auth.team.profile,
      plan,
      projects,
      ledger: ledger ?? [],
      spentThisMonth,
      packs: packs ?? [],
      plans: plans ?? [],
      stripeReady: Boolean(process.env.STRIPE_SECRET_KEY),
    },
  });
}
