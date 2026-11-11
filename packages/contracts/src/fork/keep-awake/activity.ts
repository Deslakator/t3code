import type { OrchestrationV2ThreadShell } from "../../orchestrationV2.ts";

export function keepsMacAwake(
  thread: Pick<
    OrchestrationV2ThreadShell,
    | "status"
    | "pendingRuntimeRequest"
    | "limitRecovery"
    | "latestRunId"
    | "usageLimitResetAt"
    | "settledOverride"
    | "lastErrorClass"
    | "archivedAt"
  >,
) {
  if (thread.pendingRuntimeRequest !== null && thread.pendingRuntimeRequest.blocking !== false)
    return false;
  if (["queued", "preparing", "starting", "running", "waiting"].includes(thread.status))
    return true;
  const recovery = thread.limitRecovery;
  return (
    thread.status === "failed" &&
    thread.lastErrorClass === "usage_limit" &&
    thread.archivedAt === null &&
    thread.settledOverride !== "settled" &&
    recovery?.autoResume === true &&
    recovery.runId === thread.latestRunId &&
    recovery.resetAt === thread.usageLimitResetAt
  );
}
