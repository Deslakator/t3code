import { EnvironmentId } from "@t3tools/contracts";
import { expect, it, vi } from "vite-plus/test";
import { downloadFileContextMenu } from "./downloadFileContextMenu";

const environmentId = EnvironmentId.make("remote");
const target = {
  environmentId,
  filePath: "report.zip",
  workspaceRoot: "/repo",
  isDirectory: false,
};

function setup(available = true) {
  const base = {
    buildItems: vi.fn(() => [{ id: "open" as const, label: "Open" }]),
    activate: vi.fn(async () => {}),
  };
  const download = { available, download: vi.fn(async (_path: string) => {}) };
  const resolve = vi.fn((): string | null => "/repo/report.zip");
  return {
    base,
    download,
    resolve,
    menu: downloadFileContextMenu(base, download, environmentId, resolve),
  };
}

it("downloads the resolved file while preserving existing menu actions", async () => {
  const { menu, download, base } = setup();
  expect(menu.buildItems(target).map((item) => item.id)).toEqual(["download", "open"]);
  await menu.activate("download", target);
  expect(download.download).toHaveBeenCalledWith("/repo/report.zip");
  expect(base.activate).not.toHaveBeenCalled();
  await menu.activate("open", target);
  expect(base.activate).toHaveBeenCalledWith("open", target);
});

it("leaves local or unavailable downloads out of the menu and refuses activation", async () => {
  const { menu, download, resolve } = setup(false);
  expect(menu.buildItems(target).map((item) => item.id)).toEqual(["open"]);
  await menu.activate("download", target);
  expect(download.download).not.toHaveBeenCalled();
  expect(resolve).not.toHaveBeenCalled();
});

it("does not offer or activate downloads for directories, other environments, or unresolved paths", async () => {
  const { menu, download, resolve } = setup();
  for (const invalid of [
    { ...target, isDirectory: true },
    { ...target, environmentId: EnvironmentId.make("other") },
  ]) {
    expect(menu.buildItems(invalid).map((item) => item.id)).toEqual(["open"]);
    await menu.activate("download", invalid);
  }
  resolve.mockReturnValue(null);
  expect(menu.buildItems(target).map((item) => item.id)).toEqual(["open"]);
  await menu.activate("download", target);
  expect(download.download).not.toHaveBeenCalled();
});
