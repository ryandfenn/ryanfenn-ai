import { NextRequest, NextResponse } from "next/server";
import { authFailed, resolveVcaasContext } from "@/app/api/vcaas/_shared";
import { appOrigin, getStripe, stripeConfigured } from "@/lib/billing/stripe";

export async function POST(req: NextRequest) {
  const auth = await resolveVcaasContext();
  if (authFailed(auth)) return auth.response;
  if (!stripeConfigured() || !auth.team.profile.stripe_customer_id) {
    return NextResponse.json({ ok: false, error: "No billing account yet." }, { status: 400 });
  }
  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: auth.team.profile.stripe_customer_id,
    return_url: `${appOrigin(req.url)}/billing`,
  });
  return NextResponse.json({ ok: true, data: { url: session.url } });
}
