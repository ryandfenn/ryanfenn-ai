"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

const linkClass =
  "text-[11px] uppercase tracking-[0.18em] text-[#94A3B8] hover:text-[#00DFFF] px-3 py-2 transition-colors";

type SessionState =
  | { status: "loading" }
  | { status: "guest" }
  | { status: "user"; email: string | null; isAdmin: boolean };

export function AccountNav() {
  const router = useRouter();
  const [session, setSession] = useState<SessionState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j?.ok && j.data) {
          setSession({ status: "user", email: j.data.email ?? null, isAdmin: Boolean(j.data.isAdmin) });
        } else {
          setSession({ status: "guest" });
        }
      })
      .catch(() => {
        if (!cancelled) setSession({ status: "guest" });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function logout() {
    const supabase = createBrowserSupabase();
    await supabase?.auth.signOut();
    router.replace("/");
    router.refresh();
  }

  if (session.status === "loading") {
    return <nav className="flex items-center gap-1 min-h-9 min-w-[8rem]" aria-hidden />;
  }

  if (session.status === "guest") {
    return (
      <nav className="flex items-center gap-1">
        <Link href="/login" className={linkClass}>
          Sign in
        </Link>
        <Link href="/signup" className={linkClass}>
          Create account
        </Link>
      </nav>
    );
  }

  return (
    <nav className="flex items-center gap-1">
      <Link href="/" className={linkClass} title={session.email || undefined}>
        Account
      </Link>
      <Link href="/billing" className={linkClass}>
        Billing
      </Link>
      {session.isAdmin && (
        <Link href="/admin" className={linkClass}>
          Admin
        </Link>
      )}
      <button type="button" onClick={logout} className={linkClass}>
        Log out
      </button>
    </nav>
  );
}
