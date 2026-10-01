import type { CommandDefinition } from "../../contracts/command.js";
import { createSafeJsNodeCommand } from "./safejs.js";

export const defaultNodeCommand: CommandDefinition = Object.freeze<CommandDefinition>({
  name: "node",
  description: "Execute JavaScript with SafeJS and virtual I/O",
  async execute(context) {
    context.signal.throwIfAborted();
    const { Budget, run, makeFsModule, declareHostOperation, parseSourceModule } = await import("poe-code/safe-js/core");
    context.signal.throwIfAborted();
    return createSafeJsNodeCommand({ runtime: {
      run, makeFsModule, declareHostOperation, parseSourceModule,
      createBudget: options => new Budget(options),
    } }).execute(context);
  },
});
