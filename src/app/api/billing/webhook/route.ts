import { NextRequest, NextResponse } from "next/server";
import type Stripe from "stripe";
import { createServiceSupabase } from "@/lib/supabase/admin";
import { getStripe, stripeConfigured } from "@/lib/billing/stripe";
import { getCreditPack, getPlan, getSettingNumber, grantCredits } from "@/lib/billing/credits";
import { CREDIT_DENOMINATION_KEY, packGrantAmount } from "@/lib/billing/denomination";
import { billingMaintenanceEnabled } from "@/lib/billing/maintenance";

export const runtime = "nodejs";

async function alreadyProcessed(eventId: string): Promise<boolean> {
  const db = createServiceSupabase();
  const { data } = await db.from("stripe_events").select("event_id").eq("event_id", eventId).maybeSingle();
  if (data) return true;
  const { error } = await db.from("stripe_events").insert({ event_id: eventId, type: "pending" });
  return Boolean(error);
}

async function markProcessed(eventId: string, type: string) {
  const db = createServiceSupabase();
  await db.from("stripe_events").upsert({ event_id: eventId, type, processed_at: new Date().toISOString() });
}

async function applySubscription(userId: string, planSlug: string, subscriptionId: string, status: string) {
  const db = createServiceSupabase();
  const plan = await getPlan(planSlug);
  await db
    .from("profiles")
    .update({
      plan: planSlug,
      stripe_subscription_id: subscriptionId,
      subscription_status: status,
      period_start: new Date().toISOString(),
      period_end: new Date(Date.now() + 31 * 24 * 3600 * 1000).toISOString(),
    })
    .eq("user_id", userId);
  if (plan && (status === "active" || status === "trialing")) {
    await grantCredits({
      userId,
      amount: plan.monthly_credits,
      kind: "grant",
      note: `${plan.name} monthly credits`,
      key: `sub:${subscriptionId}:${new Date().toISOString().slice(0, 7)}`,
    });
  }
}

export async function POST(req: NextRequest) {
  if (!stripeConfigured() || !process.env.STRIPE_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook is not configured." }, { status: 503 });
  }
  const stripe = getStripe();
  const sig = req.headers.get("stripe-signature");
  const raw = await req.text();
  if (!sig) return NextResponse.json({ error: "Missing signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error("[stripe] signature failed", err);
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  if (billingMaintenanceEnabled()) {
    return NextResponse.json({ error: "Billing maintenance." }, { status: 503 });
  }

  if (await alreadyProcessed(event.id)) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  const db = createServiceSupabase();

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const userId = session.metadata?.userId;
        if (!userId) break;
        if (session.mode === "payment" && session.metadata?.kind === "pack") {
          const packId = session.metadata.packId;
          const pack = packId ? await getCreditPack(packId) : null;
          const denomination = await getSettingNumber(CREDIT_DENOMINATION_KEY, 1);
          const credits = packGrantAmount({
            packCredits: pack?.credits,
            metadataCredits: Number(session.metadata.credits || 0),
            denomination,
          });
          if (credits && credits > 0) {
            await grantCredits({
              userId,
              amount: credits,
              kind: "purchase",
              note: packId ? `Credit pack ${packId}` : "Credit pack",
              stripeEventId: event.id,
              key: `stripe:${event.id}`,
            });
          }
        }
        if (session.mode === "subscription") {
          const plan = session.metadata?.plan || "builder";
          const subId = typeof session.subscription === "string" ? session.subscription : session.subscription?.id;
          if (subId) await applySubscription(userId, plan, subId, "active");
        }
        break;
      }
      case "invoice.paid": {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } };
        const subRaw = invoice.subscription;
        const subId = typeof subRaw === "string" ? subRaw : subRaw?.id;
        if (!subId || invoice.billing_reason === "subscription_create") break;
        const { data: profile } = await db.from("profiles").select("user_id, plan").eq("stripe_subscription_id", subId).maybeSingle();
        if (profile) {
          const plan = await getPlan(profile.plan);
          if (plan) {
            await grantCredits({
              userId: profile.user_id,
              amount: plan.monthly_credits,
              kind: "grant",
              note: "Subscription renewal",
              stripeEventId: event.id,
              key: `stripe:${event.id}`,
            });
          }
          await db.from("profiles").update({ subscription_status: "active" }).eq("user_id", profile.user_id);
        }
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice & { subscription?: string | { id: string } };
        const subRaw = invoice.subscription;
        const subId = typeof subRaw === "string" ? subRaw : subRaw?.id;
        if (subId) {
          await db.from("profiles").update({ subscription_status: "past_due" }).eq("stripe_subscription_id", subId);
        }
        break;
      }
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const userId = sub.metadata?.userId;
        const status = event.type === "customer.subscription.deleted" ? "canceled" : sub.status;
        const plan = status === "canceled" || status === "unpaid" ? "free" : sub.metadata?.plan || undefined;
        const patch: Record<string, unknown> = { subscription_status: status };
        if (plan) patch.plan = plan;
        if (userId) await db.from("profiles").update(patch).eq("user_id", userId);
        else await db.from("profiles").update(patch).eq("stripe_subscription_id", sub.id);
        break;
      }
      case "charge.refunded": {
        const charge = event.data.object as Stripe.Charge;
        const { data: profile } = await db
          .from("profiles")
          .select("user_id")
          .eq("stripe_customer_id", typeof charge.customer === "string" ? charge.customer : "")
          .maybeSingle();
        if (profile) {
          await db.from("credit_ledger").insert({
            user_id: profile.user_id,
            kind: "refund",
            amount: 0,
            note: "Stripe refund recorded — review wallet in admin (no automatic clawback)",
            stripe_event_id: event.id,
            idempotency_key: `stripe:${event.id}`,
          });
        }
        break;
      }
      default:
        break;
    }
    await markProcessed(event.id, event.type);
  } catch (err) {
    console.error("[stripe] handler failed", event.type, err);
    return NextResponse.json({ error: "Handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
