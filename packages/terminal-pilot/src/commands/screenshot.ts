import { defineCommand, S } from "toolcraft";
import { renderTerminalPng } from "terminal-png";
import { getTerminalPilotRuntime, type TerminalPilotCommandServices } from "./runtime.js";

const params = S.Object({
  session: S.Optional(
    S.String({ short: "s", description: "Session name", minLength: 1, pattern: "\\S" })
  ),
  output: S.String({ short: "o", description: "Path to the output PNG file" }),
  window: S.Optional(S.Boolean({ description: "Include terminal window chrome", default: true })),
  padding: S.Optional(
    S.Number({
      short: "p",
      description: "Padding around terminal content",
      jsonType: "integer",
      minimum: 0
    })
  )
});

export const screenshot = defineCommand<
  TerminalPilotCommandServices,
  "screenshot",
  typeof params,
  undefined,
  undefined,
  readonly ["cli"]
>({
  name: "screenshot",
  description: "Capture the current terminal screen as a PNG image",
  scope: ["cli"],
  params,
  handler: async ({ params, env, terminalPilotRuntime }) => {
    const namedSession = await getTerminalPilotRuntime(terminalPilotRuntime).resolveSession(
      params.session,
      env
    );
    const screen = await namedSession.session.screen();

    await renderTerminalPng(screen.rawLines.join("\n"), {
      output: params.output,
      window: params.window,
      padding: params.padding
    });

    return undefined;
  }
});
