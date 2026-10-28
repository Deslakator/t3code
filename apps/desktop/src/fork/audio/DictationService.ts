import * as Crypto from "effect/Crypto";
import {
  DICTATION_MAX_BYTES,
  DICTATION_MAX_SECONDS,
  DICTATION_CHUNK_BYTES,
  type DictationRequest,
  type DictationResult,
} from "@t3tools/contracts/fork/audio";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Clock from "effect/Clock";
import * as Schedule from "effect/Schedule";
import * as AudioSettings from "./AudioSettings.ts";
import * as OpenRouterTranscriber from "./OpenRouterTranscriber.ts";

type Upload = {
  owner: string;
  chunks: Buffer[];
  size: number;
  updated: number;
  lastOffset: number;
  lastData: string;
  controller: AbortController;
  finishing: boolean;
};
export class DictationService extends Context.Service<
  DictationService,
  {
    readonly cancelAll: Effect.Effect<void>;
    readonly execute: (
      owner: string,
      input: DictationRequest,
    ) => Effect.Effect<DictationResult, AudioSettings.AudioSettingsError>;
  }
>()("@t3tools/desktop/fork/audio/DictationService") {}

export function validDictationWav(audio: Uint8Array): boolean {
  if (audio.length <= 44 || audio.length > DICTATION_MAX_BYTES || (audio.length - 44) % 2 !== 0)
    return false;
  const b = Buffer.from(audio);
  return (
    b.toString("ascii", 0, 4) === "RIFF" &&
    b.toString("ascii", 8, 12) === "WAVE" &&
    b.toString("ascii", 12, 16) === "fmt " &&
    b.readUInt32LE(16) === 16 &&
    b.readUInt16LE(20) === 1 &&
    b.readUInt16LE(22) === 1 &&
    b.readUInt32LE(24) === 16000 &&
    b.readUInt32LE(28) === 32000 &&
    b.readUInt16LE(32) === 2 &&
    b.readUInt16LE(34) === 16 &&
    b.toString("ascii", 36, 40) === "data" &&
    b.readUInt32LE(40) === b.length - 44 &&
    b.readUInt32LE(4) === b.length - 8
  );
}

const make = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto;
  const preferences = yield* AudioSettings.AudioSettings;
  const transcriber = yield* OpenRouterTranscriber.OpenRouterTranscriber;
  const uploads = new Map<string, Upload>();
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      for (const upload of uploads.values()) upload.controller.abort();
      uploads.clear();
    }),
  );
  yield* Effect.forkScoped(
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      for (const [id, upload] of uploads) {
        if (now - upload.updated > 10 * 60_000) {
          upload.controller.abort();
          uploads.delete(id);
        }
      }
    }).pipe(Effect.repeat(Schedule.spaced("1 minute"))),
  );
  const failure = (message: string): DictationResult => ({ kind: "error", message });
  return DictationService.of({
    cancelAll: Effect.sync(() => {
      for (const upload of uploads.values()) upload.controller.abort();
      uploads.clear();
    }),
    execute: Effect.fn("DictationService.execute")(function* (
      owner: string,
      input: DictationRequest,
    ): Effect.fn.Return<DictationResult, AudioSettings.AudioSettingsError> {
      const now = yield* Clock.currentTimeMillis;
      for (const [id, upload] of uploads) {
        if (now - upload.updated > 10 * 60_000) {
          upload.controller.abort();
          uploads.delete(id);
        }
      }
      if (input.type === "cancel") {
        const upload = uploads.get(input.uploadId);
        if (upload?.owner === owner) {
          upload.controller.abort();
          uploads.delete(input.uploadId);
        }
        return { kind: "ok" };
      }
      const settings = yield* preferences.get;
      if (input.type === "status")
        return {
          kind: "status",
          enabled: settings.enabled && settings.hasApiKey,
          maxSeconds: DICTATION_MAX_SECONDS,
          maxBytes: DICTATION_MAX_BYTES,
        };
      if (!settings.enabled || !settings.hasApiKey)
        return failure("Configure Audio in Settings → General on this Mac.");
      if (input.type === "start") {
        if (uploads.size >= 4 || [...uploads.values()].some((u) => u.owner === owner)) {
          return failure("A dictation is already active. Cancel it or try again later.");
        }
        const uploadId = yield* crypto.randomUUIDv4().pipe(Effect.orDie);
        uploads.set(uploadId, {
          owner,
          chunks: [],
          size: 0,
          updated: now,
          lastOffset: -1,
          lastData: "",
          // @effect-diagnostics-next-line abortControllerInEffect:off -- A separate IPC cancel call must abort an upload owned by another invocation.
          controller: new AbortController(),
          finishing: false,
        });
        return { kind: "upload", uploadId };
      }
      const upload = uploads.get(input.uploadId);
      if (!upload || upload.owner !== owner)
        return failure("Recording expired or belongs to another session.");
      if (upload.finishing) return failure("This recording is already being transcribed.");
      upload.updated = now;
      if (input.type === "append") {
        if (input.offset === upload.lastOffset && input.data === upload.lastData)
          return { kind: "ok" };
        if (
          input.offset !== upload.size ||
          !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(input.data)
        ) {
          return failure("Invalid recording chunk or offset.");
        }
        const chunk = Buffer.from(input.data, "base64");
        if (
          !chunk.length ||
          chunk.length > DICTATION_CHUNK_BYTES ||
          upload.size + chunk.length > DICTATION_MAX_BYTES
        ) {
          upload.controller.abort();
          uploads.delete(input.uploadId);
          return failure("Recording exceeds the size limit.");
        }
        upload.lastOffset = input.offset;
        upload.lastData = input.data;
        upload.chunks.push(chunk);
        upload.size += chunk.length;
        return { kind: "ok" };
      }
      const audio = Buffer.concat(upload.chunks);
      if (!validDictationWav(audio)) {
        uploads.delete(input.uploadId);
        return failure("Invalid or empty recording. Expected mono PCM16 WAV at 16 kHz.");
      }
      upload.finishing = true;
      upload.chunks = [];
      upload.lastData = "";
      return yield* preferences.loadKey.pipe(
        Effect.flatMap((apiKey) =>
          transcriber.transcribe({
            audio,
            apiKey,
            model: settings.model,
            signal: upload.controller.signal,
          }),
        ),
        Effect.map((text): DictationResult => ({ kind: "transcript", text })),
        Effect.catchTags({
          TranscriptionError: (error) => Effect.succeed(failure(error.message)),
        }),
        Effect.ensuring(
          Effect.sync(() => {
            upload.controller.abort();
            uploads.delete(input.uploadId);
          }),
        ),
      );
    }),
  });
});
export const layer = Layer.effect(DictationService, make);
