import type { CommandDefinition } from "../../contracts/index.js";
import { createOutputOperation } from "../../contracts/output.js";
import { Budget, FactorError, bytes, quote, settings, type FactorCommandsOptions } from "./internal.js";
import { Lifecycle, RecordWriter, TokenReader } from "./io.js";
import { factorRecord, parseNumber } from "./factor.js";

export function createFactorCommand(options: FactorCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "factor", description: "Print prime factors of bounded nonnegative integers", async execute(context) {
    const output = createOutputOperation(context, context.stdout);
    const budget = new Budget(context, limits, output.signal);
    let lifecycle: Lifecycle | undefined;
    let failure: { reason: unknown } | undefined;
    let primary: { reason: unknown } | undefined;
    let exitCode = 0;
    try {
      lifecycle = new Lifecycle(budget, output);
      const operands: string[] = [];
      let optionsEnded = false, debug = false;
      let information: "help" | "version" | undefined;
      for (const argument of budget.arguments()) {
        if (!optionsEnded && argument === "--") { optionsEnded = true; continue; }
        if (!optionsEnded && argument.startsWith("--")) {
          const equals = argument.indexOf("=");
          const option = equals < 0 ? argument.slice(2) : argument.slice(2, equals);
          const matches = ["-debug", "help", "version"].filter(name => name.startsWith(option));
          if (matches.length > 1) throw new FactorError(`option '${argument}' is ambiguous; possibilities: ${matches.map(name => `'--${name}'`).join(" ")}`, true);
          const matched = matches[0];
          if (!matched) throw new FactorError(`unrecognized option '${argument}'`, true);
          if (equals >= 0) throw new FactorError(`option '--${matched}' doesn't allow an argument`, true);
          if (matched === "-debug") debug = true;
          else { information = matched as "help" | "version"; break; }
        } else {
          if (!optionsEnded && argument.length > 1 && argument.startsWith("-")) throw new FactorError(`invalid option -- '${argument[1]}'`, true);
          operands.push(argument);
          if (context.env.POSIXLY_CORRECT !== undefined) optionsEnded = true;
        }
      }
      if (information) {
        const message = information === "version" ? "factor (virtual-bash)\n" : `Usage: factor [NUMBER]...\nPrint prime factors; with no numbers, read standard input.\nOptions: --help --version\nMaximum supported value: ${limits.maxValue}\n`;
        budget.outputRoom(message.length);
        await lifecycle.write(bytes(message));
      } else {
        const writer = new RecordWriter(lifecycle);
        const process = async (input: string): Promise<void> => {
          budget.number();
          budget.check(input.length, limits.maxTokenBytes, "token bytes");
          const value = await parseNumber(input, budget);
          if (typeof value === "string") {
            exitCode = 1;
            const suffix = value === "invalid" ? " is not a valid positive integer\n" : ` exceeds supported maximum ${limits.maxValue}\n`;
            await lifecycle!.diagnostic(`factor: ${quote(input, budget, 8 + suffix.length)}${suffix}`);
          } else {
            if (debug) await lifecycle!.diagnostic("[using single-precision arithmetic] ");
            await writer.append(await factorRecord(value, budget));
          }
        };
        if (operands.length) { for (const operand of operands) await process(operand); }
        else {
          const reader = new TokenReader(lifecycle);
          for (;;) {
            const token = await reader.next();
            if (token === undefined) break;
            try { await process(token); } finally { budget.retain(-token.length * 4); }
          }
        }
        await writer.finish();
      }
    } catch (error) {
      primary = { reason: error };
      if (error instanceof FactorError && !output.signal.aborted && lifecycle) {
        exitCode = 1;
        try { await lifecycle.diagnostic(`factor: ${error.message}\n${error.usage ? "Try 'factor --help' for more information.\n" : ""}`); }
        catch (reporting) { failure = { reason: new AggregateError([error, reporting], "factor failure reporting failed") }; }
      } else failure = { reason: error };
    }
    try { await output.close(); }
    catch (cleanup) {
      const previous = failure ?? primary;
      failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "factor execution and cleanup failed") : cleanup };
    }
    context.signal.throwIfAborted();
    output.signal.throwIfAborted();
    if (failure) throw failure.reason;
    return { exitCode };
  } };
}
