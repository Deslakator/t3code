import { assert, describe, it } from "@effect/vitest";
import {
  EnvironmentId,
  EventId,
  type OrchestrationV2DomainEvent,
  MessageId,
  ProjectId,
  ProviderInstanceId,
  RunId,
  ThreadId,
  TurnItemId,
  type OrchestrationV2ThreadShell,
  type OrchestrationV2ConversationMessage,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as Context from "effect/Context";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Queue from "effect/Queue";
import * as TestClock from "effect/testing/TestClock";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import type {
  ProjectionRecords,
  ProjectionRecordField,
} from "../orchestration-v2/ProjectionStore.ts";
import * as TelegramNotifications from "./TelegramNotifications.ts";

const THREAD_ID = ThreadId.make("telegram-thread");
const PROJECT_ID = ProjectId.make("telegram-project");
const RUN_ID = RunId.make("telegram-run");
const NOW = "2026-09-04T12:00:00.000Z";
function shell(overrides: Partial<OrchestrationV2ThreadShell> = {}): OrchestrationV2ThreadShell {
  return {
    id: THREAD_ID,
    projectId: PROJECT_ID,
    title: "Thread",
    providerInstanceId: ProviderInstanceId.make("codex"),
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
    runtimeMode: "full-access",
    interactionMode: "default",
    worktreePath: null,
    activeProviderThreadId: null,
    lineage: { rootThreadId: THREAD_ID, parentThreadId: null, relationshipToParent: null },
    forkedFrom: null,
    createdBy: "user",
    creationSource: "web",
    activeRunId: null,
    latestVisibleMessage: null,
    hasActionableProposedPlan: false,
    itemCount: 0,
    visibleItemCount: 0,
    lastVisitedAt: null,
    deletedAt: null,
    branch: null,
    linkedPullRequest: null,
    status: "running",
    activityRunStatus: null,
    pendingRuntimeRequest: null,
    pendingBackgroundTasks: [],
    latestRunId: null,
    latestRunRequestedAt: null,
    latestRunStartedAt: null,
    latestRunCompletedAt: null,
    latestUserMessageAt: null,
    createdAt: DateTime.makeUnsafe(NOW),
    updatedAt: DateTime.makeUnsafe(NOW),
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    pinnedAt: null,
    ...overrides,
  };
}

function message(
  overrides: Partial<OrchestrationV2ConversationMessage> = {},
): OrchestrationV2ConversationMessage {
  return {
    id: MessageId.make("answer"),
    threadId: THREAD_ID,
    runId: RUN_ID,
    nodeId: null,
    role: "assistant",
    text: "Finished the work",
    attachments: [],
    streaming: false,
    createdBy: "agent",
    creationSource: "web",
    createdAt: DateTime.makeUnsafe(NOW),
    updatedAt: DateTime.makeUnsafe(NOW),
    ...overrides,
  };
}

const setup = Effect.fn("TelegramTest.setup")(function* (
  options: {
    shell?: Partial<OrchestrationV2ThreadShell>;
    messages?: ReadonlyArray<OrchestrationV2ConversationMessage>;
    config?: string;
    status?: number;
    ok?: boolean;
    enabled?: boolean;
    statuses?: ReadonlyArray<number>;
  } = {},
) {
  const sent: Array<{
    rich_message: { markdown: string };
    chat_id: string;
    reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> };
  }> = [];
  let httpCalls = 0;
  let shellReads = 0;
  const events = yield* Queue.unbounded<OrchestrationV2DomainEvent>();
  const pulls = yield* Queue.unbounded<void>();
  let currentShell = shell({ status: "completed", latestRunId: RUN_ID, ...options.shell });
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      httpCalls++;
      assert.equal(request.url, "https://api.telegram.org/bot123:test-token/sendRichMessage");
      assert.equal(request.body._tag, "Uint8Array");
      if (request.body._tag === "Uint8Array")
        sent.push(JSON.parse(new TextDecoder().decode(request.body.body)));
      return HttpClientResponse.fromWeb(
        request,
        Response.json(
          { ok: options.ok ?? true },
          { status: options.statuses?.[httpCalls - 1] ?? options.status ?? 200 },
        ),
      );
    }),
  );
  const dependencies = Layer.mergeAll(
    FileSystem.layerNoop({
      readFileString: () =>
        Effect.succeed(
          options.config ??
            JSON.stringify({
              botToken: "123:test-token",
              chatId: "-1234",
              publicUrl: "https://t3.example.com",
            }),
        ),
    }),
    Layer.mock(ThreadManagement.ThreadManagementService)({
      getThreadShell: () =>
        Effect.sync(() => {
          shellReads++;
          return currentShell;
        }),
      getThreadRecords: (_id, _fields, filter) => {
        assert.deepEqual(filter, { messageRunIds: [RUN_ID] });
        const records: ProjectionRecords<ProjectionRecordField> = {
          thread: { ...currentShell, lastVisitedAt: currentShell.lastVisitedAt ?? null },
          messages: options.messages ?? [message()],
          runs: [],
          attempts: [],
          nodes: [],
          subagents: [],
          providerSessions: [],
          providerThreads: [],
          providerTurns: [],
          runtimeRequests: [],
          plans: [],
          turnItems: [],
          checkpointScopes: [],
          checkpoints: [],
          contextHandoffs: [],
          contextTransfers: [],
        };
        return Effect.succeed(records);
      },
      streamDomainEvents: Stream.fromEffectRepeat(
        Queue.offer(pulls, undefined).pipe(Effect.andThen(Queue.take(events))),
      ),
    }),
    Layer.mock(ProjectService.ProjectService)({
      getShell: () =>
        Effect.succeed(
          Option.some({
            id: PROJECT_ID,
            title: "Project",
            workspaceRoot: "/workspace",
            defaultModelSelection: null,
            scripts: [],
            createdAt: NOW,
            updatedAt: NOW,
          }),
        ),
    }),
    Layer.mock(ServerEnvironment.ServerEnvironment)({
      getEnvironmentId: Effect.succeed(EnvironmentId.make("env-1")),
    }),
    Layer.succeed(HttpClient.HttpClient, client),
    Layer.succeed(
      HostProcess.Environment,
      options.enabled === false ? {} : { T3CODE_TELEGRAM_CONFIG_FILE: "/config/telegram.json" },
    ),
  );
  const context = yield* Layer.build(TelegramNotifications.layer.pipe(Layer.provide(dependencies)));
  const service = Context.get(context, TelegramNotifications.TelegramNotifications);
  if (options.enabled !== false && options.config === undefined) yield* Queue.take(pulls);
  const deliver = Effect.fn("TelegramTest.deliver")(function* (event: OrchestrationV2DomainEvent) {
    yield* Queue.offer(events, event);
    yield* Queue.take(pulls);
  });
  return {
    service,
    sent,
    calls: () => httpCalls,
    shellReads: () => shellReads,
    deliver,
    setShell: (overrides: Partial<OrchestrationV2ThreadShell>) => {
      currentShell = { ...currentShell, ...overrides };
    },
  };
});

function completionEvent(): OrchestrationV2DomainEvent {
  const now = DateTime.makeUnsafe(NOW);
  return {
    id: EventId.make("completed"),
    type: "run.updated",
    threadId: THREAD_ID,
    runId: RUN_ID,
    occurredAt: now,
    payload: {
      id: RUN_ID,
      threadId: THREAD_ID,
      ordinal: 1,
      providerInstanceId: ProviderInstanceId.make("codex"),
      modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "test-model" },
      providerThreadId: null,
      userMessageId: MessageId.make("user"),
      rootNodeId: null,
      activeAttemptId: null,
      status: "completed",
      requestedAt: now,
      startedAt: now,
      completedAt: now,
      checkpointId: null,
      contextHandoffId: null,
    },
  };
}

describe("Telegram notifications", () => {
  it.effect("retries a transient failure from a single domain event", () =>
    Effect.gen(function* () {
      const { service, deliver, calls } = yield* setup({ statuses: [503, 200] });
      yield* deliver(completionEvent());
      yield* TestClock.adjust("1 second");
      yield* service.drain;
      assert.equal(calls(), 2);
      yield* deliver(completionEvent());
      yield* service.drain;
      assert.equal(calls(), 2);
    }),
  );
  it.effect("waits for background work before notifying from the terminal item event", () =>
    Effect.gen(function* () {
      const { service, deliver, sent, setShell } = yield* setup({
        shell: { pendingBackgroundTasks: [{ taskId: "watch", kind: "monitor", awaited: true }] },
      });
      yield* deliver(completionEvent());
      yield* service.drain;
      assert.lengthOf(sent, 0);
      setShell({ pendingBackgroundTasks: [] });
      yield* deliver({
        id: EventId.make("background-done"),
        type: "turn-item.updated",
        threadId: THREAD_ID,
        runId: RUN_ID,
        occurredAt: DateTime.makeUnsafe(NOW),
        payload: {
          id: TurnItemId.make("tool"),
          threadId: THREAD_ID,
          runId: RUN_ID,
          nodeId: null,
          ordinal: 1,
          providerThreadId: null,
          providerTurnId: null,
          nativeItemRef: null,
          parentItemId: null,
          title: null,
          startedAt: null,
          completedAt: DateTime.makeUnsafe(NOW),
          updatedAt: DateTime.makeUnsafe(NOW),
          type: "dynamic_tool",
          status: "completed",
          toolName: "monitor",
          input: {},
          output: null,
        },
      });
      yield* service.drain;
      assert.lengthOf(sent, 1);
    }),
  );

  it.effect("sends project, thread, final answer and HTTPS app button once per run", () =>
    Effect.gen(function* () {
      const { service, sent } = yield* setup();
      yield* service.notifyThread(THREAD_ID);
      yield* service.notifyThread(THREAD_ID);
      yield* service.drain;
      assert.lengthOf(sent, 1);
      assert.equal(sent[0]?.rich_message.markdown, "✅ Project\nThread\n\nFinished the work");
      assert.equal(sent[0]?.chat_id, "-1234");
      assert.deepEqual(sent[0]?.reply_markup.inline_keyboard, [
        [
          {
            text: "Открыть в T3",
            url: "https://t3.example.com/open-thread.html?environment=env-1&thread=telegram-thread",
          },
        ],
      ]);
    }),
  );
  it.effect("sends failed runs with their error", () =>
    Effect.gen(function* () {
      const { service, sent } = yield* setup({
        shell: { status: "failed", lastError: "Provider failed" },
      });
      yield* service.notifyThread(THREAD_ID);
      yield* service.drain;
      assert.equal(sent[0]?.rich_message.markdown, "❌ Project\nThread\n\nProvider failed");
    }),
  );
  it.effect("keeps thread titles literal while preserving answer formatting", () =>
    Effect.gen(function* () {
      const { service, sent } = yield* setup({
        shell: { title: "# Thread *name*\nnext" },
        messages: [message({ text: "## Result\n\n**Done** and [link](https://example.com)" })],
      });
      yield* service.notifyThread(THREAD_ID);
      yield* service.drain;
      assert.equal(
        sent[0]?.rich_message.markdown,
        "✅ Project\n\\# Thread \\*name\\* next\n\n## Result\n\n**Done** and [link](https://example.com)",
      );
    }),
  );
  it.effect("does not send active, interrupted, silent or child work", () =>
    Effect.gen(function* () {
      for (const override of [
        { status: "running" },
        { status: "interrupted" },
        { latestRunSilent: true },
        {
          lineage: {
            rootThreadId: THREAD_ID,
            parentThreadId: ThreadId.make("parent"),
            relationshipToParent: "subagent",
          },
        },
      ] satisfies Array<Partial<OrchestrationV2ThreadShell>>) {
        const { service, sent } = yield* setup({ shell: override });
        yield* service.notifyThread(THREAD_ID);
        yield* service.drain;
        assert.lengthOf(sent, 0);
      }
    }),
  );
  it.effect("bounds the excerpt and preserves Markdown for Telegram rich text", () =>
    Effect.gen(function* () {
      const { service, sent } = yield* setup({
        messages: [message({ text: "**Done**\n\n```ts\nconst x = 1;\n```\n" + "x".repeat(10000) })],
      });
      yield* service.notifyThread(THREAD_ID);
      yield* service.drain;
      assert.isBelow(sent[0]!.rich_message.markdown.length, 4096);
      assert.include(sent[0]!.rich_message.markdown, "**Done**\n\n```ts\nconst x = 1;\n```");
    }),
  );
  it.effect("does not mark rejected deliveries as sent or stop later work", () =>
    Effect.gen(function* () {
      for (const options of [{ status: 400 }, { ok: false }]) {
        const { service, calls } = yield* setup(options);
        yield* service.notifyThread(THREAD_ID);
        yield* service.drain;
        yield* service.notifyThread(THREAD_ID);
        yield* service.drain;
        assert.equal(calls(), 2);
      }
    }),
  );
  it.effect("is disabled without configuration or with an unsafe public origin", () =>
    Effect.gen(function* () {
      for (const options of [
        { enabled: false },
        {
          config: JSON.stringify({
            botToken: "123:test-token",
            chatId: "1",
            publicUrl: "javascript:alert(1)",
          }),
        },
      ]) {
        const { service, calls, shellReads } = yield* setup(options);
        yield* service.notifyThread(THREAD_ID);
        yield* service.drain;
        assert.equal(calls(), 0);
        assert.equal(shellReads(), 0);
      }
    }),
  );
});
