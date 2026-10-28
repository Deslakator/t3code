import {
  DictationRequest,
  DesktopAudioSettings,
  DesktopAudioSettingsUpdate,
} from "@t3tools/contracts/fork/audio";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import * as DesktopIpc from "../../ipc/DesktopIpc.ts";
import * as Channels from "./channels.ts";
import * as DictationService from "./DictationService.ts";
import * as AudioSettings from "./AudioSettings.ts";

const decodeRequest = Schema.decodeUnknownEffect(DictationRequest);

export const execute: DesktopIpc.DesktopIpcMethod<
  AudioSettings.AudioSettingsError,
  DictationService.DictationService
> = {
  channel: Channels.DICTATION_CHANNEL,
  handler: Effect.fn("desktop.dictation.execute")(function* (raw, event) {
    const input = yield* decodeRequest(raw).pipe(Effect.orElseSucceed(() => null));
    if (!input || !event) return { kind: "error", message: "Invalid dictation request." };
    const service = yield* DictationService.DictationService;
    return yield* service.execute(String(event.sender.id), input).pipe(
      Effect.catchTags({
        AudioSettingsError: (error) =>
          Effect.succeed({ kind: "error" as const, message: error.message }),
      }),
    );
  }),
};
export const getSettings = DesktopIpc.makeIpcMethod({
  channel: Channels.AUDIO_SETTINGS_GET_CHANNEL,
  payload: Schema.Void,
  result: DesktopAudioSettings,
  handler: Effect.fn("desktop.audio.getSettings")(function* () {
    return yield* (yield* AudioSettings.AudioSettings).get;
  }),
});
export const saveSettings = DesktopIpc.makeIpcMethod({
  channel: Channels.AUDIO_SETTINGS_SAVE_CHANNEL,
  payload: DesktopAudioSettingsUpdate,
  result: DesktopAudioSettings,
  handler: Effect.fn("desktop.audio.saveSettings")(function* (input) {
    const saved = yield* (yield* AudioSettings.AudioSettings).save(input);
    yield* (yield* DictationService.DictationService).cancelAll;
    return saved;
  }),
});
