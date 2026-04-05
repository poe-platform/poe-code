import { defineCommand, S } from "@poe-code/cmdkit";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  session: S.Optional(S.String({ short: "s", description: "Session name" })),
  timeout: S.Optional(S.Number({ short: "t", description: "Maximum wait time in milliseconds" }))
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
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(params.session, env);
    const exitCode = await namedSession.session.waitForExit(
      params.timeout === undefined ? undefined : { timeout: params.timeout }
    );
    return { exitCode };
  }
});
