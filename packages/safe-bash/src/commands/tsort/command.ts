import type { CommandDefinition } from "../../contracts/index.js";
import { createOutputOperation } from "../../contracts/output.js";
import { Budget, TsortError, quote, settings, type TsortCommandsOptions } from "./internal.js";
import { Lifecycle, Reader } from "./io.js";
import { sort } from "./graph.js";

export function createTsortCommand(options: TsortCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "tsort", description: "Topologically sort pairs of byte-valued node names", async execute(context) {
    const output = createOutputOperation(context, context.stdout);
    const budget = new Budget(context, limits, output.signal);
    let lifecycle: Lifecycle | undefined;
    let failure: { reason: unknown } | undefined;
    let primary: { reason: unknown } | undefined;
    let exitCode = 0;
    try {
      lifecycle = new Lifecycle(budget, output);
      const args = budget.arguments();
      const lone = args.length === 1 ? args[0]! : "";
      if (lone.length > 2 && ("--help".startsWith(lone) || "--version".startsWith(lone))) {
        await lifecycle.write("--help".startsWith(lone) ? "Usage: tsort [OPTION] [FILE]\nWrite a topological ordering of whitespace-separated node pairs.\nWith no FILE, or FILE -, read standard input.\nOptions: --help --version\n" : "tsort (virtual-bash)\n");
      } else {
        let optionsEnded = false;
        const files: string[] = [];
        for (const argument of args) {
          if (!optionsEnded && argument === "--") { optionsEnded = true; continue; }
          if (!optionsEnded && argument.startsWith("--")) throw new TsortError(`unrecognized option '${argument}'`, true);
          if (!optionsEnded && argument.length > 1 && argument.startsWith("-")) throw new TsortError(`invalid option -- '${argument[1]}'`, true);
          files.push(argument);
          if (context.env.POSIXLY_CORRECT !== undefined) optionsEnded = true;
        }
        if (files.length > 1) throw new TsortError(`extra operand ${quote(files[1]!)}`, true);
        const reader = new Reader(files[0] ?? "-", lifecycle);
        await reader.open();
        exitCode = await sort(reader, lifecycle);
      }
    } catch (error) {
      primary = { reason: error };
      if (error instanceof TsortError && !output.signal.aborted && lifecycle) {
        exitCode = 1;
        try { await lifecycle.write(`tsort: ${error.message}\n${error.usage ? "Try 'tsort --help' for more information.\n" : ""}`, true); }
        catch (reporting) { failure = { reason: new AggregateError([error, reporting], "tsort failure reporting failed") }; }
      } else failure = { reason: error };
    }
    try { await output.close(); }
    catch (cleanup) {
      const previous = failure ?? primary;
      failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "tsort execution and cleanup failed") : cleanup };
    }
    context.signal.throwIfAborted();
    output.signal.throwIfAborted();
    if (failure) throw failure.reason;
    return { exitCode };
  } };
}
