import "server-only";
import Stripe from "stripe";

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
  return new Stripe(key);
}

export function appOrigin(reqUrl: string): string {
  return process.env.NEXT_PUBLIC_APP_URL || new URL(reqUrl).origin;
}
