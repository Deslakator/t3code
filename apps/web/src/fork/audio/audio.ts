import { DICTATION_MAX_BYTES, DICTATION_MAX_SECONDS } from "@t3tools/contracts/fork/audio";

export function encodeDictationWav(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  if (bytes.length > DICTATION_MAX_BYTES) throw new Error("Recording exceeds five minutes.");
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) bytes[offset + i] = value.charCodeAt(i);
  };
  text(0, "RIFF");
  view.setUint32(4, bytes.length - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true);
  view.setUint32(28, 32000, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++)
    view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, samples[i]!)) * 32767), true);
  return bytes;
}

export async function recordingToWav(recording: Blob): Promise<Uint8Array> {
  const context = new AudioContext();
  try {
    const audio = await context.decodeAudioData(await recording.arrayBuffer());
    if (!audio.length || audio.duration > DICTATION_MAX_SECONDS + 1)
      throw new Error("Invalid recording duration.");
    const frames = Math.min(Math.ceil(audio.duration * 16000), DICTATION_MAX_SECONDS * 16000);
    const offline = new OfflineAudioContext(1, frames, 16000);
    const source = offline.createBufferSource();
    source.buffer = audio;
    source.connect(offline.destination);
    source.start();
    return encodeDictationWav((await offline.startRendering()).getChannelData(0));
  } finally {
    await context.close();
  }
}
