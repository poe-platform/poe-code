import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  ),
  last: S.Optional(
    S.Number({
      short: "n",
      description: "Return only the last N lines",
      jsonType: "integer",
      minimum: 0
    })
  )
});

export const readHistory = defineCommand<
  TerminalPilotCommandServices,
  "read-history",
  typeof params,
  undefined,
  { lines: string[]; exitCode: number | null },
  readonly ["cli", "mcp", "sdk"]
>({
  name: "read-history",
  description: "Read terminal output history",
  scope: ["cli", "mcp", "sdk"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    const lines = await namedSession.session.history({ last: params.last });
    return { lines, exitCode: namedSession.session.exitCode };
  }
});
