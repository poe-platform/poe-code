import { UserError, defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  pattern: S.String({
    description: "Regular expression pattern to wait for",
    minLength: 1,
    pattern: "\\S"
  }),
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  ),
  timeout: S.Optional(
    S.Number({ short: "t", description: "Maximum wait time in milliseconds", minimum: 0 })
  ),
  literal: S.Optional(
    S.Boolean({
      short: "l",
      description: "When true, treat pattern as a literal string instead of a regex"
    })
  )
});

export const waitFor = defineCommand<
  TerminalPilotCommandServices,
  "wait-for",
  typeof params,
  undefined,
  { matched: true; line: string },
  readonly ["cli", "mcp", "sdk"]
>({
  name: "wait-for",
  description: "Wait for terminal output to match a pattern",
  scope: ["cli", "mcp", "sdk"],
  positional: ["pattern"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    if (params.pattern.trim().length === 0) {
      throw new UserError("Wait pattern must not be empty.");
    }
    assertTimeout(params.timeout);
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    const pattern = params.literal === true ? params.pattern : new RegExp(params.pattern);
    const line =
      params.timeout === undefined
        ? await namedSession.session.waitFor(pattern)
        : await namedSession.session.waitFor(pattern, { timeout: params.timeout });

    return { matched: true, line };
  }
});

function assertTimeout(timeout: number | undefined): void {
  if (timeout !== undefined && (!Number.isFinite(timeout) || timeout < 0)) {
    throw new UserError("Timeout must be a finite non-negative number.");
  }
}
