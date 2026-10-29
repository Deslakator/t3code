import {
  CommandId,
  MessageId,
  type OrchestrationV2Command,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import {
  latestExecutedRun,
  latestRootProviderFailure,
} from "@t3tools/shared/orchestrationV2ThreadError";
import * as DateTime from "effect/DateTime";

const RETRY_DELAY_MS = 5_000;
export const OVERLOAD_RECOVERY_MAX_ATTEMPTS = 5;

export function overloadRecoveryCommand(
  projection: Pick<
    OrchestrationV2ThreadProjection,
    "thread" | "runs" | "messages" | "runtimeRequests" | "turnItems"
  >,
  nowMs: number,
) {
  const { thread } = projection;
  const run = latestExecutedRun(projection.runs);
  const failure = latestRootProviderFailure(run, projection.turnItems);
  if (
    run?.status !== "failed" ||
    run.completedAt === null ||
    run.providerThreadId === null ||
    failure?.class !== "provider_error" ||
    failure.code !== "serverOverloaded" ||
    thread.archivedAt !== null ||
    thread.deletedAt !== null ||
    thread.settledOverride === "settled" ||
    thread.providerInstanceId !== run.providerInstanceId ||
    (thread.snoozedUntil != null && DateTime.toEpochMillis(thread.snoozedUntil) > nowMs) ||
    projection.turnItems.some(
      (item) => item.runId === run.id && item.type === "run_interrupt_request",
    ) ||
    projection.runtimeRequests.some((request) => request.status === "pending") ||
    projection.runs.some((candidate) => candidate.status === "queued") ||
    projection.messages.findLast((message) => message.role === "user")?.id !== run.userMessageId ||
    DateTime.toEpochMillis(run.completedAt) + RETRY_DELAY_MS > nowMs
  )
    return null;
  const recovery = thread.overloadRecovery;
  const attempt = recovery?.messageId === run.userMessageId ? recovery.attempt : 0;
  if (attempt >= OVERLOAD_RECOVERY_MAX_ATTEMPTS) return null;
  const identity = `overload-resume:${thread.id}:${run.id}`;
  return {
    type: "message.dispatch",
    commandId: CommandId.make(identity),
    messageId: MessageId.make(identity),
    threadId: thread.id,
    overloadContinuationOfRunId: run.id,
    text: "Continue where you left off.",
    attachments: [],
    dispatchMode: { type: "start_immediately" },
    createdBy: "user",
    creationSource: "server",
  } satisfies OrchestrationV2Command;
}
