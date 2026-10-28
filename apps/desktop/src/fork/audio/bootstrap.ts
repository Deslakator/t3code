import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as DesktopIpc from "../../ipc/DesktopIpc.ts";
import * as AudioSettings from "./AudioSettings.ts";
import * as DictationService from "./DictationService.ts";
import * as OpenRouterTranscriber from "./OpenRouterTranscriber.ts";
import * as Methods from "./ipc.ts";

const install = Effect.fn("fork.audio.install")(function* () {
  const ipc = yield* DesktopIpc.DesktopIpc;
  yield* ipc.handle(Methods.execute);
  yield* ipc.handle(Methods.getSettings);
  yield* ipc.handle(Methods.saveSettings);
});

export const layer = Layer.effectDiscard(install()).pipe(
  Layer.provide(
    DictationService.layer.pipe(
      Layer.provideMerge(AudioSettings.layer),
      Layer.provide(OpenRouterTranscriber.layer),
    ),
  ),
);
