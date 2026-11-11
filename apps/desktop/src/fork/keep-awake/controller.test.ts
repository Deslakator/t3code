import { expect, it, vi } from "vite-plus/test";
import { createKeepAwakeController } from "./controller.ts";

it("holds one assertion and releases it when disabled", () => {
  const blocker = { start: vi.fn(() => 0), stop: vi.fn() };
  const update = createKeepAwakeController(blocker);
  update(false);
  update(true);
  update(true);
  expect(blocker.start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
  update(false);
  update(false);
  expect(blocker.stop).toHaveBeenCalledExactlyOnceWith(0);
  update(true);
  expect(blocker.start).toHaveBeenCalledTimes(2);
});
