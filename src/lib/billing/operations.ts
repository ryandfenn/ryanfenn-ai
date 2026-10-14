/**
 * Paths that spend RyanFenn.ai credits (and usually Totalum credits on the operator key).
 * Estimates are plan-configurable; these keys map onto `plans.*_reserve`.
 */

export type BillableKind =
  | "launch"
  | "prompt"
  | "publish"
  | "rebuild"
  | "server"
  | "domain"
  | "export"
  | "import"
  | "restore"
  | "files";

export interface BillableOp {
  kind: BillableKind;
  projectId: string | null;
}

export function classifyVcaasCall(method: string, path: string[]): BillableOp | null {
  const m = method.toUpperCase();
  const joined = path.join("/");

  if (m === "POST" && joined === "projects/launch") return { kind: "launch", projectId: null };
  if (m === "POST" && path.length === 1 && path[0] === "projects") return { kind: "launch", projectId: null };

  if (path[0] !== "projects" || !path[1]) return null;
  const projectId = path[1];
  const rest = path.slice(2).join("/");

  if (m === "POST" && rest === "agent/start") return { kind: "prompt", projectId };
  if (m === "POST" && rest === "deployments/deploy") return { kind: "publish", projectId };
  if (m === "POST" && rest === "rebuild") return { kind: "rebuild", projectId };
  if (m === "POST" && rest === "agent/server/start-or-restart") return { kind: "server", projectId };
  if (m === "PUT" && rest === "domain") return { kind: "domain", projectId };
  if (m === "POST" && rest.startsWith("domains")) return { kind: "domain", projectId };
  if (m === "POST" && (rest === "export" || rest.endsWith("/export"))) return { kind: "export", projectId };
  if (m === "POST" && joined === "projects/import") return { kind: "import", projectId: null };
  if (m === "POST" && /versions\/[^/]+\/recover$/.test(rest)) return { kind: "restore", projectId };
  if ((m === "PUT" || m === "POST") && (rest === "files" || rest.startsWith("files/"))) {
    return { kind: "files", projectId };
  }
  return null;
}

export function isAgentStatusPath(method: string, path: string[]): string | null {
  if (method.toUpperCase() !== "GET") return null;
  if (path[0] === "projects" && path[2] === "agent" && path[3] === "status") return path[1] || null;
  return null;
}

export function isProjectListGet(method: string, path: string[]): boolean {
  return method.toUpperCase() === "GET" && path.length === 1 && path[0] === "projects";
}

export function isProjectCreate(method: string, path: string[]): boolean {
  return method.toUpperCase() === "POST" && (path.join("/") === "projects" || path.join("/") === "projects/launch");
}

export function extractProjectId(path: string[]): string | null {
  if (path[0] === "projects" && path[1] && path[1] !== "launch" && path[1] !== "import") return path[1];
  return null;
}
