"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandWordmark } from "@/components/BrandMark";
import { AccountNav } from "@/components/account/AccountNav";
import { Button } from "@/components/ui/button";

type BillingData = {
  profile: { email: string | null; plan: string; credits: number; credits_reserved: number; role: string; subscription_status: string | null };
  plan: { name: string; monthly_credits: number; price_cents: number; max_projects: number } | null;
  projects: number;
  spentThisMonth: number;
  stripeReady: boolean;
  ledger: { id: string; kind: string; amount: number; note: string | null; created_at: string }[];
  packs: { id: string; name: string; credits: number; price_cents: number; stripe_price_id: string | null }[];
  plans: { slug: string; name: string; price_cents: number; monthly_credits: number; max_projects: number; stripe_price_id: string | null }[];
};

function dollars(cents: number) {
  return `$${(cents / 100).toFixed(0)}`;
}

export default function BillingPage() {
  const [data, setData] = useState<BillingData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/me")
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) setError(j.error || "Could not load billing.");
        else setData(j.data);
      })
      .catch(() => setError("Could not load billing."));
  }, []);

  async function checkout(body: Record<string, string>) {
    setBusy(JSON.stringify(body));
    const res = await fetch("/api/billing/checkout", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json();
    setBusy(null);
    if (json.data?.url) window.location.href = json.data.url;
    else setError(json.error || "Checkout is not ready. Add Stripe price IDs in the admin settings.");
  }

  async function portal() {
    setBusy("portal");
    const res = await fetch("/api/billing/portal", { method: "POST" });
    const json = await res.json();
    setBusy(null);
    if (json.data?.url) window.location.href = json.data.url;
    else setError(json.error || "No Stripe customer yet. Subscribe first.");
  }

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-cyan-400/10 bg-[#05080D]/90">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link href="/"><BrandWordmark /></Link>
          <AccountNav email={data?.profile.email} isAdmin={data?.profile.role === "admin"} />
        </div>
      </header>
      <div className="max-w-5xl mx-auto px-4 sm:px-6 py-10 space-y-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.42em] text-[#00DFFF] mb-3">Account</p>
          <h1 className="font-display text-4xl font-extrabold text-white">Billing</h1>
          <p className="text-[#94A3B8] mt-2">RyanFenn.ai credits and plans. Totalum stays behind the scenes.</p>
        </div>
        {error && <p className="text-sm text-[#ff4d6d]">{error}</p>}
        {!data ? (
          <div className="ei-panel h-40 animate-pulse" />
        ) : (
          <>
            <div className="grid sm:grid-cols-3 gap-4">
              <div className="ei-panel p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#94A3B8]">Plan</p>
                <p className="font-display text-2xl text-white mt-2">{data.plan?.name || data.profile.plan}</p>
                <p className="text-xs text-[#94A3B8] mt-1">{data.profile.subscription_status || "Free tier"}</p>
              </div>
              <div className="ei-panel p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#94A3B8]">Credits</p>
                <p className="font-display text-2xl text-[#00DFFF] mt-2">{data.profile.credits}</p>
                <p className="text-xs text-[#94A3B8] mt-1">{data.profile.credits_reserved} reserved · {data.plan?.monthly_credits ?? 0}/mo included</p>
              </div>
              <div className="ei-panel p-5">
                <p className="text-[11px] uppercase tracking-[0.18em] text-[#94A3B8]">This month</p>
                <p className="font-display text-2xl text-white mt-2">{data.spentThisMonth}</p>
                <p className="text-xs text-[#94A3B8] mt-1">{data.projects} project{data.projects === 1 ? "" : "s"}</p>
              </div>
            </div>

            <div className="ei-panel p-6">
              <h2 className="font-display text-lg text-white mb-4">Upgrade</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                {data.plans.map((p) => (
                  <div key={p.slug} className={`border rounded-sm p-4 ${p.slug === data.profile.plan ? "border-[#00DFFF]" : "border-cyan-400/15"}`}>
                    <p className="text-white font-semibold">{p.name}</p>
                    <p className="text-[#00DFFF] text-sm mt-1">{p.price_cents === 0 ? "Free" : `${dollars(p.price_cents)}/mo`}</p>
                    <p className="text-xs text-[#94A3B8] mt-2">{p.monthly_credits} credits / month · {p.max_projects} projects</p>
                    {p.slug !== "free" && p.slug !== data.profile.plan && (
                      <Button className="mt-4 w-full" disabled={!!busy} onClick={() => checkout({ plan: p.slug })}>
                        {busy?.includes(p.slug) ? "Redirecting…" : `Choose ${p.name}`}
                      </Button>
                    )}
                    {p.slug === data.profile.plan && <p className="text-[11px] text-[#00DFFF] mt-4 uppercase tracking-widest">Current</p>}
                  </div>
                ))}
              </div>
              <Button variant="outline" className="mt-4" onClick={portal} disabled={!!busy}>Manage subscription</Button>
            </div>

            <div className="ei-panel p-6">
              <h2 className="font-display text-lg text-white mb-4">Buy credits</h2>
              <div className="grid sm:grid-cols-3 gap-3">
                {data.packs.map((pack) => (
                  <div key={pack.id} className="border border-cyan-400/15 rounded-sm p-4">
                    <p className="text-white font-semibold">{pack.name}</p>
                    <p className="text-[#00DFFF] text-sm mt-1">{pack.credits} credits · {dollars(pack.price_cents)}</p>
                    <Button className="mt-4 w-full" variant="secondary" disabled={!!busy} onClick={() => checkout({ packId: pack.id })}>
                      Purchase
                    </Button>
                  </div>
                ))}
              </div>
              {!data.stripeReady && <p className="text-xs text-[#94A3B8] mt-4">Stripe is not connected yet. Checkout will activate once keys are in the environment.</p>}
            </div>

            <div className="ei-panel p-6">
              <h2 className="font-display text-lg text-white mb-4">History</h2>
              <div className="space-y-2 max-h-[420px] overflow-auto">
                {data.ledger.length === 0 && <p className="text-sm text-[#94A3B8]">No transactions yet.</p>}
                {data.ledger.map((row) => (
                  <div key={row.id} className="flex justify-between text-sm border-b border-cyan-400/10 py-2">
                    <div>
                      <p className="text-white">{row.kind}</p>
                      <p className="text-[11px] text-[#94A3B8]">{row.note} · {new Date(row.created_at).toLocaleString()}</p>
                    </div>
                    <p className={row.amount < 0 ? "text-[#ff4d6d]" : "text-[#00DFFF]"}>{row.amount > 0 ? `+${row.amount}` : row.amount}</p>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
