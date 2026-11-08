import { RegistryProvider } from "@effect/atom-react";
import { EnvironmentId, ThreadId, type VcsListRefsResult } from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { useState } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page } from "vite-plus/test/browser";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  refs: null as Atom.Atom<AsyncResult.AsyncResult<VcsListRefsResult>> | null,
}));
vi.mock("~/state/vcs", () => ({ vcsEnvironment: { listRefs: () => state.refs! } }));

import { useDiffWorktree } from "./useDiffWorktree";
import { useDiffWorktreeStore } from "./store";

function Probe() {
  const [gitView, setGitView] = useState(true);
  const worktree = useDiffWorktree({
    threadRef: { environmentId: EnvironmentId.make("test"), threadId: ThreadId.make("thread") },
    projectCwd: "/repo",
    defaultCwd: "/repo",
    enabled: gitView,
  });
  return (
    <>
      {worktree.picker}
      <output aria-label="Diff folder">{worktree.cwd}</output>
      <button onClick={() => setGitView(!gitView)}>Toggle turn history</button>
    </>
  );
}

it("selects an external worktree, preserves the historical folder, and returns to the thread folder", async () => {
  useDiffWorktreeStore.setState({ paths: {} });
  state.refs = Atom.make(
    AsyncResult.success({
      refs: [
        {
          name: "feature",
          isRemote: false,
          current: false,
          isDefault: false,
          worktreePath: "/external/worktree",
        },
      ],
      isRepo: true,
      hasPrimaryRemote: false,
      nextCursor: null,
      totalCount: 1,
    }),
  );
  await using screen = await render(
    <RegistryProvider>
      <Probe />
    </RegistryProvider>,
  );
  await screen.getByRole("button", { name: "Diff worktree" }).click();
  await page.getByRole("menuitemradio", { name: /feature/ }).click();
  await expect
    .element(screen.getByRole("status", { name: "Diff folder" }))
    .toHaveTextContent("/external/worktree");
  await screen.getByRole("button", { name: "Toggle turn history" }).click();
  await expect
    .element(screen.getByRole("status", { name: "Diff folder" }))
    .toHaveTextContent("/repo");
  await screen.getByRole("button", { name: "Toggle turn history" }).click();
  await expect
    .element(screen.getByRole("status", { name: "Diff folder" }))
    .toHaveTextContent("/external/worktree");
  await screen.getByRole("button", { name: "Diff worktree" }).click();
  await page.getByRole("menuitemradio", { name: /Thread folder/ }).click();
  await expect
    .element(screen.getByRole("status", { name: "Diff folder" }))
    .toHaveTextContent("/repo");
});
