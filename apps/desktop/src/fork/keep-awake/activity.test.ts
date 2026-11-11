import { expect, it } from "vite-plus/test";
import { RunId } from "@t3tools/contracts";
import { keepsMacAwake } from "@t3tools/contracts";

const idle = {
  status: "idle" as const,
  pendingRuntimeRequest: null,
  latestRunId: RunId.make("run-1"),
  usageLimitResetAt: "2026-11-12T03:00:00Z",
  settledOverride: null,
  lastErrorClass: null,
  archivedAt: null,
  limitRecovery: null,
};
it("keeps running tasks awake and releases completed tasks", () => {
  expect(keepsMacAwake({ ...idle, status: "running" })).toBe(true);
  expect(keepsMacAwake(idle)).toBe(false);
});
it("keeps only matching automatic limit recovery awake", () => {
  const failed = { ...idle, status: "failed" as const, lastErrorClass: "usage_limit" as const };
  const recovery = { runId: idle.latestRunId, resetAt: idle.usageLimitResetAt, autoResume: true };
  expect(keepsMacAwake({ ...failed, limitRecovery: recovery })).toBe(true);
  expect(keepsMacAwake({ ...failed, settledOverride: "settled", limitRecovery: recovery })).toBe(
    false,
  );
  expect(keepsMacAwake({ ...idle, limitRecovery: recovery })).toBe(false);
  expect(keepsMacAwake({ ...failed, limitRecovery: { ...recovery, autoResume: false } })).toBe(
    false,
  );
  expect(
    keepsMacAwake({ ...failed, limitRecovery: { ...recovery, runId: RunId.make("old") } }),
  ).toBe(false);
  expect(keepsMacAwake({ ...failed, limitRecovery: { ...recovery, resetAt: "old" } })).toBe(false);
});
