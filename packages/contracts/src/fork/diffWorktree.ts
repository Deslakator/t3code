import * as Schema from "effect/Schema";
import { TrimmedNonEmptyString } from "../baseSchemas.ts";

export const reviewWorktreeFields = {
  worktreeProjectRoot: Schema.optionalKey(TrimmedNonEmptyString),
};
