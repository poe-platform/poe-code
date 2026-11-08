import { UserError, defineCommand, S } from "toolcraft";
import { TERMINAL_KEY_PATTERN, keyToSequence, type TerminalKey } from "../keys.js";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  key: S.String({ description: "Named key to press", pattern: TERMINAL_KEY_PATTERN }),
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  )
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
    assertTerminalKey(params.key);
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    await namedSession.session.press(params.key as TerminalKey);
    return undefined;
  }
});

function assertTerminalKey(key: string): asserts key is TerminalKey {
  try {
    keyToSequence(key as TerminalKey);
  } catch (error) {
    throw new UserError(error instanceof Error ? error.message : String(error));
  }
}
