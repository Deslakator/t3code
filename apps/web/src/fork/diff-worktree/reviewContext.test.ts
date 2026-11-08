import { expect, it, vi } from "vite-plus/test";
import { EnvironmentId } from "@t3tools/contracts";
import { AsyncResult } from "effect/reactivity";
import { createGitDiffFileContentsLoader } from "~/lib/diffFileContents";
import { getRenderablePatch } from "~/lib/diffRendering";
import { createDiffWorktreeReviewContext } from "./reviewContext";

function file() {
  const patch = getRenderablePatch(
    "diff --git a/file.ts b/file.ts\n--- a/file.ts\n+++ b/file.ts\n@@ -1 +1 @@\n-before\n+after\n",
    "review-context",
  );
  if (patch?.kind !== "files" || !patch.files[0]) throw new Error("Expected a file patch");
  return patch.files[0];
}

it("preserves upstream file contents, cache keys, and repository roots without an override", async () => {
  const command = vi.fn(async () =>
    AsyncResult.success({ oldContents: "before", newContents: "after" }),
  );
  const source = {
    environmentId: EnvironmentId.make("test"),
    cwd: "/repo",
    sourceKind: "working-tree" as const,
    baseRef: null,
    headRef: null,
    cacheKey: "hash",
  };
  const context = createDiffWorktreeReviewContext(undefined, "/project");
  const baseline = await createGitDiffFileContentsLoader(command, source)(file());
  const result = await context.createFileContentsLoader(command, source)(file());
  expect(result).toEqual(baseline);
  expect(command.mock.calls[1]).toEqual(command.mock.calls[0]);
  expect(context.repositoryRoot("/repository")).toBe("/repository");
  expect(context.repositoryRoot(undefined)).toBeUndefined();
  expect(context.reviewFields).toEqual({});
});

it("authorizes external file reads and separates identical diff hashes between worktrees", async () => {
  const command = vi.fn<Parameters<typeof createGitDiffFileContentsLoader>[0]>(async () =>
    AsyncResult.success({ oldContents: "before", newContents: "after" }),
  );
  const results = [];
  for (const cwd of ["/worktree-a", "/worktree-b"]) {
    const context = createDiffWorktreeReviewContext(cwd, "/repo");
    results.push(
      await context.createFileContentsLoader(command, {
        environmentId: EnvironmentId.make("test"),
        cwd,
        sourceKind: "working-tree",
        baseRef: null,
        headRef: null,
        cacheKey: "same-hash",
      })(file()),
    );
    expect(context.repositoryRoot("/original-root")).toBeUndefined();
  }
  expect(command.mock.calls.map(([request]) => request.input)).toEqual([
    expect.objectContaining({ cwd: "/worktree-a", worktreeProjectRoot: "/repo" }),
    expect.objectContaining({ cwd: "/worktree-b", worktreeProjectRoot: "/repo" }),
  ]);
  expect(results[0]?.newFile.cacheKey).not.toBe(results[1]?.newFile.cacheKey);
});
