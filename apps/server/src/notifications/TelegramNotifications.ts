import {
  idleCompactionOf,
  type OrchestrationV2DomainEvent,
  type ThreadId,
} from "@t3tools/contracts";
import * as HostProcess from "@t3tools/shared/HostProcess";
import { makeDrainableWorker } from "@t3tools/shared/DrainableWorker";
import { projectThreadAwarenessV2 } from "@t3tools/shared/agentAwareness";
import { turnItemUpdateCanEndBackgroundWork } from "@t3tools/shared/orchestrationV2PendingBackgroundWork";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";
import * as Schedule from "effect/Schedule";
import * as Stream from "effect/Stream";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientRequest from "effect/http/HttpClientRequest";

import * as ServerEnvironment from "../environment/ServerEnvironment.ts";
import * as ThreadManagement from "../orchestration-v2/ThreadManagementService.ts";
import * as ProjectService from "../project/ProjectService.ts";
import { forkParked } from "../serverActivation.ts";

const TelegramConfig = Schema.Struct({
  botToken: Schema.String.check(Schema.isPattern(/^\d+:[A-Za-z0-9_-]+$/)),
  chatId: Schema.String.check(Schema.isPattern(/^-?\d+$/)),
  publicUrl: Schema.String.check(
    Schema.makeFilter((value) => {
      if (!URL.canParse(value)) return false;
      const url = new URL(value);
      return (
        url.protocol === "https:" &&
        !url.username &&
        !url.password &&
        url.pathname === "/" &&
        !url.search &&
        !url.hash
      );
    }),
  ),
});
const TelegramResult = Schema.Struct({ ok: Schema.Boolean });

class TelegramDeliveryError extends Schema.TaggedError<TelegramDeliveryError>()(
  "TelegramDeliveryError",
  { retryable: Schema.Boolean },
) {}

export class TelegramNotifications extends Context.Service<
  TelegramNotifications,
  {
    readonly notifyThread: (threadId: ThreadId) => Effect.Effect<void>;
    readonly drain: Effect.Effect<void>;
  }
>()("t3/notifications/TelegramNotifications") {}

function needsNotification(event: OrchestrationV2DomainEvent): boolean {
  switch (event.type) {
    case "run.updated":
      return event.payload.status === "completed" || event.payload.status === "failed";
    case "turn-item.updated":
      return turnItemUpdateCanEndBackgroundWork(event.payload);
    case "run.background-work-cancelled":
      return true;
    default:
      return false;
  }
}

function escapeMarkdownTitle(value: string): string {
  return value
    .slice(0, 200)
    .replace(/[\\`*_{}[\]()<>#+.!|~=-]/g, "\\$&")
    .replace(/[\r\n]/g, " ");
}

const make = Effect.gen(function* () {
  const environment = yield* HostProcess.Environment;
  const fs = yield* FileSystem.FileSystem;
  const threads = yield* ThreadManagement.ThreadManagementService;
  const projects = yield* ProjectService.ProjectService;
  const server = yield* ServerEnvironment.ServerEnvironment;
  const client = yield* HttpClient.HttpClient;
  const configPath = environment.T3CODE_TELEGRAM_CONFIG_FILE;
  const config = configPath
    ? yield* fs.readFileString(configPath).pipe(
        Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(TelegramConfig))),
        Effect.catch(() =>
          Effect.logWarning(
            "Telegram notifications disabled: configuration could not be read or is invalid",
          ).pipe(Effect.as(null)),
        ),
      )
    : null;
  if (config === null) {
    return TelegramNotifications.of({
      notifyThread: Effect.fn("TelegramNotifications.notifyThread")(() => Effect.void),
      drain: Effect.void,
    });
  }
  const environmentId = yield* server.getEnvironmentId;
  const delivered = new Set<string>();

  const notify = Effect.fn("TelegramNotifications.notifyThread")(function* (threadId: ThreadId) {
    const thread = yield* threads.getThreadShell(threadId);
    if (
      !thread ||
      thread.latestRunId === null ||
      thread.deletedAt !== null ||
      thread.archivedAt !== null
    )
      return;
    const project = yield* projects.getShell(thread.projectId);
    if (Option.isNone(project)) return;
    const state = projectThreadAwarenessV2({ environmentId, project: project.value, thread });
    if (!state || (state.phase !== "completed" && state.phase !== "failed")) return;
    const key = `${threadId}/${thread.latestRunId}`;
    if (delivered.has(key)) return;
    const records = yield* threads.getThreadRecords(threadId, ["messages"], {
      messageRunIds: [thread.latestRunId],
    });
    const userMessage = records.messages.find((message) => message.role === "user");
    if (state.phase === "completed" && userMessage && idleCompactionOf(userMessage) !== undefined)
      return;
    const lastAnswer = records.messages.findLast(
      (message) => message.role === "assistant" && !message.streaming,
    );
    const detail =
      state.phase === "failed"
        ? thread.lastError || "The agent run failed."
        : lastAnswer?.text || "The agent finished.";
    const url = new URL("/open-thread.html", config.publicUrl);
    url.searchParams.set("environment", environmentId);
    url.searchParams.set("thread", threadId);
    const payload = {
      chat_id: config.chatId,
      rich_message: {
        markdown: `${state.phase === "failed" ? "❌" : "✅"} ${escapeMarkdownTitle(project.value.title)}\n${escapeMarkdownTitle(thread.title)}\n\n${detail.slice(0, 2400)}`,
      },
      reply_markup: { inline_keyboard: [[{ text: "Открыть в T3", url: url.href }]] },
    };
    const request = HttpClientRequest.post(
      `https://api.telegram.org/bot${config.botToken}/sendRichMessage`,
    ).pipe(HttpClientRequest.bodyJsonUnsafe(payload));
    const result = yield* client.execute(request).pipe(
      Effect.timeout("10 seconds"),
      Effect.mapError(() => new TelegramDeliveryError({ retryable: true })),
      Effect.provideService(HttpClient.TracerDisabledWhen, () => true),
      Effect.flatMap((response) =>
        response.status === 200
          ? response.json.pipe(
              Effect.flatMap(Schema.decodeUnknownEffect(TelegramResult)),
              Effect.mapError(() => new TelegramDeliveryError({ retryable: false })),
            )
          : Effect.fail(
              new TelegramDeliveryError({
                retryable: response.status === 429 || response.status >= 500,
              }),
            ),
      ),
      Effect.filterOrFail(
        (result) => result.ok,
        () => new TelegramDeliveryError({ retryable: false }),
      ),
      Effect.retry({
        times: 2,
        schedule: Schedule.exponential("1 second"),
        while: (error) => error.retryable,
      }),
      Effect.timeout("30 seconds"),
      Effect.orElseSucceed(() => ({ ok: false })),
    );
    // Do not log HTTP errors: Telegram embeds the bot token in the request URL.
    if (!result.ok) {
      yield* Effect.logWarning("Telegram notification delivery failed", { threadId });
      return;
    }
    delivered.add(key);
    if (delivered.size > 2048) {
      const oldest = delivered.values().next();
      if (!oldest.done) delivered.delete(oldest.value);
    }
  });
  const queued = new Set<ThreadId>();
  const worker = yield* makeDrainableWorker((threadId: ThreadId) =>
    Effect.sync(() => queued.delete(threadId)).pipe(
      Effect.andThen(notify(threadId)),
      Effect.catch(() =>
        Effect.logWarning("Telegram notification could not be prepared", { threadId }),
      ),
    ),
  );
  const enqueue = (threadId: ThreadId) =>
    Effect.suspend(() => {
      if (queued.has(threadId)) return Effect.void;
      queued.add(threadId);
      return worker.enqueue(threadId);
    }).pipe(Effect.uninterruptible);
  yield* forkParked(
    Stream.runForEach(threads.streamDomainEvents, (event) =>
      needsNotification(event) ? enqueue(event.threadId) : Effect.void,
    ),
  );
  yield* Effect.logInfo("Telegram notifications enabled");
  return TelegramNotifications.of({ notifyThread: enqueue, drain: worker.drain });
});

export const layer = Layer.effect(TelegramNotifications, make);
