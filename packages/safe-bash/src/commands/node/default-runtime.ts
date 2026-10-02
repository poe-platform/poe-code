import { encodeBytes } from "../../byte-encoding.js";
import { writeBytes, type CommandDefinition } from "../../contracts/index.js";
import { createSafeJsNodeCommand, NODE_HELP_TEXT } from "./safejs.js";

const DEFAULT_NODE_VERSION = "v22.0.0";
let cachedCommand: CommandDefinition | undefined;

export const defaultNodeCommand: CommandDefinition = Object.freeze<CommandDefinition>({
  name: "node",
  description: "Execute JavaScript with SafeJS and virtual I/O",
  async execute(context) {
    context.signal.throwIfAborted();
    if (context.args.length === 1 && (context.args[0] === "-v" || context.args[0] === "--version")) {
      await writeBytes(context.stdout, encodeBytes(`${DEFAULT_NODE_VERSION}\n`), context.signal);
      return { exitCode: 0 };
    }
    if (context.args.length === 1 && (context.args[0] === "-h" || context.args[0] === "--help")) {
      await writeBytes(context.stdout, encodeBytes(NODE_HELP_TEXT), context.signal);
      return { exitCode: 0 };
    }
    if (cachedCommand === undefined) {
      let mod: typeof import("poe-code/safe-js/core");
      try {
        mod = await import("poe-code/safe-js/core");
      } catch {
        const fallback = "@poe-code/safe-js/core";
        mod = await import(fallback) as typeof import("poe-code/safe-js/core");
      }
      const { Budget, run, makeFsModule, declareHostOperation, parseSourceModule } = mod;
      cachedCommand = createSafeJsNodeCommand({ runtime: {
        run, makeFsModule, declareHostOperation, parseSourceModule,
        createBudget: options => new Budget(options),
        node: { version: DEFAULT_NODE_VERSION },
      } });
    }
    context.signal.throwIfAborted();
    return cachedCommand.execute(context);
  },
});
