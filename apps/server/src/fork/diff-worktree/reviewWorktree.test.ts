import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import { ProjectId } from "@t3tools/contracts";
import * as ServerConfig from "../../config.ts";
import * as ProjectStore from "../../orchestration-v2/ProjectStore.ts";
import * as ReviewService from "../../review/ReviewService.ts";
import * as GitVcsDriver from "../../vcs/GitVcsDriver.ts";
import * as VcsDriverRegistry from "../../vcs/VcsDriverRegistry.ts";
import * as KnownWorkspaces from "../../workspace/KnownWorkspaces.ts";

it.effect("reviews an external Git worktree without attaching any thread to it", () =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const root = yield* fs.makeTempDirectoryScoped();
    const external = yield* fs.makeTempDirectoryScoped();
    const unrelated = yield* fs.makeTempDirectoryScoped();
    const check = Effect.gen(function* () {
      const review = yield* ReviewService.ReviewService;
      const preview = yield* review.getDiffPreview({ cwd: external, worktreeProjectRoot: root });
      assert.strictEqual(preview.cwd, external);
      const commits = yield* review.getBranchCommits({ cwd: external, worktreeProjectRoot: root });
      assert.deepStrictEqual(commits.commits, []);
      const contentsError = yield* review
        .getDiffFileContents({
          cwd: external,
          worktreeProjectRoot: root,
          sourceKind: "working-tree",
          changeType: "change",
          baseRef: null,
          headRef: null,
          oldPath: "file.ts",
          newPath: "file.ts",
        })
        .pipe(Effect.flip);
      assert.strictEqual(contentsError._tag, "VcsUnsupportedOperationError");
      const withoutSelection = yield* review.getDiffPreview({ cwd: external }).pipe(Effect.flip);
      assert.strictEqual(withoutSelection._tag, "VcsRepositoryDetectionError");
      const wrongProject = yield* review
        .getDiffPreview({ cwd: external, worktreeProjectRoot: unrelated })
        .pipe(Effect.flip);
      assert.strictEqual(wrongProject._tag, "VcsRepositoryDetectionError");
      const error = yield* review
        .getDiffPreview({ cwd: unrelated, worktreeProjectRoot: root })
        .pipe(Effect.flip);
      assert.strictEqual(error._tag, "VcsRepositoryDetectionError");
    });
    yield* check.pipe(
      Effect.provide(
        ReviewService.layer.pipe(
          Layer.provide(
            Layer.mock(KnownWorkspaces.KnownWorkspaces)({ contains: () => Effect.succeed(false) }),
          ),
          Layer.provide(
            Layer.mock(ProjectStore.ProjectStoreV2)({
              listShells: () =>
                Effect.succeed([
                  {
                    id: ProjectId.make("project"),
                    title: "Project",
                    workspaceRoot: root,
                    defaultModelSelection: null,
                    scripts: [],
                    createdAt: "2026-01-01T00:00:00.000Z",
                    updatedAt: "2026-01-01T00:00:00.000Z",
                  },
                ]),
            }),
          ),
          Layer.provide(
            Layer.mock(GitVcsDriver.GitVcsDriver)({
              listWorktreePaths: () => Effect.succeed([root, external]),
            }),
          ),
          Layer.provide(
            Layer.mock(VcsDriverRegistry.VcsDriverRegistry)({ detect: () => Effect.succeed(null) }),
          ),
          Layer.provide(ServerConfig.layerTest(root, root)),
          Layer.provide(NodeServices.layer),
        ),
      ),
    );
  }).pipe(Effect.provide(NodeServices.layer)),
);
