import type { ScopedThreadRef } from "@t3tools/contracts";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { resolveStorage } from "~/lib/storage";

export const useDiffWorktreeStore = create<{
  paths: Record<string, { projectCwd: string; path: string }>;
  select: (ref: ScopedThreadRef, projectCwd: string, path: string | null) => void;
}>()(
  persist(
    (set) => ({
      paths: {},
      select: (ref, projectCwd, path) =>
        set((state) => {
          const paths = { ...state.paths };
          const key = scopedThreadKey(ref);
          if (path === null) delete paths[key];
          else paths[key] = { projectCwd, path };
          return { paths };
        }),
    }),
    {
      name: "t3-fork-diff-worktree",
      storage: createJSONStorage(() =>
        resolveStorage(typeof window !== "undefined" ? window.localStorage : undefined),
      ),
    },
  ),
);

export function selectedDiffWorktree(
  paths: ReturnType<typeof useDiffWorktreeStore.getState>["paths"],
  ref: ScopedThreadRef | null,
  projectCwd: string | undefined,
) {
  const selected = ref ? paths[scopedThreadKey(ref)] : undefined;
  return selected?.projectCwd === projectCwd ? selected?.path : undefined;
}
