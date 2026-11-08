import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  command: S.String({ description: "Command to execute", minLength: 1, pattern: "\\S" }),
  args: S.Optional(S.Array(S.String(), { description: "Command arguments" })),
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  ),
  cwd: S.Optional(S.String({ description: "Working directory" })),
  cols: S.Optional(
    S.Number({ description: "Terminal width in columns", jsonType: "integer", minimum: 1 })
  ),
  rows: S.Optional(
    S.Number({ description: "Terminal height in rows", jsonType: "integer", minimum: 1 })
  ),
  observe: S.Optional(S.Boolean({ description: "Mirror PTY output to stderr" }))
});

export const createSession = defineCommand<
  TerminalPilotCommandServices,
  "create-session",
  typeof params,
  undefined,
  { session: string; pid: number },
  readonly ["cli", "mcp", "sdk"]
>({
  name: "create-session",
  description: "Spawn an interactive CLI in a PTY",
  scope: ["cli", "mcp", "sdk"],
  positional: ["command", "args"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).createSession(
      params,
      env
    );
    return { session: namedSession.name, pid: namedSession.session.pid };
  }
});
