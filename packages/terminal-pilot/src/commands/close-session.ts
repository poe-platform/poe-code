import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  )
});

export const closeSession = defineCommand<
  TerminalPilotCommandServices,
  "close-session",
  typeof params,
  undefined,
  { exitCode: number },
  readonly ["cli", "mcp", "sdk"]
>({
  name: "close-session",
  description: "Close an active terminal session",
  scope: ["cli", "mcp", "sdk"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const { exitCode } = await getTerminalPilotRuntime(terminalPilotRuntime).closeSession(
      params.session,
      env
    );
    return { exitCode };
  }
});
