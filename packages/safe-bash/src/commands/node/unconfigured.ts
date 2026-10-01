import type { CommandDefinition } from "../../contracts/command.js";

export const unconfiguredNodeCommand: CommandDefinition = Object.freeze<CommandDefinition>({
  name: "node",
  description: "JavaScript execution requires an explicitly configured runtime",
  async execute(context) {
    context.signal.throwIfAborted();
    await context.stderr.write(new TextEncoder().encode("node: requires an injected runtime or provider\n"));
    return { exitCode: 2 };
  },
});
