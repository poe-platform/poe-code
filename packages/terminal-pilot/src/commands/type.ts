import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  text: S.String({ description: "Text to write to the session" }),
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  )
});

export const type = defineCommand<
  TerminalPilotCommandServices,
  "type",
  typeof params,
  undefined,
  undefined,
  readonly ["cli", "mcp", "sdk"]
>({
  name: "type",
  description: "Write text to an active terminal session character-by-character with delay",
  scope: ["cli", "mcp", "sdk"],
  positional: ["text"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    await namedSession.session.type(params.text);
    return undefined;
  }
});
