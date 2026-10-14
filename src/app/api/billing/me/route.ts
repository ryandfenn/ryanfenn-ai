import { NextResponse } from "next/server";
import { authFailed, resolveVcaasContext } from "@/app/api/vcaas/_shared";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { countUserProjects, getPlan } from "@/lib/billing/credits";

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
  const { data: monthRows } = await db
    .from("credit_ledger")
    .select("kind, amount")
    .eq("user_id", auth.team.userId)
    .gte("created_at", monthAgo.toISOString());
  const spentThisMonth = (monthRows ?? [])
    .filter((r) => r.kind === "capture" || (r.kind === "reserve" && r.amount < 0))
    .reduce((sum, r) => sum + Math.abs(Number(r.amount) || 0), 0);
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
