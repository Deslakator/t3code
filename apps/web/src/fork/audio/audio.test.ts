import { expect, it } from "vite-plus/test";
import { encodeDictationWav } from "./audio";
it("encodes mono 16 kHz signed little endian PCM with accurate WAV lengths", () => {
  const bytes = encodeDictationWav(new Float32Array([-1, 0, 1]));
  const view = new DataView(bytes.buffer);
  expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe("RIFF");
  expect(view.getUint32(4, true)).toBe(bytes.length - 8);
  expect(view.getUint32(24, true)).toBe(16000);
  expect(view.getUint32(40, true)).toBe(6);
  expect([view.getInt16(44, true), view.getInt16(46, true), view.getInt16(48, true)]).toEqual([
    -32767, 0, 32767,
  ]);
});
