import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import { makeProviderFailure } from "@t3tools/provider-core/server/failure";
import * as Effect from "effect/Effect";
import { expect, vi } from "vite-plus/test";
import { resolveCodexLimitReset, completeCodexLimitFailure } from "./resolveReset.ts";

it.effect("reads fresh usage when the blocked turn has a stale notification", () =>
  Effect.gen(function* () {
    const request = vi.fn().mockReturnValue(
      Effect.succeed({
        rateLimits: { primary: { usedPercent: 99 } },
        rateLimitsByLimitId: {
          codex: { primary: { usedPercent: 100, resetsAt: 2_000_000_000 } },
        },
      }),
    );
    expect(yield* resolveCodexLimitReset({ primary: { usedPercent: 99 } }, { request })).toBe(
      "2033-05-18T03:33:20.000Z",
    );
    expect(request).toHaveBeenCalledWith("account/rateLimits/read", null);
  }),
);

it.effect("preserves a known reset without a request", () =>
  Effect.gen(function* () {
    const request = vi.fn();
    expect(
      yield* resolveCodexLimitReset(
        { primary: { usedPercent: 100, resetsAt: 2_000_000_000 } },
        { request },
      ),
    ).toBe("2033-05-18T03:33:20.000Z");
    expect(request).not.toHaveBeenCalled();
  }),
);

it.effect("keeps the usage failure when the usage read fails", () =>
  Effect.gen(function* () {
    const request = vi.fn().mockReturnValue(Effect.fail(new Error("offline")));
    expect(yield* resolveCodexLimitReset(undefined, { request })).toBeNull();
  }),
);

it.effect("returns from the notification before waiting for its response", () =>
  Effect.gen(function* () {
    yield* Effect.scoped(
      Effect.gen(function* () {
        const response = yield* Deferred.make<{
          rateLimits: { primary: { usedPercent: number; resetsAt: number } };
        }>();
        const published = yield* Deferred.make<string | null | undefined>();
        const request = vi.fn().mockReturnValue(Deferred.await(response));
        const failure = makeProviderFailure({
          class: "usage_limit",
          message: "Usage limit reached",
        });
        yield* completeCodexLimitFailure(failure, { request }, (updated) =>
          Deferred.succeed(published, updated.resetAt).pipe(Effect.asVoid),
        );
        expect(yield* Deferred.isDone(published)).toBe(false);
        yield* Deferred.succeed(response, {
          rateLimits: { primary: { usedPercent: 100, resetsAt: 2_000_000_000 } },
        });
        expect(yield* Deferred.await(published)).toBe("2033-05-18T03:33:20.000Z");
      }),
    );
  }),
);
