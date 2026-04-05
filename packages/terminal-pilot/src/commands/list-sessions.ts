import { defineCommand, S } from "@poe-code/cmdkit";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({});

export const listSessions = defineCommand<
  TerminalPilotCommandServices,
  "list-sessions",
  typeof params,
  undefined,
  { sessions: Array<{ session: string; command: string; pid: number }> },
  readonly ["cli", "mcp", "sdk"]
>({
  name: "list-sessions",
  description: "List active terminal sessions",
  scope: ["cli", "mcp", "sdk"],
  params,
  handler: async ({ terminalPilotRuntime }) => {
    const sessions = await getTerminalPilotRuntime(terminalPilotRuntime).listSessions();
    return {
      sessions: sessions.map((namedSession) => ({
        session: namedSession.name,
        command: namedSession.session.command,
        pid: namedSession.session.pid
      }))
    };
  }
});
