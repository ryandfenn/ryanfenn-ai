import { NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { supabaseConfigured } from "@/lib/supabase/env";
import { ensureProfile, userOwnsProject, type ProfileRow } from "@/lib/billing/credits";

export { isRoutableProjectSlug } from "@/lib/project-slug";

export interface VcaasContext {
  accountUserId: string;
}

export interface VcaasTeam {
  userId: string;
  email: string | null;
  profile: ProfileRow;
}

export interface VcaasAuthOk {
  ok: true;
  ctx: VcaasContext;
  team: VcaasTeam;
}

export type VcaasAuthResult = VcaasAuthOk | { ok: false; response: NextResponse };

export type VcaasAuthFailed = Extract<VcaasAuthResult, { ok: false }>;

export function authFailed(result: VcaasAuthResult): result is VcaasAuthFailed {
  return result.ok === false;
}

export async function resolveVcaasContext(): Promise<VcaasAuthResult> {
  if (!supabaseConfigured()) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Authentication is not configured yet.", code: "UNAUTHENTICATED", data: null },
        { status: 503 },
      ),
    };
  }

  const supabase = await createServerSupabase();
  if (!supabase) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Sign in required.", code: "UNAUTHENTICATED", data: null },
        { status: 401 },
      ),
    };
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { ok: false, error: "Sign in required.", code: "UNAUTHENTICATED", data: null },
        { status: 401 },
      ),
    };
  }

  const profile = await ensureProfile(user.id, user.email ?? null);
  return {
    ok: true,
    ctx: { accountUserId: user.id },
    team: { userId: user.id, email: user.email ?? null, profile },
  };
}

/**
 * Blocks `/projects/:id/...` unless that project is in the caller's RyanFenn.ai table.
 * List/create/launch have no id yet — those are handled in the catch-all.
 */
export async function enforceProjectScope(
  team: VcaasTeam,
  _method: string,
  path: string[],
): Promise<NextResponse | null> {
  if (path[0] !== "projects" || !path[1]) return null;
  if (path[1] === "launch" || path[1] === "import") return null;
  if (path.length >= 3 && path[1] === "credit-limits") return null;

  const projectId = path[1];
  const owns = await userOwnsProject(team.userId, projectId);
  if (!owns) {
    return NextResponse.json(
      { ok: false, error: "Project not found.", code: "PROJECT_NOT_FOUND", data: null },
      { status: 404 },
    );
  }
  return null;
}
