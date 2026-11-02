import { useRef, useState } from "react";
import type { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { squashAtomCommandFailure } from "@t3tools/client-runtime/state/runtime";
import { DownloadIcon } from "lucide-react";
import { resolveAssetUrl } from "~/assets/assetUrls";
import { assetEnvironment } from "~/state/assets";
import { useFilesystemReadAccess } from "~/state/filesystem";
import { useRemoteOpenState } from "~/remoteOpen";
import { usePreparedConnection } from "~/state/session";
import { useAtomQueryRunner } from "~/state/use-atom-query-runner";
import { toastManager } from "~/components/ui/toast";
import { FileSurfaceAction } from "~/components/files/fileSurfaceChrome";

import { saveFileUrl } from "./saveFileUrl";

export function useFileDownload(environmentId: EnvironmentId | null, threadId?: ThreadId) {
  const remoteOpen = useRemoteOpenState(environmentId);
  const { canReadFiles } = useFilesystemReadAccess(environmentId);
  const connection = usePreparedConnection(environmentId);
  const createUrl = useAtomQueryRunner(assetEnvironment.createUrl, {
    reportFailure: false,
    refresh: true,
  });
  const pending = useRef(false);
  const [saving, setSaving] = useState(false);
  const available =
    remoteOpen.mode !== "local-exec" &&
    threadId !== undefined &&
    canReadFiles &&
    connection._tag === "Some" &&
    environmentId !== null;
  const download = async (path: string) => {
    if (!available || pending.current) return;
    pending.current = true;
    setSaving(true);
    try {
      const result = await createUrl({
        environmentId,
        input: { resource: { _tag: "media-file", threadId, path, disposition: "attachment" } },
      });
      if (result._tag === "Failure") throw squashAtomCommandFailure(result);
      const url = resolveAssetUrl(connection.value.httpBaseUrl, result.value.relativeUrl);
      if (url === null) throw new Error("Reconnect to the environment and try again.");
      await saveFileUrl(url, path);
    } catch (error) {
      toastManager.add({
        type: "error",
        title: "Could not download file",
        description: error instanceof Error ? error.message : "Try again.",
      });
    } finally {
      pending.current = false;
      setSaving(false);
    }
  };
  return { available, saving, download };
}

export function FileDownloadAction(props: {
  environmentId: EnvironmentId | null;
  path: string;
  threadId: ThreadId;
}) {
  const { available, saving, download } = useFileDownload(props.environmentId, props.threadId);
  if (!available) return null;
  return (
    <FileSurfaceAction
      label={saving ? "Preparing file…" : "Save file"}
      disabled={saving}
      onPress={() => void download(props.path)}
    >
      <DownloadIcon className="size-3.5" />
    </FileSurfaceAction>
  );
}
