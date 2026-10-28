import { useEffect, useRef, useState } from "react";
import { Mic, Square, X } from "lucide-react";
import { DICTATION_MAX_SECONDS } from "@t3tools/contracts/fork/audio";
import { audioClient, AUDIO_SETTINGS_CHANGED } from "./client";
import { resolveTranscriptCommit, type VoiceDraftSnapshot } from "./transcript";
import { useStableCallback } from "~/hooks/useStableCallback";
import { Button } from "~/components/ui/button";

type Operation = {
  cancelled: boolean;
  stream?: MediaStream;
  recorder?: MediaRecorder;
  timer?: ReturnType<typeof setInterval>;
  controller: AbortController;
  chunks: Blob[];
  captured: VoiceDraftSnapshot;
};

export function DesktopDictation(props: {
  disabled: boolean;
  onBusyChange: (busy: boolean) => void;
  readDraft: () => VoiceDraftSnapshot | null;
  commitDraft: (text: string, cursor: number) => void;
}) {
  const [phase, setPhase] = useState<"idle" | "preparing" | "recording" | "transcribing">("idle");
  const changePhase = useStableCallback((next: typeof phase) => {
    setPhase(next);
    props.onBusyChange(next !== "idle");
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
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("pagehide", cancel);
    return () => {
      disposed = true;
      window.removeEventListener(AUDIO_SETTINGS_CHANGED, refresh);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("pagehide", cancel);
      cancel();
    };
  }, [cancel]);

  async function transcribe(op: Operation) {
    release(op);
    if (op.cancelled) return;
    changePhase("transcribing");
    await Promise.resolve()
      .then(() => {
        const recording = new Blob(op.chunks, { type: op.recorder?.mimeType ?? "" });
        op.chunks = [];
        return audioClient.transcribe(recording, op.controller.signal);
      })
      .then((text) => {
        if (op.cancelled) return;
        const insertion = resolveTranscriptCommit(op.captured, readDraft(), text, "ru");
        if (insertion.kind === "commit") commitDraft(insertion.text, insertion.selection.end);
        else {
          setRecovered(text);
          setError("The draft changed. Copy the recognized text below.");
        }
      })
      .catch((cause: unknown) => {
        if (!op.cancelled)
          setError(cause instanceof Error ? cause.message : "Could not transcribe this recording.");
      })
      .finally(() => {
        op.controller.abort();
        if (active.current === op) {
          active.current = null;
          changePhase("idle");
        }
      });
  }
  async function start() {
    if (active.current || props.disabled || !enabled) return;
    const captured = readDraft();
    if (!captured) return;
    const op: Operation = {
      cancelled: false,
      chunks: [],
      captured,
      controller: new AbortController(),
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
  return (
    <div className="flex flex-wrap items-center gap-2 py-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label={
          phase === "recording" ? "Stop dictation and transcribe" : "Start Russian dictation"
        }
        disabled={
          phase === "preparing" || phase === "transcribing" || (phase === "idle" && props.disabled)
        }
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (phase === "recording") active.current?.recorder?.stop();
          else void start();
        }}
      >
        {phase === "recording" ? <Square className="size-4" /> : <Mic className="size-4" />}
      </Button>
      {phase !== "idle" && (
        <>
          <span role="status" className="text-xs text-muted-foreground">
            {phase === "recording"
              ? `Recording ${seconds}s`
              : phase === "preparing"
                ? "Preparing microphone…"
                : "Transcribing…"}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Cancel dictation"
            onClick={cancel}
          >
            <X className="size-4" />
          </Button>
        </>
      )}
      {error && (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      )}
      {recovered && (
        <textarea
          aria-label="Recognized text from previous draft"
          readOnly
          value={recovered}
          className="w-full rounded border p-2 text-sm"
        />
      )}
    </div>
  );
}
