import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  )
});

export const getSession = defineCommand<
  TerminalPilotCommandServices,
  "get-session",
  typeof params,
  undefined,
  { session: string; pid: number; command: string; exitCode: number | null },
  readonly ["cli", "mcp", "sdk"]
>({
  name: "get-session",
  description: "Get session metadata (name, pid, command, exitCode)",
  scope: ["cli", "mcp", "sdk"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    return {
      session: namedSession.name,
      pid: namedSession.session.pid,
      command: namedSession.session.command,
      exitCode: namedSession.session.exitCode
    };
  }
});
