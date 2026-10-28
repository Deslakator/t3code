import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/testing/TestClock";
import { prepareRetry } from "./OverloadRecoveryHook.ts";
import { describe, expect, it } from "vite-plus/test";
import {
  CommandId,
  EventId,
  type OrchestrationV2DomainEvent,
  MessageId,
  NodeId,
  ProviderInstanceId,
  ProviderThreadId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadProjection,
} from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import { overloadRecoveryCommand } from "./OverloadRecovery.ts";

function fixture() {
  const now = DateTime.makeUnsafe("2026-10-28T12:00:00Z");
  const runId = RunId.make("overload-run");
  const messageId = MessageId.make("overload-message");
  const nodeId = NodeId.make("overload-node");
  const providerInstanceId = ProviderInstanceId.make("codex");
  return {
    now,
    projection: {
      thread: {
        id: ThreadId.make("overload-thread"),
        providerInstanceId,
        archivedAt: null,
        deletedAt: null,
        settledOverride: null,
      },
      runs: [
        {
          id: runId,
          userMessageId: messageId,
          providerThreadId: ProviderThreadId.make("overload-provider-thread"),
          rootNodeId: nodeId,
          providerInstanceId,
          status: "failed",
          ordinal: 1,
          completedAt: now,
          startedAt: now,
        },
      ],
      messages: [{ id: messageId, role: "user" }],
      runtimeRequests: [],
      turnItems: [
        {
          id: TurnItemId.make("overload-error"),
          runId,
          nodeId,
          type: "error",
          status: "failed",
          ordinal: 1,
          updatedAt: now,
          failure: {
            class: "provider_error",
            code: "serverOverloaded",
            message: "Capacity",
            retryable: null,
          },
        },
      ],
    } as OrchestrationV2ThreadProjection,
  };
}

describe("overload recovery", () => {
  it("waits five seconds after terminal failure, then dispatches a continuation", () => {
    const { projection, now } = fixture();
    const epoch = DateTime.toEpochMillis(now);
    expect(overloadRecoveryCommand(projection, epoch + 4999)).toBeNull();
    expect(overloadRecoveryCommand(projection, epoch + 5000)).toMatchObject({
      type: "message.dispatch",
      text: "Continue where you left off.",
      overloadContinuationOfRunId: projection.runs[0]!.id,
      creationSource: "server",
    });
  });
  it("preserves the retry budget across failed automatic continuations", () => {
    const { projection, now } = fixture();
    const epoch = DateTime.toEpochMillis(now) + 5000;
    const withAttempts = (attempt: number) => ({
      ...projection,
      thread: {
        ...projection.thread,
        overloadRecovery: {
          attempt,
          messageId: projection.runs[0]!.userMessageId,
        },
      },
    });
    expect(overloadRecoveryCommand(withAttempts(4), epoch)).not.toBeNull();
    expect(overloadRecoveryCommand(withAttempts(5), epoch)).toBeNull();
  });
  it("does not repeat another error, an active turn, or cancelled recovery", () => {
    const { projection, now } = fixture();
    const epoch = DateTime.toEpochMillis(now) + 5000;
    expect(
      overloadRecoveryCommand(
        { ...projection, runs: [{ ...projection.runs[0]!, status: "running" }] },
        epoch,
      ),
    ).toBeNull();
    expect(overloadRecoveryCommand({ ...projection, turnItems: [] }, epoch)).toBeNull();
    expect(
      overloadRecoveryCommand(
        {
          ...projection,
          turnItems: [
            ...projection.turnItems,
            { ...projection.turnItems[0]!, type: "run_interrupt_request", message: "Stopped" },
          ],
        },
        epoch,
      ),
    ).toBeNull();
  });
  it("rejects recovery after new input, provider changes, archive or pending approval", () => {
    const { projection, now } = fixture();
    const epoch = DateTime.toEpochMillis(now) + 5000;
    expect(
      overloadRecoveryCommand(
        {
          ...projection,
          messages: [
            ...projection.messages,
            { ...projection.messages[0]!, id: MessageId.make("new-input") },
          ],
        },
        epoch,
      ),
    ).toBeNull();
    expect(
      overloadRecoveryCommand(
        {
          ...projection,
          thread: { ...projection.thread, providerInstanceId: ProviderInstanceId.make("other") },
        },
        epoch,
      ),
    ).toBeNull();
    expect(
      overloadRecoveryCommand(
        { ...projection, thread: { ...projection.thread, archivedAt: now } },
        epoch,
      ),
    ).toBeNull();
    expect(
      overloadRecoveryCommand(
        {
          ...projection,
          runtimeRequests: [
            { status: "pending" } as OrchestrationV2ThreadProjection["runtimeRequests"][number],
          ],
        },
        epoch,
      ),
    ).toBeNull();
  });
  it("uses stable delivery identifiers", () => {
    const { projection, now } = fixture();
    const command = overloadRecoveryCommand(projection, DateTime.toEpochMillis(now) + 5000)!;
    expect(command.commandId).toBe(
      CommandId.make(`overload-resume:${projection.thread.id}:${projection.runs[0]!.id}`),
    );
  });
});

type MetadataEvent = Extract<OrchestrationV2DomainEvent, { type: "thread.metadata-updated" }>;

function eventWriter() {
  const written: MetadataEvent[] = [];
  const emit = (event: Omit<MetadataEvent, "id">) =>
    Effect.sync(() => {
      const persisted = { ...event, id: EventId.make(`overload-event:${written.length}`) };
      written.push(persisted);
      return persisted;
    });
  return { written, emit };
}

effectIt.effect(
  "records each automatic continuation and stops after five consecutive failures",
  () =>
    Effect.gen(function* () {
      const { projection, now } = fixture();
      const writer = eventWriter();
      yield* TestClock.setTime(DateTime.toEpochMillis(now) + 5000);
      let current = projection;
      for (let attempt = 1; attempt <= 5; attempt++) {
        const command = overloadRecoveryCommand(
          current,
          DateTime.toEpochMillis(yield* DateTime.now),
        )!;
        expect(command).not.toBeNull();
        const prepared = yield* prepareRetry(command, current, writer.emit, () =>
          Effect.succeed(false),
        );
        expect(prepared?.thread.overloadRecovery).toEqual({
          messageId: command.messageId,
          attempt,
        });
        expect(writer.written.at(-1)?.payload.overloadRecovery?.attempt).toBe(attempt);
        const completedAt = yield* DateTime.now;
        current = {
          ...prepared!,
          runs: [
            {
              ...current.runs[0]!,
              id: RunId.make(`overload-retry:${attempt}`),
              userMessageId: command.messageId,
              completedAt,
            },
          ],
          messages: [{ ...current.messages[0]!, id: command.messageId }],
          turnItems: [{ ...current.turnItems[0]!, runId: RunId.make(`overload-retry:${attempt}`) }],
        };
        yield* TestClock.adjust("5 seconds");
      }
      expect(
        overloadRecoveryCommand(current, DateTime.toEpochMillis(yield* DateTime.now)),
      ).toBeNull();
      expect(writer.written).toHaveLength(5);
    }),
);

effectIt.effect("acknowledges stale recovery after Stop without consuming an attempt", () =>
  Effect.gen(function* () {
    const { projection, now } = fixture();
    yield* TestClock.setTime(DateTime.toEpochMillis(now) + 5000);
    const command = overloadRecoveryCommand(
      projection,
      DateTime.toEpochMillis(yield* DateTime.now),
    )!;
    const writer = eventWriter();
    const prepared = yield* prepareRetry(command, projection, writer.emit, () =>
      Effect.succeed(true),
    );
    expect(prepared).toBeNull();
    expect(writer.written).toHaveLength(1);
    expect(writer.written[0]?.payload).toBe(projection.thread);
    expect(projection.thread.overloadRecovery).toBeUndefined();
  }),
);

effectIt.effect("rejects a continuation when a new user message has arrived", () =>
  Effect.gen(function* () {
    const { projection, now } = fixture();
    yield* TestClock.setTime(DateTime.toEpochMillis(now) + 5000);
    const command = overloadRecoveryCommand(
      projection,
      DateTime.toEpochMillis(yield* DateTime.now),
    )!;
    const changed = {
      ...projection,
      messages: [
        ...projection.messages,
        { ...projection.messages[0]!, id: MessageId.make("new-user-input") },
      ],
    };
    const writer = eventWriter();
    expect(
      yield* prepareRetry(command, changed, writer.emit, () => Effect.succeed(false)),
    ).toBeNull();
    expect(writer.written[0]?.payload.overloadRecovery).toBeUndefined();
  }),
);

effectIt.effect("leaves ordinary messages and their projection untouched", () =>
  Effect.gen(function* () {
    const { projection, now } = fixture();
    const { overloadContinuationOfRunId: _source, ...command } = overloadRecoveryCommand(
      projection,
      DateTime.toEpochMillis(now) + 5000,
    )!;
    const writer = eventWriter();
    expect(yield* prepareRetry(command, projection, writer.emit, () => Effect.succeed(true))).toBe(
      projection,
    );
    expect(writer.written).toHaveLength(0);
  }),
);
