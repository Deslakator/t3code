import { audioClient, AUDIO_SETTINGS_CHANGED } from "./client";
import { useEffect, useState } from "react";
import type { DesktopAudioSettings } from "@t3tools/contracts/fork/audio";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";

export function AudioSettingsPanel() {
  const bridge = audioClient.settings;
  const [settings, setSettings] = useState<DesktopAudioSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("openai/whisper-large-v3-turbo");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // oxlint-disable-next-line t3code/react-effect-budget -- Read device-local encrypted audio preferences through Electron IPC when the panel mounts.
  useEffect(() => {
    let disposed = false;
    void bridge
      ?.getSettings()
      .then((value) => {
        if (disposed) return;
        setSettings(value);
        setEnabled(value.enabled);
        setModel(value.model);
      })
      .catch(() => {
        if (!disposed) setMessage("Could not load audio settings.");
      });
    return () => {
      disposed = true;
    };
  }, [bridge]);
  if (window.desktopBridge?.getClientPlatform?.() !== "darwin" || !bridge) return null;
  async function save(removeKey = false) {
    if (!bridge) return;
    setBusy(true);
    setMessage("");
    try {
      const value = await bridge.saveSettings({
        enabled: removeKey ? false : enabled,
        model: model.trim(),
        ...(removeKey ? { apiKey: "" } : key.trim() ? { apiKey: key.trim() } : {}),
      });
      setSettings(value);
      setEnabled(value.enabled);
      setModel(value.model);
      setKey("");
      setMessage(removeKey ? "Key removed; dictation disabled." : "Audio settings saved.");
      window.dispatchEvent(new Event(AUDIO_SETTINGS_CHANGED));
    } catch {
      setMessage("Could not save audio settings. Check macOS secure storage and file access.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section id="audio" aria-labelledby="audio-title" className="space-y-4">
      <h2 id="audio-title" className="text-sm font-medium">
        Audio · OpenRouter dictation
      </h2>
      <p className="text-sm text-muted-foreground">
        These settings belong to this Mac and apply to every environment. Audio is sent directly to
        OpenRouter for Russian transcription, including English technical terms.
      </p>
      <label className="flex items-center gap-3">
        <Switch
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={!settings || busy}
          aria-label="Enable dictation"
        />
        Enable dictation
      </label>
      <label className="block space-y-2">
        <span>OpenRouter API key</span>
        <Input
          type="password"
          autoComplete="new-password"
          value={key}
          onChange={(event) => setKey(event.target.value)}
          disabled={!settings || busy}
          placeholder={
            settings?.hasApiKey
              ? "Key saved. Leave blank to keep it"
              : "Paste your OpenRouter API key"
          }
        />
      </label>
      <label className="block space-y-2">
        <span>Transcription model</span>
        <Input
          value={model}
          onChange={(event) => setModel(event.target.value)}
          disabled={!settings || busy}
          spellCheck={false}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Use a speech-to-text model such as openai/whisper-large-v3-turbo. The saved key is encrypted
        on this Mac and is never returned to this screen. No application restart is needed.
      </p>
      <div className="flex gap-2">
        <Button
          type="button"
          size="sm"
          disabled={
            !settings || busy || !model.trim() || (enabled && !settings.hasApiKey && !key.trim())
          }
          onClick={() => void save()}
        >
          Save audio settings
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!settings?.hasApiKey || busy}
          onClick={() => void save(true)}
        >
          Remove key
        </Button>
      </div>
      {message && (
        <p role="status" className="text-sm">
          {message}
        </p>
      )}
    </section>
  );
}
