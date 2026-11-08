import { createGitDiffFileContentsLoader } from "~/lib/diffFileContents";

export function createDiffWorktreeReviewContext(
  worktree: string | undefined,
  projectRoot: string | undefined,
) {
  const reviewFields = worktree && projectRoot ? { worktreeProjectRoot: projectRoot } : {};
  return {
    reviewFields,
    repositoryRoot: (upstreamRoot: string | undefined) => (worktree ? undefined : upstreamRoot),
    createFileContentsLoader: (
      command: Parameters<typeof createGitDiffFileContentsLoader>[0],
      source: Parameters<typeof createGitDiffFileContentsLoader>[1],
    ) =>
      !worktree
        ? createGitDiffFileContentsLoader(command, source)
        : createGitDiffFileContentsLoader(
            (request) => command({ ...request, input: { ...request.input, ...reviewFields } }),
            { ...source, cacheKey: `${source.cwd}:${source.cacheKey}` },
          ),
  };
}
