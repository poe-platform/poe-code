import { encodeBytes } from "safe-bash-io-engine/byte-encoding";
import { writeBytes, type CommandDefinition } from "safe-bash-contracts";
import { createSafeJsNodeCommand, NODE_HELP_TEXT } from "./safejs.js";
import { createDefaultSafeJsRuntime, DEFAULT_NODE_VERSION } from "../../safejs-runtime.js";

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
    if (
      context.args.length === 7 &&
      context.args[0]!.endsWith("mark_artifact_operation_started.mjs") &&
      context.args[1] === "--operation-kind" &&
      (context.args[2] === "create" || context.args[2] === "edit") &&
      context.args[3] === "--expected-output-count" &&
      Number.isSafeInteger(Number(context.args[4])) &&
      Number(context.args[4]) >= 1 &&
      Number(context.args[4]) <= 100 &&
      context.args[5] === "--output-format" &&
      ["csv", "tsv", "xls", "xlsm", "xlsx", "docx", "ppt", "pptx", "pdf"].includes(context.args[6]!.toLowerCase())
    ) {
      return { exitCode: 0 };
    }
    if (cachedCommand === undefined) {
      cachedCommand = createSafeJsNodeCommand({ runtime: await createDefaultSafeJsRuntime() });
    }
    context.signal.throwIfAborted();
    return cachedCommand.execute(context);
  },
});
