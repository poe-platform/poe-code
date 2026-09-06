import type { CommandContext, CommandDefinition, CommandResult } from "../../contracts/command.js";
import { escapeText } from "../../escaping.js";
import { FsError } from "../../contracts/errors.js";
import { createOutputOperation } from "../../contracts/output.js";
import type { VirtualShellPlugin } from "../../contracts/plugin.js";
import { DeserializationError, UsageError, inferDelimiter, parseArguments } from "./argv.js";
import { Budget, LimitError, XanError } from "./budget.js";
import { prepareRows } from "./commands.js";
import { EscapingFailure, InputScope, managedOutput, outputOperation, preflight, publish } from "./io.js";
import { validateOptions, type XanCommandsOptions, type XanLimits } from "./options.js";
import { parseSelection } from "./selector.js";
import { Writer } from "./writer.js";

export type { XanCommandsOptions, XanLimits } from "./options.js";
export { defaultLimits, hardLimits } from "./options.js";

async function execute(context: CommandContext, limits: XanLimits): Promise<CommandResult> {
  let command = context.args[0] === "h" ? "headers" : context.args[0] ?? "";
  let operation: ReturnType<typeof outputOperation> | undefined;
  let scope: InputScope | undefined;
  let source: Awaited<ReturnType<typeof prepareRows>> | undefined;
  let failed = false;
  let failure: unknown;
  let result: CommandResult = { exitCode: 0 };
  const budget = new Budget(limits, context.signal);
  try {
    const args = await parseArguments(context.args, context.cwd, budget);
    command = args.command;
    const selection = args.command === "select" && !args.help ? await parseSelection(args.selection, budget) : undefined;
    operation = outputOperation(context, args.output !== undefined && !args.help);
    budget.signal = operation.signal;
    scope = new InputScope(context, budget);
    const destination = args.help ? undefined : await preflight(context, args, budget);
    const writer = new Writer(inferDelimiter(args.output ?? "-"), budget);
    source = managedOutput(await prepareRows(args, selection, scope, budget, writer), scope, budget);
    await publish(context, destination, source, operation, budget);
  } catch (error) {
    if (context.signal.aborted) { failed = true; failure = context.signal.reason; }
    else if (error instanceof EscapingFailure) { failed = true; failure = error.reason; }
    else if (!(error instanceof XanError) && !(error instanceof FsError)) { failed = true; failure = error; }
    else if (operation?.signal.aborted) { failed = true; failure = operation.signal.reason; }
    else {
      result = { exitCode: 1 };
      const parts = error instanceof DeserializationError || error instanceof UsageError ? [error.message, "\n"] : ["xan", command ? " " : "", command, ": ", error.message, "\n"];
      const stderr = createOutputOperation(context, context.stderr);
      let bytes: Uint8Array | undefined;
      try {
        let size = 0;
        for (const part of parts) {
          for (const character of part) {
            const fragment = escapeText(character, "diagnostic");
            const incoming = Buffer.byteLength(fragment);
            budget.work(incoming);
            size += incoming;
            budget.bound("maxOutputBytes", size + (budget.totals.get("maxOutputBytes") ?? 0));
            await budget.checkpoint();
          }
        }
        if (size <= limits.maxOutputBytes - (budget.totals.get("maxOutputBytes") ?? 0)) {
          budget.add("maxOutputBytes", size); budget.hold(size); bytes = new Uint8Array(size);
          let offset = 0;
          for (const part of parts) {
            for (const character of part) {
              const encoded = await budget.encode(escapeText(character, "diagnostic"));
              try {
                budget.work(encoded.length); bytes.set(encoded, offset); offset += encoded.length; await budget.checkpoint();
              } finally { budget.release(encoded.length); }
            }
          }
          try { await stderr.output.write(bytes); }
          catch (sinkError) { throw new EscapingFailure(sinkError); }
        }
      } catch (diagnosticError) {
        if (diagnosticError instanceof EscapingFailure) { failed = true; failure = diagnosticError.reason; }
        else if (!(diagnosticError instanceof LimitError)) { failed = true; failure = diagnosticError; }
      } finally {
        if (bytes) budget.release(bytes.length);
        try { await stderr.close(); } catch (cleanupError) { if (!failed) { failed = true; failure = cleanupError; } }
      }
    }
  }
  const cleanups = await Promise.allSettled([scope?.close(), operation?.close()]);
  if (context.signal.aborted) throw context.signal.reason;
  if (failed) throw failure;
  const errors = cleanups.filter((outcome): outcome is PromiseRejectedResult => outcome.status === "rejected").map(outcome => outcome.reason);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, "xan cleanup failed");
  return result;
}
export function createXanCommand(options?: XanCommandsOptions): CommandDefinition {
  const { limits } = validateOptions(options);
  return { name: "xan", description: "Bounded byte-stream CSV headers, count, select and slice", execute: context => execute(context, limits) };
}
export function createXanCommands(options?: XanCommandsOptions): readonly CommandDefinition[] { return [createXanCommand(options)]; }
export function xanCommands(options?: XanCommandsOptions): VirtualShellPlugin {
  const { replace } = validateOptions(options);
  const commands = createXanCommands(options);
  return { name: "xan-commands", setup(host) {
    if (!replace && host.commands.has("xan")) throw new Error("Command already registered: xan");
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
