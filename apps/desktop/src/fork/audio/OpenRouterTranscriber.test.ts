import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as TestClock from "effect/testing/TestClock";
import * as Fiber from "effect/Fiber";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";
import { OpenRouterTranscriber, layer } from "./OpenRouterTranscriber.ts";

it.effect.each([503, 429, 401, 502])("handles OpenRouter %s without losing the request", (status) =>
  Effect.gen(function* () {
    let calls = 0;
    const client = HttpClient.make((request) =>
      Effect.sync(() => {
        calls++;
        return HttpClientResponse.fromWeb(
          request,
          new Response(calls === 1 || status === 502 ? null : JSON.stringify({ text: "Привет" }), {
            status: calls === 1 || status === 502 ? status : 200,
          }),
        );
      }),
    );
    const result = yield* Effect.gen(function* () {
      const service = yield* OpenRouterTranscriber;
      const fiber = yield* service
        .transcribe({
          apiKey: "test",
          model: "test",
          audio: new Uint8Array([1]),
          signal: yield* Effect.abortSignal,
        })
        .pipe(Effect.result, Effect.forkChild({ startImmediately: true }));
      if (status !== 401) yield* TestClock.adjust("10 seconds");
      return yield* Fiber.join(fiber);
    }).pipe(
      Effect.provide(layer.pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)))),
    );
    expect(calls).toBe(status === 401 ? 1 : status === 502 ? 4 : 2);
    expect(result._tag).toBe(status === 401 || status === 502 ? "Failure" : "Success");
  }).pipe(Effect.provide(TestClock.layer())),
);
