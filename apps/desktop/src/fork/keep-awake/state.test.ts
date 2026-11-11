import { expect, it, vi } from "vite-plus/test";
import { ProjectId, ThreadId } from "@t3tools/contracts";
import { createKeepAwakeState, readMode } from "./state.ts";

const running = {
  id: ThreadId.make("thread-1"),
  projectId: ProjectId.make("project-1"),
  status: "running" as const,
  pendingRuntimeRequest: null,
  latestRunId: null,
  usageLimitResetAt: null,
  settledOverride: null,
  lastErrorClass: null,
  archivedAt: null,
  limitRecovery: null,
};

it("tracks tasks without a window and restores current state when a window reopens", () => {
  const apply = vi.fn();
  let windowOpen = true;
  const displayed: unknown[] = [];
  const state = createKeepAwakeState("tasks", apply, (value) => {
    if (windowOpen) displayed.push(value);
  });
  state.accept({ kind: "snapshot", snapshot: { threads: [running] } });
  expect(apply).toHaveBeenLastCalledWith(true);
  windowOpen = false;
  state.accept({
    kind: "thread.updated",
    location: "active",
    thread: { ...running, status: "completed" },
  });
  expect(apply).toHaveBeenLastCalledWith(false);
  expect(displayed.at(-1)).toEqual({ mode: "tasks", busy: true });
  expect(state.state()).toEqual({ mode: "tasks", busy: false });
  state.accept({ kind: "thread.updated", location: "active", thread: running });
  expect(apply).toHaveBeenLastCalledWith(true);
  state.accept({ kind: "snapshot", snapshot: { threads: [] } });
  expect(apply).toHaveBeenLastCalledWith(false);
});

it("normal and always modes override task state", () => {
  const apply = vi.fn();
  const state = createKeepAwakeState("normal", apply, () => {});
  state.accept({ kind: "snapshot", snapshot: { threads: [running] } });
  expect(apply).toHaveBeenLastCalledWith(false);
  state.setMode("always");
  state.accept({ kind: "snapshot", snapshot: { threads: [] } });
  expect(apply).toHaveBeenLastCalledWith(true);
  state.setMode("normal");
  expect(apply).toHaveBeenLastCalledWith(false);
});

it("falls back to normal sleep for damaged or unknown saved settings", () => {
  for (const document of ["{", '"obsolete"', "null", "{}"]) {
    expect(readMode(document)).toBe("normal");
  }
  expect(readMode('"tasks"')).toBe("tasks");
  expect(readMode('"always"')).toBe("always");
});
