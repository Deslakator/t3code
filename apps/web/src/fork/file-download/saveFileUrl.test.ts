import { expect, it, vi } from "vite-plus/test";
import { saveFileUrl } from "./saveFileUrl";

it("saves the response bytes under the basename and releases the blob URL", async () => {
  vi.useFakeTimers();
  const bytes = new Blob([new Uint8Array([0, 255, 42])]);
  const anchor = { href: "", download: "", click: vi.fn() };
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:download");
  const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  vi.stubGlobal("document", { createElement: () => anchor });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, blob: async () => bytes }));
  try {
    await saveFileUrl("https://remote.example/signed", "C:\\workspace\\artifact.zip");
    expect(create).toHaveBeenCalledWith(bytes);
    expect(anchor.download).toBe("artifact.zip");
    expect(anchor.href).toBe("blob:download");
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith("blob:download");
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  }
});

it("rejects unsuccessful responses without creating a download", async () => {
  const create = vi.spyOn(URL, "createObjectURL");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
  try {
    await expect(saveFileUrl("https://remote.example/expired", "/tmp/report.txt")).rejects.toThrow(
      "could not be loaded",
    );
    expect(create).not.toHaveBeenCalled();
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
