import * as Schema from "effect/Schema";

export const DICTATION_MAX_SECONDS = 300;
export const DICTATION_MAX_BYTES = 16_000 * 2 * DICTATION_MAX_SECONDS + 44;
export const DICTATION_CHUNK_BYTES = 48_000;
const UploadId = Schema.String.check(Schema.isPattern(/^[a-f0-9-]{36}$/));
export const DictationRequest = Schema.Union([
  Schema.Struct({ type: Schema.Literal("status") }),
  Schema.Struct({ type: Schema.Literal("start") }),
  Schema.Struct({
    type: Schema.Literal("append"),
    uploadId: UploadId,
    offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
    data: Schema.String.check(Schema.isMaxLength(64_000)),
  }),
  Schema.Struct({ type: Schema.Literal("finish"), uploadId: UploadId }),
  Schema.Struct({ type: Schema.Literal("cancel"), uploadId: UploadId }),
]);
export type DictationRequest = typeof DictationRequest.Type;
export const DictationResult = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("status"),
    enabled: Schema.Boolean,
    maxSeconds: Schema.Number,
    maxBytes: Schema.Number,
  }),
  Schema.Struct({ kind: Schema.Literal("upload"), uploadId: UploadId }),
  Schema.Struct({ kind: Schema.Literal("ok") }),
  Schema.Struct({ kind: Schema.Literal("transcript"), text: Schema.String }),
  Schema.Struct({ kind: Schema.Literal("error"), message: Schema.String }),
]);
export type DictationResult = typeof DictationResult.Type;

export const DesktopAudioSettings = Schema.Struct({
  enabled: Schema.Boolean,
  hasApiKey: Schema.Boolean,
  model: Schema.String,
});
export type DesktopAudioSettings = typeof DesktopAudioSettings.Type;
export const DesktopAudioSettingsUpdate = Schema.Struct({
  enabled: Schema.Boolean,
  model: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  apiKey: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(1024))),
});
export type DesktopAudioSettingsUpdate = typeof DesktopAudioSettingsUpdate.Type;

export interface ForkAudioBridge {
  execute(request: DictationRequest): Promise<DictationResult>;
  getSettings(): Promise<DesktopAudioSettings>;
  saveSettings(settings: DesktopAudioSettingsUpdate): Promise<DesktopAudioSettings>;
}

declare global {
  interface Window {
    forkAudio?: ForkAudioBridge;
  }
}
