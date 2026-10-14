import { NextRequest, NextResponse } from "next/server";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { requireAdmin } from "../_guard";

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if ("response" in gate) return gate.response;
  const body = (await req.json().catch(() => ({}))) as {
    settings?: Record<string, unknown>;
    plans?: Array<Record<string, unknown>>;
    packs?: Array<Record<string, unknown>>;
  };
  const db = createServiceSupabase();
  if (body.settings) {
    for (const [key, value] of Object.entries(body.settings)) {
      await db.from("platform_settings").upsert({ key, value, updated_at: new Date().toISOString() });
    }
  }
  if (body.plans) {
    for (const plan of body.plans) {
      if (!plan.slug) continue;
      await db.from("plans").upsert(plan, { onConflict: "slug" });
    }
  }
  if (body.packs) {
    for (const pack of body.packs) {
      if (!pack.id) continue;
      await db.from("credit_packs").update(pack).eq("id", pack.id);
    }
  }
  return NextResponse.json({ ok: true });
}
