export function worktreeReviewSection(id: string, title: string, worktree: string | undefined) {
  return worktree ? { id: `${id}:${worktree}`, title: `${title} (${worktree})` } : { id, title };
}
