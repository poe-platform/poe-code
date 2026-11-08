import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  cols: S.Number({ description: "Terminal width in columns", jsonType: "integer", minimum: 1 }),
  rows: S.Number({ description: "Terminal height in rows", jsonType: "integer", minimum: 1 }),
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  )
});

export const resize = defineCommand<
  TerminalPilotCommandServices,
  "resize",
  typeof params,
  undefined,
  undefined,
  readonly ["cli", "mcp", "sdk"]
>({
  name: "resize",
  description: "Resize an active terminal session",
  scope: ["cli", "mcp", "sdk"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    await namedSession.session.resize(params.cols, params.rows);
    return undefined;
  }
});
