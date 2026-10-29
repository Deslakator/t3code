import { ThreadId } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/sql/SqlClient";
import * as Scheduler from "../../scheduling/Scheduler.ts";
import * as ProjectionStore from "../../orchestration-v2/ProjectionStore.ts";
import * as ThreadManagement from "../../orchestration-v2/ThreadManagementService.ts";
import { OVERLOAD_RECOVERY_MAX_ATTEMPTS, overloadRecoveryCommand } from "./OverloadRecovery.ts";

const sweep = Effect.fn("OverloadRecoveryWorker.sweep")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const projections = yield* ProjectionStore.ProjectionStoreV2;
  const threads = yield* ThreadManagement.ThreadManagementService;

  const now = yield* DateTime.now;
  const candidates = yield* sql<{ thread_id: string }>`
      SELECT DISTINCT t.thread_id
      FROM orchestration_v2_projection_threads t
      JOIN orchestration_v2_projection_runs r ON r.thread_id = t.thread_id
      JOIN orchestration_v2_projection_turn_items item ON item.run_id = r.run_id
      WHERE t.deleted_at IS NULL AND r.status = 'failed'
        AND json_extract(t.payload_json, '$.archivedAt') IS NULL
        AND item.type = 'error' AND item.status = 'failed'
        AND item.node_id IS json_extract(r.payload_json, '$.rootNodeId')
        AND json_extract(item.payload_json, '$.failure.code') = 'serverOverloaded'
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_turn_items stopped
          WHERE stopped.run_id = r.run_id AND stopped.type = 'run_interrupt_request'
        )
        AND NOT EXISTS (
          SELECT 1 FROM orchestration_v2_projection_runs newer
          WHERE newer.thread_id = t.thread_id AND newer.ordinal > r.ordinal
        )
        AND NOT (
          json_extract(t.payload_json, '$.overloadRecovery.messageId') IS json_extract(r.payload_json, '$.userMessageId')
          AND json_extract(t.payload_json, '$.overloadRecovery.attempt') >= ${OVERLOAD_RECOVERY_MAX_ATTEMPTS}
        )
    `;
  for (const candidate of candidates) {
    yield* Effect.gen(function* () {
      const projection = yield* projections.getThreadRecords(
        ThreadId.make(candidate.thread_id),
        ["runs", "messages", "turnItems", "runtimeRequests"],
        { turnItemTypes: ["error", "run_interrupt_request"], messageRoles: ["user"] },
      );
      const command = overloadRecoveryCommand(projection, DateTime.toEpochMillis(now));
      if (command !== null) yield* threads.dispatch(command);
    }).pipe(
      Effect.catchCause((cause) =>
        Effect.logWarning("overload-recovery.dispatch-failed", {
          threadId: candidate.thread_id,
          cause,
        }),
      ),
    );
  }
});

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const scheduler = yield* Scheduler.Scheduler;
    yield* scheduler.register("overload-recovery", sweep());
  }),
);

export function withThreadManagement<E, R>(
  threads: Layer.Layer<ThreadManagement.ThreadManagementService, E, R>,
) {
  return layer.pipe(Layer.provide(Layer.merge(ProjectionStore.layer, threads)));
}
