import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpBody from "effect/http/HttpBody";

export class TranscriptionError extends Schema.TaggedError<TranscriptionError>()(
  "TranscriptionError",
  { reason: Schema.String },
) {
  override get message() {
    return this.reason;
  }
}
export class OpenRouterTranscriber extends Context.Service<
  OpenRouterTranscriber,
  {
    readonly transcribe: (input: {
      readonly apiKey: string;
      readonly model: string;
      readonly audio: Uint8Array;
      readonly signal: AbortSignal;
    }) => Effect.Effect<string, TranscriptionError>;
  }
>()("@t3tools/desktop/fork/audio/OpenRouterTranscriber") {}

const isTranscriptionError = Schema.is(TranscriptionError);
const decodeTranscript = Schema.decodeUnknownEffect(Schema.Struct({ text: Schema.String }));
const make = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient;
  return OpenRouterTranscriber.of({
    transcribe: Effect.fn("OpenRouterTranscriber.transcribe")((input) => {
      const cancelled = Effect.callback<string, TranscriptionError>((resume) => {
        const abort = () =>
          resume(Effect.fail(new TranscriptionError({ reason: "Transcription was cancelled." })));
        input.signal.addEventListener("abort", abort, { once: true });
        if (input.signal.aborted) abort();
        return Effect.sync(() => input.signal.removeEventListener("abort", abort));
      });
      return client
        .post("https://openrouter.ai/api/v1/audio/transcriptions", {
          headers: { Authorization: `Bearer ${input.apiKey}` },
          body: HttpBody.jsonUnsafe({
            model: input.model,
            language: "ru",
            input_audio: { data: Buffer.from(input.audio).toString("base64"), format: "wav" },
          }),
        })
        .pipe(
          Effect.flatMap((response) => {
            if (response.status < 200 || response.status >= 300) {
              const reasons: Record<number, string> = {
                401: "OpenRouter rejected the API key.",
                403: "OpenRouter denied access to this model.",
                402: "The OpenRouter balance is insufficient.",
                429: "OpenRouter rate limit reached. Try again later.",
              };
              return Effect.fail(
                new TranscriptionError({
                  reason:
                    reasons[response.status] ?? "OpenRouter could not transcribe this recording.",
                }),
              );
            }
            return response.json.pipe(
              Effect.flatMap(decodeTranscript),
              Effect.flatMap((result) =>
                result.text.trim()
                  ? Effect.succeed(result.text.trim())
                  : Effect.fail(new TranscriptionError({ reason: "No speech was recognized." })),
              ),
            );
          }),
          Effect.mapError((error) =>
            isTranscriptionError(error)
              ? error
              : new TranscriptionError({
                  reason: "Could not connect to OpenRouter or decode its response.",
                }),
          ),
          Effect.timeoutOrElse({
            duration: "60 seconds",
            orElse: () =>
              Effect.fail(
                new TranscriptionError({ reason: "OpenRouter transcription timed out." }),
              ),
          }),
          Effect.raceFirst(cancelled),
        );
    }),
  });
});
export const layer = Layer.effect(OpenRouterTranscriber, make);
