import { audioClient, AUDIO_SETTINGS_CHANGED } from "./client";
import { useEffect, useState } from "react";
import type { DesktopAudioSettings, DictationProvider } from "@t3tools/contracts/fork/audio";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { Switch } from "~/components/ui/switch";
import { SettingsRow, SettingsSection } from "~/components/settings/settingsLayout";
import {
  Select,
  SelectItem,
  SelectPopup,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";

export function AudioSettingsPanel() {
  const bridge = audioClient.settings;
  const [settings, setSettings] = useState<DesktopAudioSettings | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [model, setModel] = useState("openai/whisper-large-v3-turbo");
  const [provider, setProvider] = useState<DictationProvider>("openrouter");
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  // oxlint-disable-next-line t3code/no-unreasoned-state-sync -- Read device-local encrypted audio preferences through Electron IPC when the panel mounts.
  useEffect(() => {
    let disposed = false;
    void bridge
      ?.getSettings()
      .then((value) => {
        if (disposed) return;
        setSettings(value);
        setEnabled(value.enabled);
        setModel(value.model);
        setProvider(value.provider ?? "openrouter");
      })
      .catch(() => {
        if (!disposed) setMessage("Could not load audio settings.");
      });
    return () => {
      disposed = true;
    };
  }, [bridge]);
  if (window.desktopBridge?.getClientPlatform?.() !== "darwin" || !bridge) return null;
  const providerLabel = provider === "assemblyai" ? "AssemblyAI" : "OpenRouter";
  const hasApiKey =
    provider === "assemblyai"
      ? settings?.hasAssemblyAiApiKey
      : (settings?.hasOpenRouterApiKey ??
        (settings?.provider !== "assemblyai" && settings?.hasApiKey));
  async function save(removeKey = false) {
    if (!bridge || !settings) return;
    setBusy(true);
    setMessage("");
    await Promise.resolve()
      .then(() =>
        bridge.saveSettings({
          enabled: removeKey ? false : enabled,
          model: provider === "openrouter" ? model.trim() : settings.model,
          provider,
          ...(removeKey ? { apiKey: "" } : key.trim() ? { apiKey: key.trim() } : {}),
        }),
      )
      .then((value) => {
        setSettings(value);
        setEnabled(value.enabled);
        setModel(value.model);
        setProvider(value.provider ?? "openrouter");
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
        title="Transcription service"
        description="Choose the service that receives recordings from this Mac. Keys are saved separately."
        control={
          <div className="w-full sm:w-72">
            <Select
              value={provider}
              disabled={!settings || busy}
              onValueChange={(value) => {
                if (value !== "openrouter" && value !== "assemblyai") return;
                setProvider(value);
                setKey("");
                setMessage("");
              }}
            >
              <SelectTrigger aria-label="Transcription service">
                <SelectValue>{providerLabel}</SelectValue>
              </SelectTrigger>
              <SelectPopup>
                <SelectItem value="openrouter">OpenRouter</SelectItem>
                <SelectItem
                  value="assemblyai"
                  disabled={settings?.hasAssemblyAiApiKey === undefined}
                >
                  AssemblyAI
                </SelectItem>
              </SelectPopup>
            </Select>
          </div>
        }
      />
      <SettingsRow
        title={`${providerLabel} API key`}
        description={
          hasApiKey
            ? "Key saved securely on this Mac. Leave blank to keep it."
            : `Your recordings are sent to ${providerLabel} and charged to your account.`
        }
        control={
          <div className="w-full sm:w-72">
            <Input
              type="password"
              autoComplete="new-password"
              aria-label={`${providerLabel} API key`}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              disabled={!settings || busy}
              placeholder={hasApiKey ? "Key saved" : "Paste API key"}
            />
          </div>
        }
      />
      {provider === "openrouter" ? (
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
      ) : (
        <SettingsRow
          title="Transcription model"
          description="Universal-2 · Russian. Recordings are uploaded to AssemblyAI for transcription."
        />
      )}
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
                (provider === "openrouter" && !model.trim()) ||
                (enabled && !hasApiKey && !key.trim())
              }
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!hasApiKey || busy}
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
