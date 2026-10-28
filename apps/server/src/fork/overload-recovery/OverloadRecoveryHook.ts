import type {
  OrchestrationV2Command,
  OrchestrationV2DomainEvent,
  OrchestrationV2ThreadProjection,
  RunId,
  ThreadId,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import { applyToProjection } from "../../orchestration-v2/ProjectionStore.ts";
import { overloadRecoveryCommand } from "./OverloadRecovery.ts";

type DispatchCommand = Extract<OrchestrationV2Command, { type: "message.dispatch" }>;
type MetadataEvent = Extract<OrchestrationV2DomainEvent, { type: "thread.metadata-updated" }>;

export const prepareRetry = Effect.fn("OverloadRecovery.prepareDispatch")(function* <E, R, E2, R2>(
  command: DispatchCommand,
  projection: OrchestrationV2ThreadProjection,
  emit: (event: Omit<MetadataEvent, "id">) => Effect.Effect<MetadataEvent, E, R>,
  stopReachedRun: (
    command: DispatchCommand,
    threadId: ThreadId,
    runId: RunId,
  ) => Effect.Effect<boolean, E2, R2>,
) {
  if (command.overloadContinuationOfRunId === undefined) return projection;
  const now = yield* DateTime.now;
  const expected = overloadRecoveryCommand(projection, DateTime.toEpochMillis(now));
  if (
    expected === null ||
    (yield* stopReachedRun(command, command.threadId, command.overloadContinuationOfRunId)) ||
    expected.overloadContinuationOfRunId !== command.overloadContinuationOfRunId ||
    command.commandId !== expected.commandId ||
    command.messageId !== expected.messageId ||
    command.text !== expected.text ||
    command.dispatchMode.type !== "start_immediately" ||
    command.modelSelection !== undefined ||
    command.attachments.length !== 0
  ) {
    yield* emit({
      type: "thread.metadata-updated",
      threadId: command.threadId,
      occurredAt: now,
      payload: projection.thread,
    });
    return null;
  }
  const recovery = projection.thread.overloadRecovery;
  const source = projection.runs.find((run) => run.id === command.overloadContinuationOfRunId)!;
  const event = yield* emit({
    type: "thread.metadata-updated",
    threadId: command.threadId,
    occurredAt: now,
    payload: {
      ...projection.thread,
      overloadRecovery: {
        messageId: command.messageId,
        attempt: (recovery?.messageId === source.userMessageId ? recovery.attempt : 0) + 1,
      },
    },
  });
  return applyToProjection(projection, event);
});
