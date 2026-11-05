import type { OrchestrationV2ProviderFailure } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type * as CodexClient from "effect-codex-app-server/client";
import {
  codexUsageLimitResetAt,
  type CodexRateLimitSnapshot,
} from "../../provider/codexUsageLimits.ts";

export const resolveCodexLimitReset = Effect.fn("resolveCodexLimitReset")(function* (
  snapshot: CodexRateLimitSnapshot | undefined,
  client: Pick<CodexClient.CodexAppServerClient["Service"], "request">,
) {
  const known = codexUsageLimitResetAt(snapshot);
  if (known !== null) return known;
  // A blocked turn may finish before Codex sends a fresh usage notification.
  return yield* client.request("account/rateLimits/read", null).pipe(
    Effect.map((response) =>
      response
        ? codexUsageLimitResetAt(response.rateLimitsByLimitId?.codex ?? response.rateLimits)
        : null,
    ),
    Effect.timeout("5 seconds"),
    Effect.catch(() => Effect.succeed(null)),
  );
});

export const completeCodexLimitFailure = Effect.fn("completeCodexLimitFailure")(function* (
  failure: OrchestrationV2ProviderFailure,
  client: Pick<CodexClient.CodexAppServerClient["Service"], "request">,
  publish: (failure: OrchestrationV2ProviderFailure) => Effect.Effect<void>,
) {
  if (failure.resetAt != null) return yield* publish(failure);
  // Return to the notification reader before awaiting its response; publish terminal last.
  yield* Effect.gen(function* () {
    const resetAt = yield* resolveCodexLimitReset(undefined, client);
    yield* publish({ ...failure, resetAt });
  }).pipe(Effect.forkScoped);
});
