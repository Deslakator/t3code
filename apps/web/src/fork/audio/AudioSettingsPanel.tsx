import { audioClient, AUDIO_SETTINGS_CHANGED } from "./client";
import { useEffect, useState } from "react";
import type { DesktopAudioSettings } from "@t3tools/contracts/fork/audio";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";

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
    await Promise.resolve()
      .then(() =>
        bridge.saveSettings({
          enabled: removeKey ? false : enabled,
          model: model.trim(),
          ...(removeKey ? { apiKey: "" } : key.trim() ? { apiKey: key.trim() } : {}),
        }),
      )
      .then((value) => {
        setSettings(value);
        setEnabled(value.enabled);
        setModel(value.model);
        setKey("");
        setMessage(removeKey ? "Key removed; dictation disabled." : "Audio settings saved.");
        window.dispatchEvent(new Event(AUDIO_SETTINGS_CHANGED));
      })
      .catch(() => {
        setMessage("Could not save audio settings. Check macOS secure storage and file access.");
      })
      .finally(() => setBusy(false));
  }
  return (
    <SettingsSection id="audio" title="Audio">
      <SettingsRow
        title="Voice dictation"
        description="Dictate in Russian with English technical terms. Applies to this Mac across all environments."
        control={
          <Switch
            checked={enabled}
            onCheckedChange={setEnabled}
            disabled={!settings || busy}
            aria-label="Enable dictation"
          />
        }
      />
      <SettingsRow
        title="OpenRouter API key"
        description={
          settings?.hasApiKey
            ? "Key saved securely on this Mac. Leave blank to keep it."
            : "Your recordings are sent to OpenRouter and charged to your account."
        }
        control={
          <div className="w-full sm:w-72">
            <Input
              type="password"
              autoComplete="new-password"
              aria-label="OpenRouter API key"
              value={key}
              onChange={(event) => setKey(event.target.value)}
              disabled={!settings || busy}
              placeholder={settings?.hasApiKey ? "Key saved" : "Paste API key"}
            />
          </div>
        }
      />
      <SettingsRow
        title="Transcription model"
        description="Use an OpenRouter speech-to-text model. Changes apply without restarting."
        control={
          <div className="w-full sm:w-72">
            <Input
              aria-label="Transcription model"
              value={model}
              onChange={(event) => setModel(event.target.value)}
              disabled={!settings || busy}
              spellCheck={false}
            />
          </div>
        }
      />
      <SettingsRow
        title="Audio settings"
        description="The saved API key stays on this Mac."
        status={message ? <span role="status">{message}</span> : undefined}
        control={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={
                !settings ||
                busy ||
                !model.trim() ||
                (enabled && !settings.hasApiKey && !key.trim())
              }
              onClick={() => void save()}
            >
              Save
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
        }
      />
    </SettingsSection>
  );
}
