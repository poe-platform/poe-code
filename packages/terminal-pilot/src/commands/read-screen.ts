import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  )
});

type ReadScreenResult = {
  lines: string[];
  cursor: { row: number; col: number };
  size: { rows: number; cols: number };
  exitCode: number | null;
};

export const readScreen = defineCommand<
  TerminalPilotCommandServices,
  "read-screen",
  typeof params,
  undefined,
  ReadScreenResult,
  readonly ["cli", "mcp", "sdk"]
>({
  name: "read-screen",
  description: "Read the current visible terminal screen",
  scope: ["cli", "mcp", "sdk"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    const screen = await namedSession.session.screen();
    return {
      lines: [...screen.lines],
      cursor: { ...screen.cursor },
      size: { ...screen.size },
      exitCode: namedSession.session.exitCode
    };
  }
});
