import type { CommandDefinition } from "../../contracts/command.js";
import { createSafeJsNodeCommand } from "./safejs.js";

export const defaultNodeCommand: CommandDefinition = Object.freeze<CommandDefinition>({
  name: "node",
  description: "Execute JavaScript with SafeJS and virtual I/O",
  async execute(context) {
    context.signal.throwIfAborted();
    let mod: typeof import("poe-code/safe-js/core");
    try {
      mod = await import("poe-code/safe-js/core");
    } catch {
      const fallback = "@poe-code/safe-js/core";
      mod = await import(fallback) as typeof import("poe-code/safe-js/core");
    }
    const { Budget, run, makeFsModule, declareHostOperation, parseSourceModule } = mod;
    context.signal.throwIfAborted();
    return createSafeJsNodeCommand({ runtime: {
      run, makeFsModule, declareHostOperation, parseSourceModule,
      createBudget: options => new Budget(options),
      node: { version: "v22.0.0" },
    } }).execute(context);
  },
});
