/**
 * Catch-all proxy: `/api/vcaas/<path>` → Totalum VCaaS with the operator key.
 * Auth, ownership, RyanFenn.ai credit reservation, and list filtering live here.
 *
 * 📖 https://www.totalum.app/totalum-api.md
 */
import { getVcaasApiKey, vcaasRequest, VcaasPathError } from "@/lib/vcaas-server";
import { normalizeVcaasError, toErrorEnvelope } from "@/lib/vcaas-errors";
import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import {
  authFailed,
  enforceProjectScope,
  resolveVcaasContext,
  type VcaasTeam,
} from "../_shared";
import {
  captureCredits,
  attachReservationProject,
  claimProject,
  countUserProjects,
  findOpenReservation,
  getPlan,
  getSettingNumber,
  hitRateLimit,
  listOwnedProjectIds,
  recordTotalumSpend,
  releaseCredits,
  reserveCredits,
  reserveForKind,
  rfFromTotalum,
} from "@/lib/billing/credits";
import {
  classifyVcaasCall,
  isAgentStatusPath,
  isProjectCreate,
  isProjectListGet,
} from "@/lib/billing/operations";

interface VcaasApiResponse {
  errors:
    | {
        errorCode: string;
        errorMessage: string;
        errorDetails?: { reason?: string; httpStatus?: number };
      }
    | null;
  data: unknown;
}

function idempotencyKey(userId: string, method: string, path: string, body: string | undefined): string {
  const hash = createHash("sha256").update(`${userId}|${method}|${path}|${body || ""}`).digest("hex").slice(0, 40);
  return `vcaas:${hash}`;
}

function platformCapacityError() {
  return NextResponse.json(
    {
      ok: false,
      error: "RyanFenn.ai is temporarily unable to run this action. Please try again shortly.",
      code: "UNKNOWN",
      data: null,
    },
    { status: 503 },
  );
}

async function maybeInjectLimits(method: string, path: string[], body: string | undefined): Promise<string | undefined> {
  if (method !== "POST" || path.join("/") !== "projects/launch" || !body) return body;
  try {
    const json = JSON.parse(body) as Record<string, unknown>;
    if (!json.creditLimits) {
      const dev = await getSettingNumber("totalum_dev_limit", 40);
      const infra = await getSettingNumber("totalum_infra_limit", 25);
      json.creditLimits = {
        maxDevelopmentCreditsPerMonth: dev,
        maxInfrastructureCreditsPerMonth: infra,
      };
      return JSON.stringify(json);
    }
  } catch {
    return body;
  }
  return body;
}

async function afterCreate(team: VcaasTeam, method: string, path: string[], data: unknown) {
  if (!isProjectCreate(method, path) || !data || typeof data !== "object") return;
  const id = (data as { projectId?: string }).projectId;
  if (id) await claimProject(team.userId, id);
}

async function reconcileStatus(team: VcaasTeam, projectId: string, data: unknown) {
  if (!data || typeof data !== "object") return;
  const rec = data as { status?: string; creditsSpent?: number };
  if (rec.status !== "done" && rec.status !== "error") return;
  const open = await findOpenReservation(team.userId, projectId);
  if (!open) return;
  if (rec.status === "error") {
    await releaseCredits(open.id);
    return;
  }
  const spent = Number(rec.creditsSpent || 0);
  const multiplier = await getSettingNumber("cost_multiplier", 2);
  const actual = spent > 0 ? rfFromTotalum(spent, multiplier) : open.amount;
  await captureCredits(open.id, actual);
  if (spent > 0) await recordTotalumSpend(projectId, spent);
}

async function handleRequest(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  let reservationId: string | null = null;
  try {
    const { path } = await params;
    const vcaasPath = "/" + path.join("/");

    const auth = await resolveVcaasContext();
    if (authFailed(auth)) return auth.response;
    const scoped = await enforceProjectScope(auth.team, req.method, path);
    if (scoped) return scoped;

    const url = new URL(req.url);
    const queryString = url.searchParams.toString();
    const fullPath = queryString ? `${vcaasPath}?${queryString}` : vcaasPath;

    let body: string | undefined;
    if (req.method !== "GET" && req.method !== "HEAD") {
      try {
        const text = await req.text();
        if (text) body = text;
      } catch {
        /* no body */
      }
    }
    body = await maybeInjectLimits(req.method, path, body);

    const billable = classifyVcaasCall(req.method, path);
    if (billable) {
      const plan = await getPlan(auth.team.profile.plan);
      if (!plan) {
        return NextResponse.json(
          { ok: false, error: "Your plan is not available.", code: "UNKNOWN", data: null },
          { status: 500 },
        );
      }

      if (isProjectCreate(req.method, path)) {
        const existing = await countUserProjects(auth.team.userId);
        if (existing >= plan.max_projects) {
          return NextResponse.json(
            {
              ok: false,
              error: `Your ${plan.name} plan includes ${plan.max_projects} project${plan.max_projects === 1 ? "" : "s"}. Upgrade to create another.`,
              code: "INSUFFICIENT_CREDITS",
              data: null,
            },
            { status: 402 },
          );
        }
        if (plan.slug === "free") {
          const max = await getSettingNumber("free_launches_per_day", 3);
          const limited = await hitRateLimit(auth.team.userId, "launch", max, 24 * 3600 * 1000);
          if (limited) {
            return NextResponse.json(
              {
                ok: false,
                error: "Free accounts can start a limited number of builds per day. Upgrade to keep building.",
                code: "INSUFFICIENT_CREDITS",
                data: null,
              },
              { status: 402 },
            );
          }
        }
        const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
        const ipLimited = await hitRateLimit(`ip:${ip}`, "launch", 8, 24 * 3600 * 1000);
        if (ipLimited) {
          return NextResponse.json(
            { ok: false, error: "Too many new projects from this network. Try again later.", code: "UNKNOWN", data: null },
            { status: 429 },
          );
        }
      }

      const amount = reserveForKind(plan, billable.kind);
      const reserved = await reserveCredits({
        userId: auth.team.userId,
        amount,
        key: idempotencyKey(auth.team.userId, req.method, fullPath, body),
        projectId: billable.projectId,
        operation: billable.kind,
      });
      if (reserved.ok === false) {
        return NextResponse.json(
          { ok: false, error: reserved.error, code: reserved.code, data: null },
          { status: reserved.code === "INSUFFICIENT_CREDITS" ? 402 : 500 },
        );
      }
      reservationId = reserved.reservationId;
    }

    const response = await vcaasRequest(fullPath, {
      method: req.method,
      body,
    });

    const raw = await response.text();
    let json: Partial<VcaasApiResponse> & { error?: unknown; message?: unknown } = {};
    try {
      json = JSON.parse(raw) as typeof json;
    } catch {
      if (response.ok) throw new Error(`upstream answered ${response.status} with a non-JSON body`);
    }

    if (!response.ok && !json.errors) {
      if (reservationId) await releaseCredits(reservationId);
      const keyRefused = response.status === 401 || response.status === 403;
      const operatorEmpty = response.status === 402;
      if (operatorEmpty) return platformCapacityError();
      const upstreamMessage =
        typeof json.error === "string" ? json.error : typeof json.message === "string" ? json.message : "";
      const message = keyRefused
        ? getVcaasApiKey()
          ? "RyanFenn.ai cannot reach the build service right now. Please try again shortly."
          : "RyanFenn.ai is not fully configured yet."
        : upstreamMessage || `The build service answered ${response.status}.`;
      const normalized = normalizeVcaasError(
        { errorCode: keyRefused ? "INVALID_API_KEY" : undefined, errorMessage: message },
        response.status
      );
      return NextResponse.json(toErrorEnvelope(normalized), { status: normalized.status });
    }

    if (json.errors) {
      if (reservationId) await releaseCredits(reservationId);
      const code = json.errors.errorCode || "";
      if (code === "INSUFFICIENT_CREDITS" || code === "VCAAS_INSUFFICIENT_CREDITS") {
        return platformCapacityError();
      }
      const normalized = normalizeVcaasError(json.errors, response.status);
      return NextResponse.json(toErrorEnvelope(normalized), { status: normalized.status });
    }

    const data = json.data;

    if (isProjectListGet(req.method, path) && data && typeof data === "object") {
      const owned = await listOwnedProjectIds(auth.team.userId);
      const bag = data as { projects?: { projectId: string }[]; items?: { projectId: string }[] };
      if (Array.isArray(bag.projects)) bag.projects = bag.projects.filter((p) => owned.has(p.projectId));
      if (Array.isArray(bag.items)) bag.items = bag.items.filter((p) => owned.has(p.projectId));
      if (Array.isArray(data)) {
        const filtered = (data as { projectId: string }[]).filter((p) => owned.has(p.projectId));
        return NextResponse.json({ ok: true, data: filtered }, { status: 200 });
      }
    }

    await afterCreate(auth.team, req.method, path, data);

    const statusProject = isAgentStatusPath(req.method, path);
    if (statusProject) await reconcileStatus(auth.team, statusProject, data);

    if (reservationId && billable?.kind === "launch") {
      const createdId = data && typeof data === "object" ? (data as { projectId?: string }).projectId : null;
      if (createdId) await attachReservationProject(reservationId, createdId);
      reservationId = null;
    } else if (reservationId && billable?.kind === "prompt") {
      reservationId = null;
    } else if (reservationId && billable) {
      await captureCredits(reservationId, reserveForKind((await getPlan(auth.team.profile.plan))!, billable.kind));
      reservationId = null;
    }

    return NextResponse.json(
      { ok: true, data },
      { status: 200 }
    );
  } catch (error) {
    if (reservationId) await releaseCredits(reservationId);
    if (error instanceof VcaasPathError) {
      return NextResponse.json(
        { ok: false, error: "Invalid path", code: "VALIDATION", data: null },
        { status: 400 }
      );
    }
    console.error(`[vcaas] ${req.method} proxy failed:`, error);
    return NextResponse.json(
      { ok: false, error: "Internal server error", code: "UNKNOWN", data: null },
      { status: 500 }
    );
  }
}

export const GET = handleRequest;
export const POST = handleRequest;
export const PUT = handleRequest;
export const DELETE = handleRequest;
export const PATCH = handleRequest;
