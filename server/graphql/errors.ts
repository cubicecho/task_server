import { GraphQLError } from "graphql";

/** Every code a refusal from this schema carries in `extensions.code`. */
export type RefusalCode =
  | "BAD_CRON"
  | "BAD_EVENT"
  | "BAD_HOOKS"
  | "BAD_MCP_SERVER"
  | "BAD_STEPS"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "RUN_IN_FLIGHT";

/**
 * Something the caller got wrong and can fix, with a code to branch on.
 *
 * A `GraphQLError` because a plain `Error` reaches the client as "Internal server error", and
 * built here because `extensions` is an untyped bag: written at each throw, a misspelt code
 * compiles and is only ever found by the client that was matching on the right one.
 */
export const refusal = (code: RefusalCode, message: string, extra?: Record<string, unknown>) =>
  new GraphQLError(message, { extensions: { code, ...extra } });
