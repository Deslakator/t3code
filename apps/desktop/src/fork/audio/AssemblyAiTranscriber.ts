import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schedule from "effect/Schedule";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpBody from "effect/http/HttpBody";
import type * as HttpClientResponse from "effect/http/HttpClientResponse";
import { TranscriptionError } from "./OpenRouterTranscriber.ts";

export class AssemblyAiTranscriber extends Context.Service<
  AssemblyAiTranscriber,
  {
    readonly transcribe: (input: {
      readonly apiKey: string;
      readonly audio: Uint8Array;
      readonly signal: AbortSignal;
    }) => Effect.Effect<string, TranscriptionError>;
  }
>()("@t3tools/desktop/fork/audio/AssemblyAiTranscriber") {}

const decodeUpload = Schema.decodeUnknownEffect(Schema.Struct({ upload_url: Schema.String }));
const decodeTranscript = Schema.decodeUnknownEffect(
  Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^[a-zA-Z0-9-]+$/)),
    status: Schema.Literals(["queued", "processing", "completed", "error"]),
    text: Schema.optionalKey(Schema.NullOr(Schema.String)),
  }),
);
const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  const readResponse = Effect.fn("AssemblyAiTranscriber.readResponse")(function* (
    response: HttpClientResponse.HttpClientResponse,
  ) {
    if (response.status < 200 || response.status >= 300) {
      const reasons: Record<number, string> = {
        400: "AssemblyAI rejected the transcription settings or audio.",
        401: "AssemblyAI rejected the API key.",
        402: "The AssemblyAI balance is insufficient.",
        403: "AssemblyAI denied access. Check your account permissions and balance.",
        429: "AssemblyAI rate limit reached. Try again later.",
      };
      return yield* new TranscriptionError({
        reason: reasons[response.status] ?? "AssemblyAI could not transcribe this recording.",
        retryable: response.status === 429 || response.status >= 500,
      });
    }
    return yield* response.json.pipe(
      Effect.mapError(
        () =>
          new TranscriptionError({
            reason: "Could not decode the AssemblyAI response.",
          }),
      ),
    );
  });
  const transportError = () =>
    new TranscriptionError({ reason: "Could not connect to AssemblyAI.", retryable: true });
  return AssemblyAiTranscriber.of({
    transcribe: Effect.fn("AssemblyAiTranscriber.transcribe")((input) => {
      const cancelled = Effect.callback<string, TranscriptionError>((resume) => {
        const abort = () =>
          resume(Effect.fail(new TranscriptionError({ reason: "Transcription was cancelled." })));
        input.signal.addEventListener("abort", abort, { once: true });
        if (input.signal.aborted) abort();
        return Effect.sync(() => input.signal.removeEventListener("abort", abort));
      });
      const headers = { Authorization: input.apiKey };
      return Effect.gen(function* () {
        if (input.signal.aborted)
          return yield* new TranscriptionError({ reason: "Transcription was cancelled." });
        const upload = yield* client
          .post("https://api.assemblyai.com/v2/upload", {
            headers,
            body: HttpBody.uint8Array(input.audio, "application/octet-stream"),
          })
          .pipe(
            Effect.mapError(transportError),
            Effect.flatMap(readResponse),
            Effect.flatMap(decodeUpload),
            Effect.catchTags({
              SchemaError: () =>
                Effect.fail(
                  new TranscriptionError({
                    reason: "AssemblyAI returned an invalid upload response.",
                  }),
                ),
            }),
          );
        // Retrying submission can create duplicate paid jobs after a lost response.
        let transcript = yield* client
          .post("https://api.assemblyai.com/v2/transcript", {
            headers,
            body: HttpBody.jsonUnsafe({
              audio_url: upload.upload_url,
              speech_models: ["universal-2"],
              language_code: "ru",
            }),
          })
          .pipe(
            Effect.mapError(transportError),
            Effect.flatMap(readResponse),
            Effect.flatMap(decodeTranscript),
            Effect.catchTags({
              SchemaError: () =>
                Effect.fail(
                  new TranscriptionError({
                    reason: "AssemblyAI returned an invalid transcript response.",
                  }),
                ),
            }),
          );
        const poll = client
          .get(`https://api.assemblyai.com/v2/transcript/${transcript.id}`, { headers })
          .pipe(
            Effect.mapError(transportError),
            Effect.flatMap(readResponse),
            Effect.flatMap(decodeTranscript),
            Effect.catchTags({
              SchemaError: () =>
                Effect.fail(
                  new TranscriptionError({
                    reason: "AssemblyAI returned an invalid transcript response.",
                  }),
                ),
            }),
            Effect.retry({
              times: 2,
              schedule: Schedule.exponential("1 second"),
              while: (error) => error.retryable === true,
            }),
          );
        while (transcript.status === "queued" || transcript.status === "processing") {
          yield* Effect.sleep("1 second");
          transcript = yield* poll;
        }
        if (transcript.status === "error")
          return yield* new TranscriptionError({
            reason:
              "AssemblyAI could not transcribe this recording. Check the audio and try again.",
          });
        const text = transcript.text?.trim();
        return text ? text : yield* new TranscriptionError({ reason: "No speech was recognized." });
      }).pipe(
        Effect.timeoutOrElse({
          duration: "3 minutes",
          orElse: () =>
            Effect.fail(new TranscriptionError({ reason: "AssemblyAI transcription timed out." })),
        }),
        Effect.raceFirst(cancelled),
      );
    }),
  });
});
export const layer = Layer.effect(AssemblyAiTranscriber, make);
