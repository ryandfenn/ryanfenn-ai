import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sessionIsAdmin } from "@/lib/supabase/admin-access";
import { supabaseConfigured } from "@/lib/supabase/env";
import { ensureProfile, type ProfileRow } from "@/lib/billing/credits";

export interface AdminActor {
  userId: string;
  email: string;
  profile: ProfileRow;
}

export async function requireAdmin(): Promise<{ team: AdminActor } | { response: NextResponse }> {
  if (!supabaseConfigured()) {
    return {
      response: NextResponse.json({ ok: false, error: "Authentication is not configured." }, { status: 503 }),
    };
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    return {
      response: NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 }),
    };
  }

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) {
    return {
      response: NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 }),
    };
  }

  if (!sessionIsAdmin(user)) {
    return {
      response: NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 }),
    };
  }

  const profile = await ensureProfile(user.id, user.email ?? null);
  return {
    team: {
      userId: user.id,
      email: user.email as string,
      profile,
    },
  };
}
