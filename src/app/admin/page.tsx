"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { BrandWordmark } from "@/components/BrandMark";
import { AccountNav } from "@/components/account/AccountNav";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Overview = {
  customers: { user_id: string; email: string | null; plan: string; credits: number; subscription_status: string | null }[];
  projects: { project_id: string; user_id: string; totalum_spent: number; rf_spent: number }[];
  plans: { slug: string; name: string; price_cents: number; monthly_credits: number; max_projects: number; stripe_price_id: string | null }[];
  packs: { id: string; name: string; credits: number; price_cents: number; stripe_price_id: string | null }[];
  settings: Record<string, unknown>;
  totals: { customers: number; projects: number; totalumSpent: number; rfSpent: number };
};

export default function AdminPage() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adjustUser, setAdjustUser] = useState("");
  const [adjustAmt, setAdjustAmt] = useState("50");
  const [multiplier, setMultiplier] = useState("2");
  const [devLimit, setDevLimit] = useState("40");
  const [infraLimit, setInfraLimit] = useState("25");
  const [cap, setCap] = useState("5000");

  useEffect(() => {
    fetch("/api/admin/overview")
      .then((r) => r.json())
      .then((j) => {
        if (!j.ok) setError(j.error || "Admin only.");
        else {
          setData(j.data);
          setMultiplier(String(j.data.settings.cost_multiplier ?? 2));
          setDevLimit(String(j.data.settings.totalum_dev_limit ?? 40));
          setInfraLimit(String(j.data.settings.totalum_infra_limit ?? 25));
          setCap(String(j.data.settings.platform_monthly_spend_cap_totalum ?? 5000));
        }
      })
      .catch(() => setError("Could not load admin."));
  }, []);

  async function saveSettings() {
    const res = await fetch("/api/admin/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        settings: {
          cost_multiplier: Number(multiplier),
          totalum_dev_limit: Number(devLimit),
          totalum_infra_limit: Number(infraLimit),
          platform_monthly_spend_cap_totalum: Number(cap),
        },
        plans: data?.plans,
        packs: data?.packs,
      }),
    });
    if (!res.ok) setError("Could not save.");
  }

  async function issueCredits() {
    const res = await fetch("/api/admin/credits", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: adjustUser, amount: Number(adjustAmt), note: "Admin adjustment" }),
    });
    const json = await res.json();
    if (!json.ok) setError(json.error);
    else location.reload();
  }

  const margin = data && data.totals.rfSpent > 0
    ? Math.round((1 - data.totals.totalumSpent / (data.totals.rfSpent / Number(multiplier || 2))) * 100)
    : null;

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-50 border-b border-cyan-400/10 bg-[#05080D]/90">
        <div className="max-w-6xl mx-auto px-4 h-14 flex items-center justify-between">
          <Link href="/"><BrandWordmark /></Link>
          <AccountNav />
        </div>
      </header>
      <div className="max-w-6xl mx-auto px-4 py-10 space-y-8">
        <div>
          <p className="text-[11px] uppercase tracking-[0.42em] text-[#00DFFF] mb-3">Operator</p>
          <h1 className="font-display text-4xl font-extrabold text-white">Admin</h1>
        </div>
        {error && <p className="text-sm text-[#ff4d6d]">{error}</p>}
        {data && (
          <>
            <div className="grid sm:grid-cols-4 gap-4">
              <div className="ei-panel p-4"><p className="text-xs text-[#94A3B8]">Customers</p><p className="text-2xl text-white">{data.totals.customers}</p></div>
              <div className="ei-panel p-4"><p className="text-xs text-[#94A3B8]">Projects</p><p className="text-2xl text-white">{data.totals.projects}</p></div>
              <div className="ei-panel p-4"><p className="text-xs text-[#94A3B8]">Totalum spent</p><p className="text-2xl text-white">{data.totals.totalumSpent}</p></div>
              <div className="ei-panel p-4"><p className="text-xs text-[#94A3B8]">RF credits captured</p><p className="text-2xl text-[#00DFFF]">{data.totals.rfSpent}</p></div>
            </div>
            {margin != null && Number.isFinite(margin) && (
              <p className="text-sm text-[#94A3B8]">Approximate gross margin vs Totalum units at current multiplier: {margin}%</p>
            )}

            <div className="ei-panel p-6 space-y-3">
              <h2 className="font-display text-lg text-white">Platform limits</h2>
              <div className="grid sm:grid-cols-4 gap-3">
                <label className="text-xs text-[#94A3B8]">Cost multiplier<input className="mt-1 w-full" value={multiplier} onChange={(e) => setMultiplier(e.target.value)} /></label>
                <label className="text-xs text-[#94A3B8]">Dev cap / project<input className="mt-1 w-full" value={devLimit} onChange={(e) => setDevLimit(e.target.value)} /></label>
                <label className="text-xs text-[#94A3B8]">Infra cap / project<input className="mt-1 w-full" value={infraLimit} onChange={(e) => setInfraLimit(e.target.value)} /></label>
                <label className="text-xs text-[#94A3B8]">Platform Totalum cap<input className="mt-1 w-full" value={cap} onChange={(e) => setCap(e.target.value)} /></label>
              </div>
              <Button onClick={saveSettings}>Save settings & plans</Button>
            </div>

            <div className="ei-panel p-6">
              <h2 className="font-display text-lg text-white mb-3">Plans</h2>
              {data.plans.map((p, i) => (
                <div key={p.slug} className="grid sm:grid-cols-5 gap-2 mb-2 items-center">
                  <span className="text-white text-sm">{p.name}</span>
                  <Input value={p.monthly_credits} onChange={(e) => {
                    const next = [...data.plans];
                    next[i] = { ...p, monthly_credits: Number(e.target.value) };
                    setData({ ...data, plans: next });
                  }} />
                  <Input value={p.max_projects} onChange={(e) => {
                    const next = [...data.plans];
                    next[i] = { ...p, max_projects: Number(e.target.value) };
                    setData({ ...data, plans: next });
                  }} />
                  <Input value={p.price_cents} onChange={(e) => {
                    const next = [...data.plans];
                    next[i] = { ...p, price_cents: Number(e.target.value) };
                    setData({ ...data, plans: next });
                  }} />
                  <Input placeholder="stripe_price_id" value={p.stripe_price_id || ""} onChange={(e) => {
                    const next = [...data.plans];
                    next[i] = { ...p, stripe_price_id: e.target.value };
                    setData({ ...data, plans: next });
                  }} />
                </div>
              ))}
            </div>

            <div className="ei-panel p-6">
              <h2 className="font-display text-lg text-white mb-3">Issue credits</h2>
              <div className="flex flex-wrap gap-2">
                <Input placeholder="user uuid" value={adjustUser} onChange={(e) => setAdjustUser(e.target.value)} />
                <Input className="w-28" value={adjustAmt} onChange={(e) => setAdjustAmt(e.target.value)} />
                <Button onClick={issueCredits}>Adjust</Button>
              </div>
            </div>

            <div className="ei-panel p-6 overflow-auto">
              <h2 className="font-display text-lg text-white mb-3">Customers</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-[#94A3B8] text-left"><th className="py-2">Email</th><th>Plan</th><th>Credits</th><th>Sub</th></tr></thead>
                <tbody>
                  {data.customers.map((c) => (
                    <tr key={c.user_id} className="border-t border-cyan-400/10">
                      <td className="py-2 text-white">{c.email}<button className="ml-2 text-[10px] text-[#00DFFF]" onClick={() => setAdjustUser(c.user_id)}>use id</button></td>
                      <td>{c.plan}</td>
                      <td className="text-[#00DFFF]">{c.credits}</td>
                      <td>{c.subscription_status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="ei-panel p-6 overflow-auto">
              <h2 className="font-display text-lg text-white mb-3">Projects (Totalum cost)</h2>
              <table className="w-full text-sm">
                <thead><tr className="text-[#94A3B8] text-left"><th className="py-2">Project</th><th>Totalum</th><th>RF captured</th></tr></thead>
                <tbody>
                  {data.projects.map((p) => (
                    <tr key={p.project_id} className="border-t border-cyan-400/10">
                      <td className="py-2 text-white font-mono text-xs">{p.project_id}</td>
                      <td>{p.totalum_spent}</td>
                      <td className="text-[#00DFFF]">{p.rf_spent}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
