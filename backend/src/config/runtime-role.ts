export type RuntimeRole = "all" | "web" | "worker";

/**
 * Keep the current single-service deployment backwards compatible ("all"),
 * while allowing Render to run stateless API and background Worker services
 * from the same build artifact.
 */
export function getRuntimeRole(
  value: string | undefined,
  defaultRole: RuntimeRole = "all",
): RuntimeRole {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return defaultRole;
  if (normalized === "all" || normalized === "web" || normalized === "worker") {
    return normalized;
  }
  throw new Error("APP_ROLE must be one of: all, web, worker");
}

export function shouldStartHttpServer(role: RuntimeRole): boolean {
  return role === "all" || role === "web";
}

export function shouldStartBackgroundWorkers(role: RuntimeRole): boolean {
  return role === "all" || role === "worker";
}
