import { expect, it, vi } from "vite-plus/test";
import { DICTATION_CHUNK_BYTES, type ForkAudioBridge } from "@t3tools/contracts/fork/audio";
import { audioClient } from "./client";

vi.mock("./audio", () => ({
  recordingToWav: async () => new Uint8Array(48_003),
}));

async function withBridge(bridge: ForkAudioBridge, run: () => Promise<void>) {
  vi.stubGlobal("window", { forkAudio: bridge });
  try {
    await run();
  } finally {
    vi.unstubAllGlobals();
  }
}

it("uploads contiguous chunks and returns the transcript, releasing the upload", async () => {
  const execute = vi.fn<ForkAudioBridge["execute"]>(async (input) => {
    if (input.type === "start") return { kind: "upload", uploadId: "upload-1" };
    if (input.type === "finish") return { kind: "transcript", text: "Русский API" };
    return { kind: "ok" };
  });
  await withBridge({ execute, getSettings: vi.fn(), saveSettings: vi.fn() }, async () => {
    expect(await audioClient.transcribe(new Blob(), new AbortController().signal)).toBe(
      "Русский API",
    );
    const inputs = execute.mock.calls.map(([input]) => input);
    expect(inputs.map((input) => input.type)).toEqual([
      "start",
      "append",
      "append",
      "finish",
      "cancel",
    ]);
    expect(inputs[1]).toMatchObject({ offset: 0, data: btoa("\0".repeat(DICTATION_CHUNK_BYTES)) });
    expect(inputs[2]).toMatchObject({ offset: DICTATION_CHUNK_BYTES, data: btoa("\0\0\0") });
  });
});

it("cancels an upload acquired after the caller has already aborted", async () => {
  const controller = new AbortController();
  const execute = vi.fn<ForkAudioBridge["execute"]>(async (input) => {
    if (input.type === "start") {
      controller.abort();
      return { kind: "upload", uploadId: "upload-1" };
    }
    return { kind: "ok" };
  });
  await withBridge({ execute, getSettings: vi.fn(), saveSettings: vi.fn() }, async () => {
    await expect(audioClient.transcribe(new Blob(), controller.signal)).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(execute.mock.calls.map(([input]) => input.type)).toEqual(["start", "cancel"]);
  });
});
