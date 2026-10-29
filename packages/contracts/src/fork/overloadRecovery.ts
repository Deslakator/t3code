import * as Schema from "effect/Schema";
import { MessageId, NonNegativeInt, RunId } from "../baseSchemas.ts";

export const forkThreadFields = {
  overloadRecovery: Schema.optional(
    Schema.NullOr(
      Schema.Struct({
        messageId: MessageId,
        attempt: NonNegativeInt,
      }),
    ),
  ),
};

export const forkMessageDispatchFields = {
  overloadContinuationOfRunId: Schema.optional(RunId),
};
