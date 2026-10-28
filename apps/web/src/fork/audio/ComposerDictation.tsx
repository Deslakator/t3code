import { useLayoutEffect, useRef, type RefObject } from "react";
import { DesktopDictation, type DictationControls } from "./DesktopDictation";
import { flushSync } from "react-dom";
import type { DictationPhase } from "./session";

type Editor = {
  focus(): void;
  readSelectionRange(): { start: number; end: number };
  readSnapshot(): { contextIds: string[] };
  focusAt(cursor: number): void;
};

export function ComposerDictation(props: {
  ownerKey: string;
  ownerRef: RefObject<string>;
  prompt: string;
  promptRef: RefObject<string>;
  editorRef: RefObject<Editor | null>;
  disabled: boolean;
  controlsRef: RefObject<DictationControls | null>;
  onPhaseChange(phase: DictationPhase): void;
  onSubmit(): void;
  onPromptChange(
    text: string,
    cursor: number,
    expandedCursor: number,
    adjacent: boolean,
    contextIds: string[],
  ): void;
}) {
  const revision = useRef(0);
  const previousPrompt = useRef(props.prompt);
  // oxlint-disable-next-line t3code/react-effect-budget -- Invalidate in-flight transcription after any committed editor text change, including history and programmatic edits.
  useLayoutEffect(() => {
    if (previousPrompt.current !== props.prompt) {
      previousPrompt.current = props.prompt;
      revision.current += 1;
    }
  }, [props.prompt]);
  return (
    <DesktopDictation
      disabled={props.disabled}
      controlsRef={props.controlsRef}
      onPhaseChange={props.onPhaseChange}
      onSubmit={props.onSubmit}
      focusEditor={() => props.editorRef.current?.focus()}
      readDraft={() => {
        if (props.ownerRef.current !== props.ownerKey) return null;
        const text = props.promptRef.current;
        return {
          ownerKey: props.ownerKey,
          text,
          revision: revision.current,
          selection: props.editorRef.current?.readSelectionRange() ?? {
            start: text.length,
            end: text.length,
          },
        };
      }}
      commitDraft={(text, cursor) => {
        const editor = props.editorRef.current;
        flushSync(() => {
          props.onPromptChange(
            text,
            cursor,
            cursor,
            false,
            editor?.readSnapshot().contextIds ?? [],
          );
        });
        editor?.focusAt(cursor);
      }}
    />
  );
}
