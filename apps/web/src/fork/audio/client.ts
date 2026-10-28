import { DICTATION_CHUNK_BYTES, type DictationRequest } from "@t3tools/contracts/fork/audio";
import { recordingToWav } from "./audio";

export const AUDIO_SETTINGS_CHANGED = "fork:audio:settings-changed";

async function request(input: DictationRequest) {
  const bridge = window.forkAudio;
  if (!bridge) throw new Error("Desktop dictation is unavailable. Update the Mac app.");
  const result = await bridge.execute(input);
  if (result.kind === "error") throw new Error(result.message);
  return result;
}

export const audioClient = {
  get settings() {
    return window.forkAudio;
  },
  status: () => request({ type: "status" }),
  async transcribe(recording: Blob, signal: AbortSignal): Promise<string> {
    const audio = await recordingToWav(recording);
    signal.throwIfAborted();
    const start = await request({ type: "start" });
    if (start.kind !== "upload") throw new Error("Could not start dictation upload.");
    const cancel = () => {
      void request({ type: "cancel", uploadId: start.uploadId }).catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      signal.throwIfAborted();
      for (let offset = 0; offset < audio.length; offset += DICTATION_CHUNK_BYTES) {
        signal.throwIfAborted();
        const chunk = audio.subarray(offset, offset + DICTATION_CHUNK_BYTES);
        await request({
          type: "append",
          uploadId: start.uploadId,
          offset,
          data: btoa(String.fromCharCode(...chunk)),
        });
      }
      signal.throwIfAborted();
      const result = await request({ type: "finish", uploadId: start.uploadId });
      signal.throwIfAborted();
      if (result.kind !== "transcript") throw new Error("No speech was recognized.");
      return result.text;
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
    }
  },
};
