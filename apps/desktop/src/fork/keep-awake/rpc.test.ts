import { expect, it } from "@effect/vitest";
import { ORCHESTRATION_V2_WS_METHODS } from "@t3tools/contracts";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as RpcClient from "effect/rpc/RpcClient";
import * as RpcSerialization from "effect/rpc/RpcSerialization";
import { consumeTaskSubscription } from "./rpc.ts";

it.effect("keeps transport alive while consuming task events and releases it on interruption", () =>
  Effect.gen(function* () {
    const received = yield* Deferred.make<void>();
    const lifecycle: string[] = [];
    let open = false;
    const protocol = Layer.effect(
      RpcClient.Protocol,
      Effect.gen(function* () {
        yield* Effect.acquireRelease(
          Effect.sync(() => {
            open = true;
            lifecycle.push("opened");
          }),
          () =>
            Effect.sync(() => {
              open = false;
              lifecycle.push("closed");
            }),
        );
        const serialization = yield* RpcSerialization.RpcSerialization;
        return yield* RpcClient.Protocol.make((writeResponse) =>
          Effect.succeed({
            supportsAck: false,
            supportsTransferables: false,
            codecFor: serialization.codecFor,
            send: (clientId, request) =>
              Effect.gen(function* () {
                if (request._tag !== "Request") return;
                expect(open).toBe(true);
                expect(request.tag).toBe(ORCHESTRATION_V2_WS_METHODS.subscribeShell);
                yield* writeResponse(clientId, {
                  _tag: "Chunk",
                  requestId: request.id,
                  values: [{ kind: "synchronized" }],
                });
              }),
          }),
        );
      }),
    ).pipe(Layer.provide(RpcSerialization.layerJson));
    yield* Effect.scoped(
      Effect.gen(function* () {
        const fiber = yield* consumeTaskSubscription(protocol, () => {
          expect(open).toBe(true);
          lifecycle.push("event");
          Deferred.doneUnsafe(received, Effect.void);
        }).pipe(Effect.forkScoped);
        yield* Deferred.await(received).pipe(Effect.raceFirst(Fiber.join(fiber)));
        expect(lifecycle).toEqual(["opened", "event"]);
        yield* Fiber.interrupt(fiber);
        expect(lifecycle).toEqual(["opened", "event", "closed"]);
      }),
    );
  }),
);
