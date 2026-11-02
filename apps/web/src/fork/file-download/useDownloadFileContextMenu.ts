import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { useFileContextMenu, resolveFileContextMenuAbsolutePath } from "~/fileContextMenu";
import { downloadFileContextMenu } from "./downloadFileContextMenu";
import { useFileDownload } from "./useFileDownload";

export type { FileContextMenuAction } from "./downloadFileContextMenu";

export function useDownloadFileContextMenu(environmentId: EnvironmentId, threadId: ThreadId) {
  const base = useFileContextMenu(environmentId);
  const download = useFileDownload(environmentId, threadId);
  return downloadFileContextMenu(base, download, environmentId, resolveFileContextMenuAbsolutePath);
}
