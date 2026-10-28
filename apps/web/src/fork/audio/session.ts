import { resolveTranscriptCommit, type VoiceDraftSnapshot } from "./transcript";

export type DictationPhase = "idle" | "preparing" | "recording" | "transcribing";

export type TranscriptionOperation = {
  cancelled: boolean;
  controller: AbortController;
  captured: VoiceDraftSnapshot;
  sendAfterTranscription: boolean;
};

export async function completeDictation(
  operation: TranscriptionOperation,
  handlers: {
    transcribe(signal: AbortSignal): Promise<string>;
    readDraft(): VoiceDraftSnapshot | null;
    commit(text: string, cursor: number): void;
    recover(text: string): void;
    fail(cause: unknown): void;
    complete(): void;
    submit(): void;
  },
) {
  let send = false;
  try {
    const text = await handlers.transcribe(operation.controller.signal);
    if (operation.cancelled) return;
    const insertion = resolveTranscriptCommit(operation.captured, handlers.readDraft(), text, "ru");
    if (insertion.kind === "commit") {
      handlers.commit(insertion.text, insertion.selection.end);
      send = operation.sendAfterTranscription;
    } else if (insertion.kind === "stale") {
      handlers.recover(text);
    }
  } catch (cause) {
    if (!operation.cancelled) handlers.fail(cause);
  } finally {
    operation.controller.abort();
    handlers.complete();
  }
  if (send && !operation.cancelled) handlers.submit();
}
