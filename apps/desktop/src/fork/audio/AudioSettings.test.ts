import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as DesktopConfig from "../../app/DesktopConfig.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import * as ElectronSafeStorage from "../../electron/ElectronSafeStorage.ts";
import * as AudioSettings from "./AudioSettings.ts";

const fixture = <A, E, R>(
  body: (file: string) => Effect.Effect<A, E, R | AudioSettings.AudioSettings>,
  available = true,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectoryScoped();
    const environment = yield* DesktopEnvironment.DesktopEnvironment.pipe(
      Effect.provide(
        DesktopEnvironment.layer({
          dirname: dir,
          homeDirectory: dir,
          platform: "darwin",
          processArch: "arm64",
          appVersion: "0.1.0",
          appPath: dir,
          isPackaged: true,
          resourcesPath: dir,
          runningUnderArm64Translation: false,
        }).pipe(Layer.provide(DesktopConfig.layerTest({ T3CODE_HOME: dir }))),
      ),
    );
    const file = environment.path.join(
      environment.path.dirname(environment.clientSettingsPath),
      "audio-settings.json",
    );
    return yield* body(file).pipe(
      Effect.provide(
        AudioSettings.layer.pipe(
          Layer.provide(Layer.succeed(DesktopEnvironment.DesktopEnvironment, environment)),
          Layer.provide(
            Layer.succeed(ElectronSafeStorage.ElectronSafeStorage, {
              isEncryptionAvailable: Effect.succeed(available),
              selectedStorageBackend: Effect.succeedNone,
              encryptString: (value) => Effect.succeed(Buffer.from(value).reverse()),
              decryptString: (bytes) => Effect.succeed(Buffer.from(bytes).reverse().toString()),
            }),
          ),
        ),
      ),
    );
  });

it.layer(NodeServices.layer)("AudioSettings", (it) => {
  it.effect(
    "encrypts keys, returns only presence, preserves on model edits and supports replacement/removal",
    () =>
      fixture((file) =>
        Effect.gen(function* () {
          const service = yield* AudioSettings.AudioSettings;
          const fs = yield* FileSystem.FileSystem;
          expect(yield* service.get).toMatchObject({ enabled: false, hasApiKey: false });
          const saved = yield* service.save({
            enabled: true,
            model: "openai/whisper-large-v3-turbo",
            apiKey: "test-private-key",
          });
          expect(saved).toEqual({
            enabled: true,
            hasApiKey: true,
            model: "openai/whisper-large-v3-turbo",
          });
          expect(yield* fs.readFileString(file)).not.toContain("test-private-key");
          expect(yield* service.loadKey).toBe("test-private-key");
          yield* service.save({ enabled: true, model: "openai/whisper-large-v3" });
          expect(yield* service.loadKey).toBe("test-private-key");
          yield* service.save({
            enabled: true,
            model: "openai/whisper-large-v3",
            apiKey: "replacement",
          });
          expect(yield* service.loadKey).toBe("replacement");
          yield* service.save({ enabled: false, model: "openai/whisper-large-v3", apiKey: "" });
          expect(yield* service.loadKey).toBe("");
          expect(yield* service.get).toMatchObject({ hasApiKey: false, enabled: false });
        }),
      ),
  );
  it.effect("does not fall back to plaintext when secure storage is unavailable", () =>
    fixture(
      (file) =>
        Effect.gen(function* () {
          const service = yield* AudioSettings.AudioSettings;
          const fs = yield* FileSystem.FileSystem;
          const error = yield* service
            .save({
              enabled: true,
              model: "openai/whisper-large-v3-turbo",
              apiKey: "test-private-key",
            })
            .pipe(Effect.flip);
          expect(error.operation).toBe("encrypt");
          expect(yield* fs.exists(file)).toBe(false);
        }),
      false,
    ),
  );
});
