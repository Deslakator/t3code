import type {
  DesktopAudioSettings,
  DesktopAudioSettingsUpdate,
} from "@t3tools/contracts/fork/audio";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../../electron/ElectronSafeStorage.ts";

const Stored = Schema.Struct({
  enabled: Schema.Boolean,
  model: Schema.String,
  encryptedApiKey: Schema.String,
});
const encodeStored = Schema.encodeEffect(Schema.fromJsonString(Stored));
const defaults = { enabled: false, model: "openai/whisper-large-v3-turbo", encryptedApiKey: "" };
export class AudioSettingsError extends Schema.TaggedError<AudioSettingsError>()(
  "AudioSettingsError",
  {
    operation: Schema.Literals(["read", "save", "decrypt", "encrypt"]),
  },
) {
  override get message() {
    return `Could not ${this.operation} audio settings. Check macOS secure storage and file access.`;
  }
}
export class AudioSettings extends Context.Service<
  AudioSettings,
  {
    readonly get: Effect.Effect<DesktopAudioSettings, AudioSettingsError>;
    readonly loadKey: Effect.Effect<string, AudioSettingsError>;
    readonly save: (
      input: DesktopAudioSettingsUpdate,
    ) => Effect.Effect<DesktopAudioSettings, AudioSettingsError>;
  }
>()("@t3tools/desktop/fork/audio/AudioSettings") {}

const make = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const env = yield* DesktopEnvironment.DesktopEnvironment;
  const secure = yield* ElectronSafeStorage.ElectronSafeStorage;
  const file = path.join(path.dirname(env.clientSettingsPath), "audio-settings.json");
  const lock = yield* Semaphore.make(1);
  const read = fs.readFileString(file).pipe(
    Effect.catchTags({
      PlatformError: (error) =>
        error.reason._tag === "NotFound"
          ? Effect.succeed(JSON.stringify(defaults))
          : Effect.fail(error),
    }),
    Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Stored))),
    Effect.mapError(() => new AudioSettingsError({ operation: "read" })),
  );
  const publicSettings = (stored: typeof Stored.Type): DesktopAudioSettings => ({
    enabled: stored.enabled,
    model: stored.model,
    hasApiKey: stored.encryptedApiKey !== "",
  });
  return AudioSettings.of({
    get: read.pipe(Effect.map(publicSettings)),
    loadKey: Effect.gen(function* () {
      const stored = yield* read;
      if (!stored.encryptedApiKey) return "";
      return yield* secure
        .decryptString(Buffer.from(stored.encryptedApiKey, "base64"))
        .pipe(Effect.mapError(() => new AudioSettingsError({ operation: "decrypt" })));
    }),
    save: Effect.fn("AudioSettings.save")(function* (input) {
      return yield* lock.withPermits(1)(
        Effect.gen(function* () {
          const stored = yield* read;
          let encryptedApiKey = stored.encryptedApiKey;
          if (input.apiKey !== undefined) {
            if (input.apiKey.trim() === "") encryptedApiKey = "";
            else {
              const available = yield* secure.isEncryptionAvailable.pipe(
                Effect.orElseSucceed(() => false),
              );
              if (!available) return yield* new AudioSettingsError({ operation: "encrypt" });
              const encrypted = yield* secure
                .encryptString(input.apiKey.trim())
                .pipe(Effect.mapError(() => new AudioSettingsError({ operation: "encrypt" })));
              encryptedApiKey = Buffer.from(encrypted).toString("base64");
            }
          }
          const next = { enabled: input.enabled, model: input.model.trim(), encryptedApiKey };
          if (!next.model) return yield* new AudioSettingsError({ operation: "save" });
          const temporary = `${file}.tmp`;
          const encoded = yield* encodeStored(next).pipe(
            Effect.mapError(() => new AudioSettingsError({ operation: "save" })),
          );
          yield* fs.makeDirectory(path.dirname(file), { recursive: true }).pipe(
            Effect.andThen(fs.writeFileString(temporary, encoded, { mode: 0o600 })),
            Effect.andThen(fs.rename(temporary, file)),
            Effect.mapError(() => new AudioSettingsError({ operation: "save" })),
          );
          return publicSettings(next);
        }),
      );
    }),
  });
});
export const layer = Layer.effect(AudioSettings, make);
