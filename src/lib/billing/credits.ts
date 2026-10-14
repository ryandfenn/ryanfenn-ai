import "server-only";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { adminEmails } from "@/lib/supabase/env";
import { FREE_WELCOME_FALLBACK } from "./denomination";
import type { BillableKind } from "./operations";

export { rfFromTotalum } from "./denomination";

export type PlanSlug = "free" | "builder" | "pro";

export interface PlanRow {
  slug: PlanSlug;
  name: string;
  price_cents: number;
  monthly_credits: number;
  max_projects: number;
  stripe_price_id: string | null;
  prompt_reserve: number;
  publish_reserve: number;
  rebuild_reserve: number;
  server_reserve: number;
  domain_reserve: number;
  active: boolean;
}

export interface ProfileRow {
  user_id: string;
  email: string | null;
  role: "customer" | "admin";
  plan: PlanSlug;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
  credits: number;
  credits_reserved: number;
  period_start: string | null;
  period_end: string | null;
  spend_limit: number | null;
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const db = createServiceSupabase();
  const { data } = await db.from("platform_settings").select("value").eq("key", key).maybeSingle();
  const n = Number(data?.value);
  return Number.isFinite(n) ? n : fallback;
}

export async function getPlan(slug: string): Promise<PlanRow | null> {
  const db = createServiceSupabase();
  const { data } = await db.from("plans").select("*").eq("slug", slug).maybeSingle();
  return (data as PlanRow | null) ?? null;
}

export async function getCreditPack(id: string): Promise<{ id: string; credits: number; active: boolean } | null> {
  const db = createServiceSupabase();
  const { data } = await db.from("credit_packs").select("id, credits, active").eq("id", id).maybeSingle();
  return (data as { id: string; credits: number; active: boolean } | null) ?? null;
}

export async function getProfile(userId: string): Promise<ProfileRow | null> {
  const db = createServiceSupabase();
  const { data } = await db.from("profiles").select("*").eq("user_id", userId).maybeSingle();
  return (data as ProfileRow | null) ?? null;
}

export async function ensureProfile(userId: string, email: string | null): Promise<ProfileRow> {
  const existing = await getProfile(userId);
  if (existing) {
    const emails = adminEmails();
    if (email && emails.includes(email.toLowerCase()) && existing.role !== "admin") {
      const db = createServiceSupabase();
      await db.from("profiles").update({ role: "admin", email }).eq("user_id", userId);
      return { ...existing, role: "admin", email };
    }
    return existing;
  }
  const db = createServiceSupabase();
  const plan = await getPlan("free");
  const role = email && adminEmails().includes(email.toLowerCase()) ? "admin" : "customer";
  const credits = plan?.monthly_credits ?? FREE_WELCOME_FALLBACK;
  const row = {
    user_id: userId,
    email,
    role,
    plan: "free" as const,
    credits,
    credits_reserved: 0,
    period_start: new Date().toISOString(),
    period_end: new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  };
  await db.from("profiles").upsert(row, { onConflict: "user_id" });
  return (await getProfile(userId))!;
}

export function reserveForKind(plan: PlanRow, kind: BillableKind): number {
  switch (kind) {
    case "launch":
    case "prompt":
      return plan.prompt_reserve;
    case "publish":
      return plan.publish_reserve;
    case "rebuild":
    case "files":
      return plan.rebuild_reserve;
    case "server":
      return plan.server_reserve;
    case "domain":
      return plan.domain_reserve;
    case "export":
    case "import":
      return Math.max(plan.rebuild_reserve, 2);
    case "restore":
      return plan.prompt_reserve;
    default:
      return plan.prompt_reserve;
  }
}

export async function countUserProjects(userId: string): Promise<number> {
  const db = createServiceSupabase();
  const { count } = await db.from("projects").select("project_id", { count: "exact", head: true }).eq("user_id", userId);
  return count ?? 0;
}

export async function listOwnedProjectIds(userId: string): Promise<Set<string>> {
  const db = createServiceSupabase();
  const { data } = await db.from("projects").select("project_id").eq("user_id", userId);
  return new Set((data ?? []).map((r) => r.project_id as string));
}

export async function claimProject(userId: string, projectId: string): Promise<void> {
  const db = createServiceSupabase();
  await db.from("projects").upsert({ project_id: projectId, user_id: userId }, { onConflict: "project_id" });
}

export async function userOwnsProject(userId: string, projectId: string): Promise<boolean> {
  const db = createServiceSupabase();
  const { data } = await db.from("projects").select("project_id").eq("project_id", projectId).eq("user_id", userId).maybeSingle();
  return Boolean(data);
}

export async function reserveCredits(opts: {
  userId: string;
  amount: number;
  key: string;
  projectId?: string | null;
  operation?: string;
}): Promise<{ ok: true; reservationId: string } | { ok: false; code: "INSUFFICIENT_CREDITS" | "UNKNOWN"; error: string }> {
  const db = createServiceSupabase();
  const { data, error } = await db.rpc("reserve_credits", {
    p_user_id: opts.userId,
    p_amount: opts.amount,
    p_idempotency_key: opts.key,
    p_project_id: opts.projectId ?? null,
    p_operation: opts.operation ?? null,
  });
  if (error) {
    if (/INSUFFICIENT_CREDITS/i.test(error.message)) {
      return { ok: false, code: "INSUFFICIENT_CREDITS", error: "You don't have enough RyanFenn.ai credits for that." };
    }
    console.error("[credits] reserve failed", error);
    return { ok: false, code: "UNKNOWN", error: "Could not reserve credits." };
  }
  return { ok: true, reservationId: data as string };
}

export async function captureCredits(reservationId: string, actual: number): Promise<void> {
  const db = createServiceSupabase();
  const { error } = await db.rpc("capture_credits", {
    p_reservation_id: reservationId,
    p_actual: Math.max(0, Math.round(actual)),
  });
  if (error) console.error("[credits] capture failed", error);
}

export async function releaseCredits(reservationId: string): Promise<void> {
  const db = createServiceSupabase();
  const { error } = await db.rpc("release_credits", { p_reservation_id: reservationId });
  if (error) console.error("[credits] release failed", error);
}

export async function grantCredits(opts: {
  userId: string;
  amount: number;
  kind: string;
  note: string;
  stripeEventId?: string | null;
  key: string;
}): Promise<number | null> {
  const db = createServiceSupabase();
  const { data, error } = await db.rpc("grant_credits", {
    p_user_id: opts.userId,
    p_amount: opts.amount,
    p_kind: opts.kind,
    p_note: opts.note,
    p_stripe_event_id: opts.stripeEventId ?? null,
    p_idempotency_key: opts.key,
  });
  if (error) {
    console.error("[credits] grant failed", error);
    return null;
  }
  return data as number;
}

export async function recordTotalumSpend(projectId: string, totalumCredits: number): Promise<void> {
  if (!projectId || !totalumCredits) return;
  const db = createServiceSupabase();
  const { data } = await db.from("projects").select("totalum_spent").eq("project_id", projectId).maybeSingle();
  const current = Number(data?.totalum_spent ?? 0);
  await db.from("projects").update({ totalum_spent: current + totalumCredits }).eq("project_id", projectId);
}

export async function hitRateLimit(subject: string, action: string, max: number, windowMs: number): Promise<boolean> {
  const db = createServiceSupabase();
  const since = new Date(Date.now() - windowMs).toISOString();
  const { count } = await db
    .from("rate_limit_events")
    .select("id", { count: "exact", head: true })
    .eq("subject", subject)
    .eq("action", action)
    .gte("created_at", since);
  if ((count ?? 0) >= max) return true;
  await db.from("rate_limit_events").insert({ subject, action });
  return false;
}

export async function attachReservationProject(reservationId: string, projectId: string): Promise<void> {
  const db = createServiceSupabase();
  await db.from("credit_reservations").update({ project_id: projectId }).eq("id", reservationId);
}

export async function findOpenReservation(userId: string, projectId: string) {
  const db = createServiceSupabase();
  const { data } = await db
    .from("credit_reservations")
    .select("*")
    .eq("user_id", userId)
    .eq("project_id", projectId)
    .eq("status", "reserved")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data as { id: string; amount: number } | null;
}
