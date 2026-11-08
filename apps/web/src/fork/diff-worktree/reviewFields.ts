import type { ReviewDiffPreviewInput } from "@t3tools/contracts";

export function reviewWorktreeRequestFields(preview: ReviewDiffPreviewInput | undefined) {
  return preview?.worktreeProjectRoot ? { worktreeProjectRoot: preview.worktreeProjectRoot } : {};
}
