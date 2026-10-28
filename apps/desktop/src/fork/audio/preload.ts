import { contextBridge, ipcRenderer } from "electron";
import type { ForkAudioBridge } from "@t3tools/contracts/fork/audio";
import * as Channels from "./channels.ts";

export function installForkAudioBridge() {
  contextBridge.exposeInMainWorld("forkAudio", {
    execute: (request) => ipcRenderer.invoke(Channels.DICTATION_CHANNEL, request),
    getSettings: () => ipcRenderer.invoke(Channels.AUDIO_SETTINGS_GET_CHANNEL),
    saveSettings: (settings) => ipcRenderer.invoke(Channels.AUDIO_SETTINGS_SAVE_CHANNEL, settings),
  } satisfies ForkAudioBridge);
}
