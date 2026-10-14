import { NextResponse } from "next/server";
import { authFailed, resolveVcaasContext, type VcaasTeam } from "@/app/api/vcaas/_shared";

export async function requireAdmin(): Promise<{ team: VcaasTeam } | { response: NextResponse }> {
  const auth = await resolveVcaasContext();
  if (authFailed(auth)) return { response: auth.response };
  if (auth.team.profile.role !== "admin") {
    return {
      response: NextResponse.json({ ok: false, error: "Admin only." }, { status: 403 }),
    };
  }
  return { team: auth.team };
}
