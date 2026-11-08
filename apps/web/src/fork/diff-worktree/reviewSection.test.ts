import { expect, it } from "vite-plus/test";
import { worktreeReviewSection } from "./reviewSection";

it("isolates comments for the same relative file in separate worktrees and identifies the checkout to the agent", () => {
  const original = worktreeReviewSection("branch", "Changes", undefined);
  const first = worktreeReviewSection("branch", "Changes", "/repo-feature");
  const second = worktreeReviewSection("branch", "Changes", "/repo-other");
  const comment = { sectionId: first.id, filePath: "src/index.ts" };
  expect([original, first, second].filter((section) => section.id === comment.sectionId)).toEqual([
    first,
  ]);
  expect(first.title).toContain("/repo-feature");
  expect(second.title).toContain("/repo-other");
  expect(original).toEqual({ id: "branch", title: "Changes" });
});
