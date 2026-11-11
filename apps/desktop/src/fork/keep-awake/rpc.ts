import {
  ORCHESTRATION_V2_WS_METHODS,
  WsRpcGroup,
  type OrchestrationV2ShellStreamItem,
} from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as RpcClient from "effect/rpc/RpcClient";

export const consumeTaskSubscription = Effect.fn("desktop.fork.keepAwake.consumeTaskSubscription")(
  function* <E, R>(
    protocol: Layer.Layer<RpcClient.Protocol, E, R>,
    accept: (item: OrchestrationV2ShellStreamItem) => void,
  ) {
    const context = yield* Layer.build(protocol);
    const client = yield* RpcClient.make(WsRpcGroup).pipe(Effect.provide(context));
    yield* client[ORCHESTRATION_V2_WS_METHODS.subscribeShell]({
      omitIdleSubagents: true,
      omitOlderSettled: true,
    }).pipe(Stream.runForEach((item) => Effect.sync(() => accept(item))));
  },
  Effect.scoped,
);
