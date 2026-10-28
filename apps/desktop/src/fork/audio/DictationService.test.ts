import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Deferred from "effect/Deferred";
import * as Fiber from "effect/Fiber";
import { DICTATION_MAX_BYTES, type DictationResult } from "@t3tools/contracts/fork/audio";
import * as AudioSettings from "./AudioSettings.ts";
import * as DictationService from "./DictationService.ts";
import * as OpenRouterTranscriber from "./OpenRouterTranscriber.ts";

function wav() {
  const audio = Buffer.alloc(46);
  audio.write("RIFF");
  audio.writeUInt32LE(38, 4);
  audio.write("WAVEfmt ", 8);
  audio.writeUInt32LE(16, 16);
  audio.writeUInt16LE(1, 20);
  audio.writeUInt16LE(1, 22);
  audio.writeUInt32LE(16000, 24);
  audio.writeUInt32LE(32000, 28);
  audio.writeUInt16LE(2, 32);
  audio.writeUInt16LE(16, 34);
  audio.write("data", 36);
  audio.writeUInt32LE(2, 40);
  return audio;
}
function uploadId(result: DictationResult) {
  if (result.kind !== "upload") throw new Error("Expected upload");
  return result.uploadId;
}
const fixture = <A, E, R>(
  enabled: boolean,
  body: Effect.Effect<A, E, R | DictationService.DictationService>,
  transcribe: OpenRouterTranscriber.OpenRouterTranscriber["Service"]["transcribe"] = () =>
    Effect.succeed("Используй TypeScript и OpenRouter."),
  loadKey: AudioSettings.AudioSettings["Service"]["loadKey"] = Effect.succeed("test-key"),
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeTempDirectoryScoped();
    return yield* body.pipe(
      Effect.provide(
        DictationService.layer.pipe(
          Layer.provide(Layer.succeed(OpenRouterTranscriber.OpenRouterTranscriber, { transcribe })),
          Layer.provide(
            Layer.succeed(AudioSettings.AudioSettings, {
              get: Effect.succeed({
                enabled,
                hasApiKey: enabled,
                model: "openai/whisper-large-v3-turbo",
              }),
              loadKey,
              save: () => Effect.die("Settings writes are not expected in upload tests"),
            }),
          ),
        ),
      ),
    );
  });

it.layer(NodeServices.layer)("DictationService", (it) => {
  it.effect("is disabled without desktop settings", () =>
    fixture(
      false,
      Effect.gen(function* () {
        const service = yield* DictationService.DictationService;
        expect(yield* service.execute("a", { type: "status" })).toMatchObject({
          kind: "status",
          enabled: false,
        });
        expect(yield* service.execute("a", { type: "start" })).toMatchObject({ kind: "error" });
      }),
    ),
  );
  it.effect(
    "isolates uploads by window, accepts duplicate chunks and preserves Russian/English transcript",
    () =>
      fixture(
        true,
        Effect.gen(function* () {
          const service = yield* DictationService.DictationService;
          const id = uploadId(yield* service.execute("a", { type: "start" }));
          const request = {
            type: "append",
            uploadId: id,
            offset: 0,
            data: wav().toString("base64"),
          } as const;
          expect(yield* service.execute("b", request)).toMatchObject({ kind: "error" });
          expect(yield* service.execute("a", request)).toEqual({ kind: "ok" });
          expect(yield* service.execute("a", request)).toEqual({ kind: "ok" });
          expect(yield* service.execute("a", { type: "finish", uploadId: id })).toEqual({
            kind: "transcript",
            text: "Используй TypeScript и OpenRouter.",
          });
          expect(yield* service.execute("a", { type: "finish", uploadId: id })).toMatchObject({
            kind: "error",
          });
        }),
      ),
  );
  it.effect("rejects invalid offsets and oversized recordings without invoking transcription", () =>
    fixture(
      true,
      Effect.gen(function* () {
        const service = yield* DictationService.DictationService;
        const id = uploadId(yield* service.execute("a", { type: "start" }));
        expect(
          yield* service.execute("a", { type: "append", uploadId: id, offset: 4, data: "AAAA" }),
        ).toMatchObject({ kind: "error" });
        expect(yield* service.execute("a", { type: "finish", uploadId: id })).toMatchObject({
          kind: "error",
        });
        expect(DictationService.validDictationWav(Buffer.alloc(DICTATION_MAX_BYTES + 1))).toBe(
          false,
        );
        expect(DictationService.validDictationWav(wav())).toBe(true);
      }),
      () => Effect.die("Invalid audio reached the provider"),
    ),
  );
  it.effect("releases the upload when reading the API key fails without a renderer cancel", () =>
    fixture(
      true,
      Effect.gen(function* () {
        const service = yield* DictationService.DictationService;
        const id = uploadId(yield* service.execute("a", { type: "start" }));
        yield* service.execute("a", {
          type: "append",
          uploadId: id,
          offset: 0,
          data: wav().toString("base64"),
        });
        const result = yield* service
          .execute("a", { type: "finish", uploadId: id })
          .pipe(Effect.flip);
        expect(result).toMatchObject({ _tag: "AudioSettingsError", operation: "decrypt" });
        expect(yield* service.execute("a", { type: "start" })).toMatchObject({ kind: "upload" });
      }),
      () => Effect.die("A failed key read must not reach the provider"),
      Effect.fail(new AudioSettings.AudioSettingsError({ operation: "decrypt" })),
    ),
  );
  it.effect("cancels an in-flight provider request and releases the upload", () =>
    Effect.gen(function* () {
      const entered = yield* Deferred.make<void>();
      yield* fixture(
        true,
        Effect.gen(function* () {
          const service = yield* DictationService.DictationService;
          const id = uploadId(yield* service.execute("a", { type: "start" }));
          yield* service.execute("a", {
            type: "append",
            uploadId: id,
            offset: 0,
            data: wav().toString("base64"),
          });
          const fiber = yield* service
            .execute("a", { type: "finish", uploadId: id })
            .pipe(Effect.forkChild);
          yield* Deferred.await(entered);
          expect(yield* service.execute("a", { type: "cancel", uploadId: id })).toEqual({
            kind: "ok",
          });
          expect(yield* Fiber.join(fiber)).toMatchObject({ kind: "error" });
          expect(yield* service.execute("a", { type: "start" })).toMatchObject({ kind: "upload" });
        }),
        (input) =>
          Effect.gen(function* () {
            yield* Deferred.succeed(entered, undefined);
            return yield* Effect.callback<string, OpenRouterTranscriber.TranscriptionError>(
              (resume) => {
                const onAbort = () =>
                  resume(
                    Effect.fail(
                      new OpenRouterTranscriber.TranscriptionError({ reason: "Cancelled" }),
                    ),
                  );
                input.signal.addEventListener("abort", onAbort, { once: true });
                if (input.signal.aborted) onAbort();
                return Effect.sync(() => input.signal.removeEventListener("abort", onAbort));
              },
            );
          }),
      );
    }),
  );
});
