import {
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { Mic, Square } from "lucide-react";
import { DICTATION_MAX_SECONDS } from "@t3tools/contracts/fork/audio";
import { audioClient, AUDIO_SETTINGS_CHANGED } from "./client";
import type { VoiceDraftSnapshot } from "./transcript";
import { completeDictation, type DictationPhase, type TranscriptionOperation } from "./session";
import { useStableCallback } from "~/hooks/useStableCallback";
import { Button } from "~/components/ui/button";
import { Textarea } from "~/components/ui/textarea";
import { Tooltip, TooltipPopup, TooltipTrigger } from "~/components/ui/tooltip";

export interface DictationControls {
  submit(): boolean;
  keyDown(event: KeyboardEvent<HTMLElement>): void;
}

type Operation = TranscriptionOperation & {
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  chunks: Blob[];
};

export function DesktopDictation(props: {
  disabled: boolean;
  controlsRef: RefObject<DictationControls | null>;
  onPhaseChange: (phase: DictationPhase) => void;
  onSubmit: () => void;
  focusEditor: () => void;
  readDraft: () => VoiceDraftSnapshot | null;
  commitDraft: (text: string, cursor: number) => void;
}) {
  const [phase, setPhase] = useState<DictationPhase>("idle");
  const changePhase = useStableCallback((next: typeof phase) => {
    setPhase(next);
    props.onPhaseChange(next);
  });
  const [enabled, setEnabled] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [recovered, setRecovered] = useState("");
  const active = useRef<Operation | null>(null);
  const readDraft = useStableCallback(props.readDraft);
  const commitDraft = useStableCallback(props.commitDraft);
  const release = (op: Operation) => {
    clearInterval(op.timer);
    op.stream?.getTracks().forEach((track) => track.stop());
  };
  const cancel = useStableCallback(() => {
    const op = active.current;
    if (!op) return;
    op.cancelled = true;
    if (op.recorder?.state === "recording") op.recorder.stop();
    release(op);
    op.chunks = [];
    active.current = null;
    op.controller.abort();
    changePhase("idle");
  });
  // oxlint-disable-next-line t3code/react-effect-budget -- Read local dictation availability and release microphone/upload resources when the draft owner unmounts.
  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      void audioClient
        .status()
        .then((result) => {
          if (!disposed) {
            setEnabled(result.kind === "status" && result.enabled);
            if (result.kind === "status" && !result.enabled) cancel();
          }
        })
        .catch(() => {
          if (!disposed) setEnabled(false);
        });
    };
    refresh();
    window.addEventListener(AUDIO_SETTINGS_CHANGED, refresh);
    const onHidden = () => {
      if (document.hidden) cancel();
    };
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing || !active.current) return;
      event.preventDefault();
      event.stopPropagation();
      cancel();
    };
    document.addEventListener("keydown", onEscape, true);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", cancel);
    return () => {
      disposed = true;
      window.removeEventListener(AUDIO_SETTINGS_CHANGED, refresh);
      document.removeEventListener("keydown", onEscape, true);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", cancel);
      cancel();
    };
  }, [cancel]);

  const submit = useStableCallback(() => {
    const op = active.current;
    if (!op || op.cancelled) return false;
    op.sendAfterTranscription = true;
    if (op.recorder?.state === "recording") op.recorder.stop();
    return true;
  });
  useImperativeHandle(
    props.controlsRef,
    () => ({
      submit,
      keyDown(event) {
        if (!active.current || event.nativeEvent.isComposing) return;
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          cancel();
        } else if (
          event.key === "Enter" &&
          !event.shiftKey &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!event.repeat) submit();
        }
      },
    }),
    [submit, cancel],
  );
  const onSubmit = useStableCallback(props.onSubmit);
  async function transcribe(op: Operation) {
    release(op);
    if (op.cancelled) return;
    changePhase("transcribing");
    await completeDictation(op, {
      transcribe: (signal) => {
        const recording = new Blob(op.chunks, { type: op.recorder?.mimeType ?? "" });
        op.chunks = [];
        return audioClient.transcribe(recording, signal);
      },
      readDraft,
      commit: commitDraft,
      recover: (text) => {
        setRecovered(text);
        setError("The draft changed. Copy the recognized text below.");
      },
      fail: (cause) =>
        setError(cause instanceof Error ? cause.message : "Could not transcribe this recording."),
      complete: () => {
        if (active.current === op) {
          active.current = null;
          changePhase("idle");
        }
      },
      submit: onSubmit,
    });
  }
  async function start() {
    if (active.current || props.disabled || !enabled) return;
    const captured = readDraft();
    if (!captured) return;
    props.focusEditor();
    const op: Operation = {
      cancelled: false,
      chunks: [],
      captured,
      controller: new AbortController(),
      sendAfterTranscription: false,
    };
    active.current = op;
    setError(null);
    setRecovered("");
    changePhase("preparing");
    setSeconds(0);
    try {
      op.stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true },
      });
      if (op.cancelled) {
        release(op);
        return;
      }
      op.recorder = new MediaRecorder(op.stream);
      let size = 0;
      op.recorder.ondataavailable = (event) => {
        size += event.data.size;
        if (size > 16 * 1024 * 1024) {
          cancel();
          setError("Recording exceeds the size limit.");
          return;
        }
        if (!op.cancelled && event.data.size) op.chunks.push(event.data);
      };
      op.recorder.onstop = () => {
        void transcribe(op);
      };
      op.recorder.onerror = () => {
        cancel();
        setError("Microphone recording failed.");
      };
      op.recorder.start(1000);
      changePhase("recording");
      if (op.sendAfterTranscription) op.recorder.stop();
      let elapsed = 0;
      op.timer = setInterval(() => {
        elapsed += 1;
        setSeconds(elapsed);
        if (elapsed >= DICTATION_MAX_SECONDS && op.recorder?.state === "recording")
          op.recorder.stop();
      }, 1000);
    } catch {
      release(op);
      if (active.current === op) {
        active.current = null;
        changePhase("idle");
        setError(
          "Could not access the microphone. Allow T3 Code in macOS Privacy & Security → Microphone.",
        );
      }
    }
  }
  if (!enabled) return null;
  const label =
    phase === "recording" ? "Stop dictation and insert text" : "Start Russian dictation";
  return (
    <div className="relative flex shrink-0 items-center gap-2">
      {phase !== "idle" && (
        <span role="status" className="whitespace-nowrap text-xs text-muted-foreground">
          {phase === "recording"
            ? `Recording ${seconds}s`
            : phase === "preparing"
              ? "Preparing…"
              : "Transcribing…"}
        </span>
      )}
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={label}
              disabled={
                phase === "preparing" ||
                phase === "transcribing" ||
                (phase === "idle" && props.disabled)
              }
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (phase === "recording") active.current?.recorder?.stop();
                else void start();
              }}
            />
          }
        >
          {phase === "recording" ? <Square className="size-4" /> : <Mic className="size-4" />}
        </TooltipTrigger>
        <TooltipPopup side="top">
          {phase === "recording"
            ? "Stop to insert · Enter to send · Esc to cancel"
            : "Dictate in Russian"}
        </TooltipPopup>
      </Tooltip>
      {error && (
        <div className="absolute right-0 bottom-full z-10 mb-2 w-72 max-w-[80vw] space-y-2 rounded-lg border bg-popover p-3 text-popover-foreground shadow-md">
          <p role="alert" className="text-xs">
            {error}
          </p>
          {recovered && (
            <Textarea
              aria-label="Recognized text from previous draft"
              readOnly
              value={recovered}
              size="sm"
            />
          )}
        </div>
      )}
    </div>
  );
}
