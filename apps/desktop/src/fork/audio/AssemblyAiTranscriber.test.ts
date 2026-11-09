import { expect, it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import * as AssemblyAiTranscriber from "./AssemblyAiTranscriber.ts";

const withClient = <A, E, R>(
  body: Effect.Effect<A, E, R | AssemblyAiTranscriber.AssemblyAiTranscriber>,
  client: HttpClient.HttpClient,
) =>
  body.pipe(
    Effect.provide(
      AssemblyAiTranscriber.layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client))),
    ),
  );

it.effect(
  "uploads WAV, pins Universal-2 and Russian, and waits for completion without resubmitting",
  () =>
    Effect.gen(function* () {
      const requests: string[] = [];
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          requests.push(`${request.method} ${request.url}`);
          expect(request.headers.authorization).toBe("assembly-test-key");
          if (request.url.endsWith("/upload")) {
            expect(request.body._tag).toBe("Uint8Array");
            if (request.body._tag === "Uint8Array")
              expect([...request.body.body]).toEqual([1, 2, 3]);
          }
          if (request.method === "POST" && request.url.endsWith("/transcript")) {
            expect(request.body._tag).toBe("Uint8Array");
            if (request.body._tag === "Uint8Array")
              expect(JSON.parse(new TextDecoder().decode(request.body.body))).toEqual({
                audio_url: "https://cdn.assemblyai.com/upload/test",
                speech_models: ["universal-2"],
                language_code: "ru",
              });
          }
          const body = request.url.endsWith("/upload")
            ? { upload_url: "https://cdn.assemblyai.com/upload/test" }
            : {
                id: "test-id",
                status:
                  requests.length === 2
                    ? "queued"
                    : requests.length === 3
                      ? "processing"
                      : "completed",
                text: requests.length === 4 ? "  Используй TypeScript.  " : null,
              };
          return HttpClientResponse.fromWeb(request, Response.json(body));
        }),
      );
      const result = yield* withClient(
        Effect.gen(function* () {
          const service = yield* AssemblyAiTranscriber.AssemblyAiTranscriber;
          const fiber = yield* service
            .transcribe({
              apiKey: "assembly-test-key",
              audio: new Uint8Array([1, 2, 3]),
              signal: yield* Effect.abortSignal,
            })
            .pipe(Effect.forkChild({ startImmediately: true }));
          yield* TestClock.adjust("5 seconds");
          return yield* Fiber.join(fiber);
        }),
        client,
      );
      expect(result).toBe("Используй TypeScript.");
      expect(requests).toEqual([
        "POST https://api.assemblyai.com/v2/upload",
        "POST https://api.assemblyai.com/v2/transcript",
        "GET https://api.assemblyai.com/v2/transcript/test-id",
        "GET https://api.assemblyai.com/v2/transcript/test-id",
      ]);
    }).pipe(Effect.provide(TestClock.layer())),
);

it.effect.each([401, 429, 503])(
  "does not retry a failed submission (%s) or expose provider payloads",
  (status) =>
    Effect.gen(function* () {
      let calls = 0;
      const client = HttpClient.make((request) =>
        Effect.sync(() => {
          calls++;
          return HttpClientResponse.fromWeb(
            request,
            calls === 1
              ? Response.json({ upload_url: "https://cdn.assemblyai.com/upload/test" })
              : Response.json({ error: "private upstream payload" }, { status }),
          );
        }),
      );
      const error = yield* withClient(
        Effect.gen(function* () {
          const service = yield* AssemblyAiTranscriber.AssemblyAiTranscriber;
          return yield* service
            .transcribe({
              apiKey: "test",
              audio: new Uint8Array([1]),
              signal: yield* Effect.abortSignal,
            })
            .pipe(Effect.flip);
        }),
        client,
      );
      expect(calls).toBe(2);
      expect(error._tag).toBe("TranscriptionError");
      expect(error.message).not.toContain("private upstream payload");
    }),
);

it.effect.each([
  { id: "test-id", status: "error", error: "private upstream failure" },
  { id: "test-id", status: "completed", text: " " },
  { invalid: true },
])("handles terminal failures and malformed responses: %j", (body) =>
  withClient(
    Effect.gen(function* () {
      const service = yield* AssemblyAiTranscriber.AssemblyAiTranscriber;
      const error = yield* service
        .transcribe({
          apiKey: "test",
          audio: new Uint8Array([1]),
          signal: yield* Effect.abortSignal,
        })
        .pipe(Effect.flip);
      expect(error._tag).toBe("TranscriptionError");
      expect(error.message).not.toContain("private upstream failure");
    }),
    HttpClient.make((request) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          Response.json(
            request.url.endsWith("/upload")
              ? { upload_url: "https://cdn.assemblyai.com/upload/test" }
              : body,
          ),
        ),
      ),
    ),
  ),
);

it.effect("cancels during processing and stops polling", () =>
  Effect.gen(function* () {
    const submitted = yield* Deferred.make<void>();
    let calls = 0;
    // @effect-diagnostics-next-line abortControllerInEffect:off -- Simulate the separate IPC cancel request aborting the recording.
    const controller = new AbortController();
    const client = HttpClient.make((request) =>
      Effect.gen(function* () {
        calls++;
        if (!request.url.endsWith("/upload")) yield* Deferred.succeed(submitted, undefined);
        return HttpClientResponse.fromWeb(
          request,
          Response.json(
            request.url.endsWith("/upload")
              ? { upload_url: "https://cdn.assemblyai.com/upload/test" }
              : { id: "test-id", status: "queued" },
          ),
        );
      }),
    );
    yield* withClient(
      Effect.gen(function* () {
        const service = yield* AssemblyAiTranscriber.AssemblyAiTranscriber;
        const fiber = yield* service
          .transcribe({ apiKey: "test", audio: new Uint8Array([1]), signal: controller.signal })
          .pipe(Effect.flip, Effect.forkChild);
        yield* Deferred.await(submitted);
        controller.abort();
        expect((yield* Fiber.join(fiber)).message).toBe("Transcription was cancelled.");
        yield* TestClock.adjust("10 seconds");
        expect(calls).toBe(2);
      }),
      client,
    );
  }).pipe(Effect.provide(TestClock.layer())),
);
