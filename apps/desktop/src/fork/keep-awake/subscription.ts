import { consumeTaskSubscription } from "./rpc.ts";
import {
  PRIMARY_LOCAL_ENVIRONMENT_ID,
  type OrchestrationV2ShellStreamItem,
} from "@t3tools/contracts";
import { resolveRemoteWebSocketConnectionUrl } from "@t3tools/client-runtime/authorization";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Schedule from "effect/Schedule";
import { RpcClient, RpcSerialization } from "effect/rpc";
import * as Socket from "effect/socket/Socket";
import * as DesktopBackendPool from "../../backend/DesktopBackendPool.ts";
import * as DesktopLocalEnvironmentAuth from "../../backend/DesktopLocalEnvironmentAuth.ts";

export const watchLocalTasks = Effect.fn("desktop.fork.keepAwake.watchLocalTasks")(function* (
  accept: (item: OrchestrationV2ShellStreamItem) => void,
  disconnected: () => void,
) {
  const pool = yield* DesktopBackendPool.DesktopBackendPool;
  const auth = yield* DesktopLocalEnvironmentAuth.DesktopLocalEnvironmentAuth;
  const connect = Effect.scoped(
    Effect.gen(function* () {
      const bearerToken = yield* auth.getBearerToken;
      const primary = (yield* pool.list).find(
        (instance) => instance.id === PRIMARY_LOCAL_ENVIRONMENT_ID,
      );
      const config = primary ? yield* primary.currentConfig : Option.none();
      if (Option.isNone(config)) return yield* Effect.fail("Local backend is unavailable");
      const httpBaseUrl = config.value.httpBaseUrl.toString();
      const wsBaseUrl = new URL(httpBaseUrl);
      wsBaseUrl.protocol = wsBaseUrl.protocol === "https:" ? "wss:" : "ws:";
      const socketUrl = yield* resolveRemoteWebSocketConnectionUrl({
        httpBaseUrl,
        wsBaseUrl: wsBaseUrl.toString(),
        bearerToken,
      });
      const protocol = Layer.effect(
        RpcClient.Protocol,
        RpcClient.makeProtocolSocket({
          retryTransientErrors: false,
          retryPolicy: Schedule.recurs(0),
          pingTimeout: Duration.seconds(30),
        }),
      ).pipe(
        Layer.provide(
          Layer.mergeAll(
            Socket.layerWebSocket(socketUrl).pipe(
              Layer.provide(Socket.layerWebSocketConstructorGlobal),
            ),
            RpcSerialization.layerJson,
          ),
        ),
      );
      yield* consumeTaskSubscription(protocol, accept);
      return yield* Effect.fail("Local task subscription ended");
    }),
  );
  return yield* connect.pipe(
    Effect.ensuring(Effect.sync(disconnected)),
    Effect.tapError((error) =>
      Effect.logWarning("Mac sleep task subscription reconnecting", error),
    ),
    Effect.retry(Schedule.spaced(Duration.seconds(2))),
  );
});
