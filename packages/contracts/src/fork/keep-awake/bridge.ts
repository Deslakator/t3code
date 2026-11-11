import * as Schema from "effect/Schema";

export const KeepAwakeMode = Schema.Literals(["normal", "tasks", "always"]);
export type KeepAwakeMode = typeof KeepAwakeMode.Type;
export const KeepAwakeState = Schema.Struct({ mode: KeepAwakeMode, busy: Schema.Boolean });
export type KeepAwakeState = typeof KeepAwakeState.Type;

export interface KeepAwakeBridge {
  getKeepAwakeState?: () => Promise<KeepAwakeState>;
  setKeepAwakeMode?: (mode: KeepAwakeMode) => Promise<KeepAwakeState>;
  onKeepAwakeState?: (listener: (state: KeepAwakeState) => void) => () => void;
}
