import { defineCommand, S } from "@poe-code/cmdkit";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  key: S.String({ description: "Named key to press" }),
  session: S.Optional(S.String({ short: "s", description: "Session name" }))
});

export const pressKey = defineCommand<
  TerminalPilotCommandServices,
  "press-key",
  typeof params,
  undefined,
  undefined,
  readonly ["cli", "mcp", "sdk"]
>({
  name: "press-key",
  description: "Send a named key press to an active terminal session",
  scope: ["cli", "mcp", "sdk"],
  positional: ["key"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(params.session, env);
    await namedSession.session.press(params.key as never);
    return undefined;
  }
});
