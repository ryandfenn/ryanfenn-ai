import { NextRequest, NextResponse } from "next/server";
import { authFailed, resolveVcaasContext } from "@/app/api/vcaas/_shared";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { getPlan } from "@/lib/billing/credits";
import { appOrigin, getStripe, stripeConfigured } from "@/lib/billing/stripe";

export async function POST(req: NextRequest) {
  const auth = await resolveVcaasContext();
  if (authFailed(auth)) return auth.response;
  if (!stripeConfigured()) {
    return NextResponse.json({ ok: false, error: "Billing is not configured yet." }, { status: 503 });
  }

  const body = (await req.json().catch(() => ({}))) as { plan?: string; packId?: string };
  const stripe = getStripe();
  const db = createServiceSupabase();
  let customerId = auth.team.profile.stripe_customer_id;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: auth.team.email ?? undefined,
      metadata: { userId: auth.team.userId },
    });
    customerId = customer.id;
    await db.from("profiles").update({ stripe_customer_id: customerId }).eq("user_id", auth.team.userId);
  }

  const origin = appOrigin(req.url);
  const success = `${origin}/billing?checkout=success`;
  const cancel = `${origin}/billing?checkout=cancel`;

  if (body.packId) {
    const { data: pack } = await db.from("credit_packs").select("*").eq("id", body.packId).eq("active", true).maybeSingle();
    if (!pack) return NextResponse.json({ ok: false, error: "Unknown credit pack." }, { status: 400 });
    if (!pack.stripe_price_id) {
      return NextResponse.json({ ok: false, error: "This pack is not linked to Stripe yet." }, { status: 503 });
    }
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      customer: customerId,
      success_url: success,
      cancel_url: cancel,
      line_items: [{ price: pack.stripe_price_id, quantity: 1 }],
      metadata: { userId: auth.team.userId, kind: "pack", packId: pack.id, credits: String(pack.credits) },
    });
    return NextResponse.json({ ok: true, data: { url: session.url } });
  }

  const slug = body.plan === "pro" ? "pro" : body.plan === "builder" ? "builder" : null;
  if (!slug) return NextResponse.json({ ok: false, error: "Choose Builder or Pro." }, { status: 400 });
  const plan = await getPlan(slug);
  if (!plan?.stripe_price_id) {
    return NextResponse.json({ ok: false, error: "This plan is not linked to Stripe yet." }, { status: 503 });
  }
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    success_url: success,
    cancel_url: cancel,
    line_items: [{ price: plan.stripe_price_id, quantity: 1 }],
    metadata: { userId: auth.team.userId, kind: "plan", plan: slug },
    subscription_data: { metadata: { userId: auth.team.userId, plan: slug } },
  });
  return NextResponse.json({ ok: true, data: { url: session.url } });
}
