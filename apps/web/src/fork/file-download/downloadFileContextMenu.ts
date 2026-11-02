import type { ContextMenuItem, EnvironmentId } from "@t3tools/contracts";
import type { FileContextMenuAction as BaseAction, FileContextMenuTarget } from "~/fileContextMenu";

export type FileContextMenuAction = BaseAction | "download";
type Target = FileContextMenuTarget & { readonly isDirectory: boolean };

export function downloadFileContextMenu(
  base: {
    buildItems: (target: Target) => readonly ContextMenuItem<BaseAction>[];
    activate: (action: BaseAction, target: Target) => Promise<void>;
  },
  download: { available: boolean; download: (path: string) => Promise<void> },
  environmentId: EnvironmentId,
  resolvePath: (target: Target) => string | null,
) {
  const downloadPath = (target: Target) =>
    download.available && !target.isDirectory && target.environmentId === environmentId
      ? resolvePath(target)
      : null;
  return {
    buildItems: (target: Target): readonly ContextMenuItem<FileContextMenuAction>[] => [
      ...(downloadPath(target) !== null ? [{ id: "download" as const, label: "Download" }] : []),
      ...base.buildItems(target),
    ],
    activate: async (action: FileContextMenuAction, target: Target) => {
      if (action !== "download") return base.activate(action, target);
      const path = downloadPath(target);
      if (path !== null) await download.download(path);
    },
  };
}
