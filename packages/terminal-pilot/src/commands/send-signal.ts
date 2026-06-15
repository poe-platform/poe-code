import { defineCommand, S } from "toolcraft";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  signal: S.String({ description: "Signal to send to the session process" }),
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  )
});

export const sendSignal = defineCommand<
  TerminalPilotCommandServices,
  "send-signal",
  typeof params,
  undefined,
  undefined,
  readonly ["cli", "mcp", "sdk"]
>({
  name: "send-signal",
  description: "Send a process signal to an active terminal session",
  scope: ["cli", "mcp", "sdk"],
  positional: ["signal"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    await namedSession.session.signal(params.signal);
    return undefined;
  }
});
