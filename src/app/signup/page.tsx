"use client";

import { useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase/client";
import { AuthShell } from "@/components/account/AuthCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function SignupPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const supabase = createBrowserSupabase();
    if (!supabase) {
      setError("Authentication is not configured yet.");
      return;
    }
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    setBusy(false);
    if (err) {
      setError(err.message);
      return;
    }
    setDone(true);
  }

  return (
    <AuthShell title="Create your account" subtitle="Start on the Free plan. Upgrade when you are ready to ship more.">
      {done ? (
        <p className="text-sm text-[#94A3B8]">Check your email to confirm your account, then sign in.</p>
      ) : (
        <form onSubmit={onSubmit} className="space-y-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1.5" required />
          </div>
          <div>
            <Label htmlFor="password">Password</Label>
            <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" minLength={8} required />
          </div>
          {error && <p className="text-sm text-[#ff4d6d]">{error}</p>}
          <Button type="submit" className="w-full" disabled={busy}>{busy ? "Creating…" : "Sign up"}</Button>
        </form>
      )}
      <p className="mt-5 text-xs text-[#94A3B8]">
        Already have an account? <Link href="/login" className="text-[#00DFFF] hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
