import { BrowserWindow, powerSaveBlocker } from "electron";
import { KeepAwakeMode, KeepAwakeState } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Schema from "effect/Schema";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as Stream from "effect/Stream";
import * as Semaphore from "effect/Semaphore";
import * as HostProcess from "@t3tools/shared/HostProcess";
import * as DesktopIpc from "../../ipc/DesktopIpc.ts";
import * as ElectronApp from "../../electron/ElectronApp.ts";
import * as DesktopEnvironment from "../../app/DesktopEnvironment.ts";
import { createKeepAwakeController } from "./controller.ts";
import { createKeepAwakeState, readMode } from "./state.ts";
import { watchLocalTasks } from "./subscription.ts";

const encodeMode = Schema.encodeEffect(Schema.fromJsonString(KeepAwakeMode));

export const installKeepAwake = Effect.fn("desktop.fork.installKeepAwake")(function* () {
  const platform = yield* HostProcess.Platform;
  if (platform !== "darwin") return;
  const ipc = yield* DesktopIpc.DesktopIpc;
  const app = yield* ElectronApp.ElectronApp;
  const environment = yield* DesktopEnvironment.DesktopEnvironment;
  const fs = yield* FileSystem.FileSystem;
  const mutex = yield* Semaphore.make(1);
  const path = environment.path.join(environment.stateDir, "keep-awake.json");
  const initialMode = yield* fs.readFileString(path).pipe(
    Effect.map(readMode),
    Effect.orElseSucceed(() => "normal" as const),
  );
  const modes = yield* SubscriptionRef.make(initialMode);
  const update = createKeepAwakeController(powerSaveBlocker);
  const state = createKeepAwakeState(initialMode, update, (value) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) window.webContents.send("fork:keep-awake:state", value);
    }
  });
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "fork:keep-awake:get",
      payload: Schema.Void,
      result: KeepAwakeState,
      handler: () => Effect.sync(state.state),
    }),
  );
  yield* ipc.handle(
    DesktopIpc.makeIpcMethod({
      channel: "fork:keep-awake:set",
      payload: KeepAwakeMode,
      result: KeepAwakeState,
      handler: (mode) =>
        mutex.withPermits(1)(
          Effect.gen(function* () {
            yield* fs.makeDirectory(environment.stateDir, { recursive: true });
            yield* fs.writeFileString(`${path}.tmp`, yield* encodeMode(mode));
            yield* fs.rename(`${path}.tmp`, path);
            const value = state.setMode(mode);
            yield* SubscriptionRef.set(modes, mode);
            return value;
          }),
        ),
    }),
  );
  const clear = () => update(false);
  yield* app.on("before-quit", clear);
  yield* Effect.addFinalizer(() => Effect.sync(clear));
  yield* SubscriptionRef.changes(modes).pipe(
    Stream.changes,
    Stream.switchMap((mode) =>
      mode === "tasks"
        ? Stream.fromEffect(watchLocalTasks(state.accept, state.clearTasks))
        : Stream.empty,
    ),
    Stream.runDrain,
    Effect.forkScoped,
  );
});
