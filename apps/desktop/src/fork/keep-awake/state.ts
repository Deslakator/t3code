import {
  KeepAwakeMode,
  keepsMacAwake,
  type KeepAwakeState,
  type OrchestrationV2ShellStreamItem,
  type ThreadId,
  type ProjectId,
  type OrchestrationV2ThreadShell,
} from "@t3tools/contracts";
import * as Schema from "effect/Schema";

const decodeMode = Schema.decodeUnknownSync(KeepAwakeMode);

export function readMode(document: string): KeepAwakeMode {
  try {
    return decodeMode(JSON.parse(document));
  } catch {
    return "normal";
  }
}

type ActivityThread = Parameters<typeof keepsMacAwake>[0] &
  Pick<OrchestrationV2ThreadShell, "id" | "projectId">;
type ActivityEvent =
  | { kind: "snapshot"; snapshot: { threads: ReadonlyArray<ActivityThread> } }
  | { kind: "thread.updated"; location: "active" | "archive"; thread: ActivityThread }
  | Exclude<OrchestrationV2ShellStreamItem, { kind: "snapshot" | "thread.updated" }>;

export function createKeepAwakeState(
  initialMode: KeepAwakeMode,
  apply: (enabled: boolean) => void,
  notify: (state: KeepAwakeState) => void,
) {
  let mode = initialMode;
  const active = new Map<ThreadId, ProjectId>();
  const state = () => ({ mode, busy: active.size > 0 });
  const sync = () => {
    const value = state();
    apply(mode === "always" || (mode === "tasks" && value.busy));
    notify(value);
    return value;
  };
  sync();
  return {
    state,
    clearTasks: () => {
      active.clear();
      sync();
    },
    setMode: (next: KeepAwakeMode) => {
      mode = next;
      return sync();
    },
    accept: (item: ActivityEvent) => {
      const before = active.size > 0;
      if (item.kind === "snapshot") {
        active.clear();
        for (const thread of item.snapshot.threads) {
          if (keepsMacAwake(thread)) active.set(thread.id, thread.projectId);
        }
      } else if (item.kind === "thread.updated") {
        if (item.location === "active" && keepsMacAwake(item.thread))
          active.set(item.thread.id, item.thread.projectId);
        else active.delete(item.thread.id);
      } else if (item.kind === "thread.removed" && item.location === "active")
        active.delete(item.threadId);
      else if (item.kind === "project.removed") {
        for (const [threadId, projectId] of active)
          if (projectId === item.projectId) active.delete(threadId);
      }
      if (before !== active.size > 0) sync();
    },
  };
}
