import { UserError, defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  ),
  timeout: S.Optional(
    S.Number({ short: "t", description: "Maximum wait time in milliseconds", minimum: 0 })
  )
});

export const waitForExit = defineCommand<
  TerminalPilotCommandServices,
  "wait-for-exit",
  typeof params,
  undefined,
  { exitCode: number },
  readonly ["cli", "mcp", "sdk"]
>({
  name: "wait-for-exit",
  description: "Wait for a terminal session process to finish",
  scope: ["cli", "mcp", "sdk"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    if (params.timeout !== undefined && (!Number.isFinite(params.timeout) || params.timeout < 0)) {
      throw new UserError("Timeout must be a finite non-negative number.");
    }
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    const exitCode = await namedSession.session.waitForExit(
      params.timeout === undefined ? undefined : { timeout: params.timeout }
    );
    return { exitCode };
  }
});
