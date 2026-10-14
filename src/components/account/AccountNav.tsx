"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase/client";

export function AccountNav({ email, isAdmin }: { email?: string | null; isAdmin?: boolean }) {
  const router = useRouter();

  async function logout() {
    const supabase = createBrowserSupabase();
    await supabase?.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  return (
    <nav className="flex items-center gap-1">
      <Link href="/billing" className="text-[11px] uppercase tracking-[0.18em] text-[#94A3B8] hover:text-[#00DFFF] px-3 py-2 transition-colors">
        Billing
      </Link>
      {isAdmin && (
        <Link href="/admin" className="text-[11px] uppercase tracking-[0.18em] text-[#94A3B8] hover:text-[#00DFFF] px-3 py-2 transition-colors">
          Admin
        </Link>
      )}
      <span className="hidden sm:inline text-[11px] text-[#94A3B8]/70 px-2 max-w-[160px] truncate">{email}</span>
      <button onClick={logout} className="text-[11px] uppercase tracking-[0.18em] text-[#94A3B8] hover:text-[#00DFFF] px-3 py-2 transition-colors">
        Log out
      </button>
    </nav>
  );
}
