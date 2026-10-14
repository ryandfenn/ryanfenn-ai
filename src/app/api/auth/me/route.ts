import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { sessionIsAdmin } from "@/lib/supabase/admin-access";
import { supabaseConfigured } from "@/lib/supabase/env";

export async function GET() {
  if (!supabaseConfigured()) {
    return NextResponse.json({ ok: false, error: "Authentication is not configured." }, { status: 503 });
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ ok: false, error: "Sign in required." }, { status: 401 });
  }

  return NextResponse.json({
    ok: true,
    data: {
      email: user.email ?? null,
      isAdmin: sessionIsAdmin(user),
    },
  });
}
