import { expect, it } from "vite-plus/test";
import { resolveTranscriptCommit, type VoiceDraftSnapshot } from "./transcript";

const captured: VoiceDraftSnapshot = {
  ownerKey: "thread-1",
  text: "Привет",
  revision: 1,
  selection: { start: 6, end: 6 },
};

it("inserts Russian dictation with English terms at a word boundary", () => {
  expect(resolveTranscriptCommit(captured, captured, " OpenRouter API ", "ru")).toEqual({
    kind: "commit",
    text: "Привет OpenRouter API",
    selection: { start: 21, end: 21 },
  });
});
it("preserves a changed draft or a different owner", () => {
  for (const current of [
    null,
    { ...captured, ownerKey: "thread-2" },
    { ...captured, text: "Изменено" },
    { ...captured, revision: 2 },
  ]) {
    expect(resolveTranscriptCommit(captured, current, "текст", "ru")).toEqual({ kind: "stale" });
  }
});
it("replaces a UTF-16 selection without damaging surrounding emoji", () => {
  const draft = { ...captured, text: "🧪 старое!", selection: { start: 3, end: 9 } };
  expect(resolveTranscriptCommit(draft, draft, "новое", "ru")).toEqual({
    kind: "commit",
    text: "🧪 новое!",
    selection: { start: 8, end: 8 },
  });
});
it("ignores empty recognition", () => {
  expect(resolveTranscriptCommit(captured, captured, "  ", "ru")).toEqual({ kind: "empty" });
});
