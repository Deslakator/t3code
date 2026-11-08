import { expect, it } from "vite-plus/test";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { selectedDiffWorktree, useDiffWorktreeStore } from "./store";

it("keeps the diff folder per environment and thread, and returns to the thread folder", () => {
  const first = { environmentId: EnvironmentId.make("first"), threadId: ThreadId.make("thread") };
  const second = { ...first, environmentId: EnvironmentId.make("second") };
  useDiffWorktreeStore.setState({ paths: {} });
  const store = useDiffWorktreeStore.getState();
  store.select(first, "/repo", "/repo-worktree");
  const paths = useDiffWorktreeStore.getState().paths;
  expect(selectedDiffWorktree(paths, first, "/repo")).toBe("/repo-worktree");
  expect(selectedDiffWorktree(paths, second, "/repo")).toBeUndefined();
  expect(selectedDiffWorktree(paths, first, "/other-repo")).toBeUndefined();
  store.select(first, "/repo", null);
  expect(
    selectedDiffWorktree(useDiffWorktreeStore.getState().paths, first, "/repo"),
  ).toBeUndefined();
});
