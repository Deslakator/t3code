import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Path from "effect/Path";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";

export const makeProjectReviewWorktree = Effect.gen(function* () {
  const projects = yield* ProjectStore.ProjectStoreV2;
  const git = yield* GitVcsDriver.GitVcsDriver;
  const fs = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  return Effect.fn("DiffWorktree.isProjectReviewWorktree")(function* (
    candidate: string,
    projectRoot: string,
  ) {
    const shells = yield* projects.listShells().pipe(Effect.orElseSucceed(() => []));
    const requestedRoot = yield* fs
      .realPath(path.resolve(projectRoot))
      .pipe(Effect.orElseSucceed(() => null));
    if (requestedRoot === null || candidate === path.parse(candidate).root) return false;
    for (const project of shells) {
      const registeredRoot = yield* fs
        .realPath(path.resolve(project.workspaceRoot))
        .pipe(Effect.orElseSucceed(() => null));
      if (registeredRoot !== requestedRoot) continue;
      const worktrees = yield* git
        .listWorktreePaths(project.workspaceRoot)
        .pipe(Effect.orElseSucceed((): ReadonlyArray<string> => []));
      for (const worktree of worktrees) {
        const real = yield* fs
          .realPath(path.resolve(worktree))
          .pipe(Effect.orElseSucceed(() => null));
        if (real === candidate) return true;
      }
    }
    return false;
  });
});
