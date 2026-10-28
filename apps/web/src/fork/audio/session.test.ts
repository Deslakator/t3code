import { expect, it } from "vite-plus/test";
import { completeDictation, type TranscriptionOperation } from "./session";
import type { VoiceDraftSnapshot } from "./transcript";

function fixture(sendAfterTranscription = false) {
  const captured: VoiceDraftSnapshot = {
    ownerKey: "thread-1",
    text: "Используй",
    revision: 1,
    selection: { start: 9, end: 9 },
  };
  const operation: TranscriptionOperation = {
    captured,
    cancelled: false,
    controller: new AbortController(),
    sendAfterTranscription,
  };
  let current: VoiceDraftSnapshot | null = captured;
  const events: string[] = [];
  const handlers = {
    transcribe: async (_signal: AbortSignal) => "TypeScript",
    readDraft: () => current,
    commit: (text: string, cursor: number) => {
      current = { ...captured, text, selection: { start: cursor, end: cursor } };
      events.push("commit");
    },
    recover: (text: string) => {
      events.push(`recover:${text}`);
    },
    fail: (_cause: unknown) => {
      events.push("error");
    },
    complete: () => {
      expect(operation.controller.signal.aborted).toBe(true);
      events.push("idle");
    },
    submit: () => {
      events.push(`send:${current?.text}`);
    },
  };
  return {
    operation,
    handlers,
    events,
    changeDraft: (next: VoiceDraftSnapshot | null) => {
      current = next;
    },
  };
}

it("stops and inserts at the captured cursor without sending", async () => {
  const { operation, handlers, events } = fixture();
  await completeDictation(operation, handlers);
  expect(events).toEqual(["commit", "idle"]);
  expect(handlers.readDraft()).toMatchObject({ text: "Используй TypeScript" });
});
it("commits the transcript and releases the busy state before sending once", async () => {
  const { operation, handlers, events } = fixture(true);
  await completeDictation(operation, handlers);
  expect(events).toEqual(["commit", "idle", "send:Используй TypeScript"]);
});
it("accepts a send request while transcription is already in progress", async () => {
  const { operation, handlers, events } = fixture();
  let finish = (_text: string) => {};
  const result = new Promise<string>((resolve) => {
    finish = resolve;
  });
  handlers.transcribe = () => result;
  const completion = completeDictation(operation, handlers);
  operation.sendAfterTranscription = true;
  finish("TypeScript");
  await completion;
  expect(events).toEqual(["commit", "idle", "send:Используй TypeScript"]);
});
it("cancels an outstanding send intent without inserting or sending a late result", async () => {
  const { operation, handlers, events } = fixture(true);
  let finish = (_text: string) => {};
  handlers.transcribe = () =>
    new Promise<string>((resolve) => {
      finish = resolve;
    });
  const completion = completeDictation(operation, handlers);
  operation.cancelled = true;
  operation.controller.abort();
  finish("TypeScript");
  await completion;
  expect(events).toEqual(["idle"]);
});
it("recovers a result without sending after the draft is edited or its owner changes", async () => {
  for (const current of [
    null,
    { ...fixture().operation.captured, revision: 2 },
    { ...fixture().operation.captured, ownerKey: "thread-2" },
  ]) {
    const { operation, handlers, events, changeDraft } = fixture(true);
    changeDraft(current);
    await completeDictation(operation, handlers);
    expect(events).toEqual(["recover:TypeScript", "idle"]);
  }
});
it("releases the operation after a failed transcription without sending the existing draft", async () => {
  const { operation, handlers, events } = fixture(true);
  handlers.transcribe = async () => {
    throw new Error("Provider unavailable");
  };
  await completeDictation(operation, handlers);
  expect(events).toEqual(["error", "idle"]);
});
it("does not send on empty recognition or failed draft insertion", async () => {
  const empty = fixture(true);
  empty.handlers.transcribe = async () => " ";
  await completeDictation(empty.operation, empty.handlers);
  expect(empty.events).toEqual(["idle"]);
  const failed = fixture(true);
  failed.handlers.commit = () => {
    throw new Error("Editor unavailable");
  };
  await completeDictation(failed.operation, failed.handlers);
  expect(failed.events).toEqual(["error", "idle"]);
});
