import { RegistryProvider } from "@effect/atom-react";
import {
  EnvironmentId,
  type ReviewDiffPreviewInput,
  type ReviewDiffPreviewSource,
} from "@t3tools/contracts";
import { AsyncResult, Atom } from "effect/reactivity";
import { expect, it, vi } from "vite-plus/test";
import { render } from "../../../test/render";

const state = vi.hoisted(() => ({
  requests: [] as ReviewDiffPreviewInput[],
  result: null as Atom.Atom<AsyncResult.AsyncResult<ReviewDiffPreviewSource>> | null,
}));
vi.mock("~/state/review", () => ({
  reviewEnvironment: {
    diffFilePatch: ({ input }: { input: { request: ReviewDiffPreviewInput } }) => {
      state.requests.push(input.request);
      return state.result!;
    },
  },
}));
import { useReviewFilePatches } from "~/components/diffs/useReviewFilePatches";

function Probe() {
  const result = useReviewFilePatches({
    environmentId: EnvironmentId.make("test"),
    cwd: "/external/worktree",
    source: {
      id: "branch",
      kind: "branch-range" as const,
      title: "Changes",
      baseRef: "main",
      headRef: "feature",
      diff: "",
      diffHash: "hash",
      truncated: true,
      files: [{ path: "src/index.ts", previousPath: null, additions: 1, deletions: 1 }],
    },
    baseRef: "main",
    ignoreWhitespace: false,
    theme: "light",
    previewInput: { cwd: "/external/worktree", worktreeProjectRoot: "/repo" },
    preview: null,
  });
  return <output>{result.renderableFiles.length}</output>;
}

it("carries project authorization into lazy patches for a truncated external-worktree diff", async () => {
  state.requests = [];
  state.result = Atom.make(
    AsyncResult.success({
      id: "branch",
      kind: "branch-range" as const,
      title: "Changes",
      baseRef: "main",
      headRef: "feature",
      diff: "",
      diffHash: "hash",
      truncated: false,
    }),
  );
  await using screen = await render(
    <RegistryProvider>
      <Probe />
    </RegistryProvider>,
  );
  await expect.element(screen.getByRole("status")).toHaveTextContent("1");
  expect(state.requests.length).toBeGreaterThan(0);
  expect(
    state.requests.every(
      (request) =>
        request.worktreeProjectRoot === "/repo" &&
        request.cwd === "/external/worktree" &&
        request.file?.path === "src/index.ts",
    ),
  ).toBe(true);
});
