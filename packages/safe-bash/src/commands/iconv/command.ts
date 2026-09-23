import { FsError, resolvePath, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { openFileOutput, type FileOutput } from "../../contracts/filesystem-output.js";
import { createOutputOperation } from "../../contracts/output.js";
import { outputFailure, type ByteSink } from "../../contracts/io.js";
import { Budget, IconvError, pathText, settings, type IconvCommandsOptions, type IconvLimits } from "./internal.js";
import { Lifecycle } from "./lifecycle.js";
import { Reader, fsDetail } from "./reader.js";
import { parse, type Parsed } from "./options.js";
import { convert } from "./codec.js";

async function transcode(options: Parsed, lifecycle: Lifecycle): Promise<number> {
  const state = { swap: false };
  let exitCode = 0, stdinUsed = false;
  for (const file of options.files) {
    if (options.verbose && file !== "-") {
      lifecycle.budget.check(file.length * 3 + 2, lifecycle.budget.limits.maxDiagnosticBytes, "diagnostic bytes");
      await lifecycle.write(new TextEncoder().encode(`${file}:\n`), true);
    }
    if (file === "-" && stdinUsed) { await lifecycle.diagnostic("error while reading the input: Bad file descriptor"); return 1; }
    if (file === "-") stdinUsed = true;
    const reader = new Reader(file, lifecycle);
    let fatal = false;
    try {
      await reader.open();
      const input = await reader.all();
      const result = await convert(input, options, state, lifecycle);
      exitCode ||= result.status; fatal = result.fatal;
    } catch (error) {
      lifecycle.budget.signal.throwIfAborted();
      if (!(error instanceof FsError)) throw error;
      exitCode = 1; fatal = reader.stage === "read";
      await lifecycle.diagnostic(fatal ? `error while reading the input: ${fsDetail(error)}` : `cannot open input file \`${file}': ${fsDetail(error)}`);
    }
    await lifecycle.operation(() => reader.close());
    if (fatal) break;
  }
  return exitCode;
}

async function execute(context: CommandContext, limits: IconvLimits): Promise<{ exitCode: number }> {
  let lifecycle: Lifecycle | undefined;
  let fileOutput: FileOutput | undefined;
  const caller = context.signal;
  caller.throwIfAborted();
  const stdout = context.stdout;
  caller.throwIfAborted();
  const capability = stdout.ownedOutput;
  caller.throwIfAborted();
  const consumer = capability?.consumerClosed;
  caller.throwIfAborted(); consumer?.throwIfAborted();
  const failureHandler = stdout[outputFailure];
  caller.throwIfAborted(); consumer?.throwIfAborted();
  const registerCleanup = context.registerCleanup;
  caller.throwIfAborted(); consumer?.throwIfAborted();
  const destination = capability ?? stdout;
  const write = async (value: Uint8Array): Promise<void> => {
    lifecycle!.assertOpen();
    const selected = fileOutput?.sink ?? destination;
    const method = selected.write;
    lifecycle!.assertOpen();
    try { await Reflect.apply(method, selected, [value]); }
    catch (error) {
      lifecycle!.budget.signal.throwIfAborted();
      if (!fileOutput || !(error instanceof FsError)) throw error;
      throw new IconvError(`error while writing output: ${fsDetail(error)}`);
    }
  };
  const captured: ByteSink = {
    write,
    ...(capability ? { ownedOutput: { consumerClosed: consumer!, write } } : {}),
    ...(failureHandler ? { [outputFailure]: failureHandler } : {}),
  };
  const admission = { closed: false };
  const output = createOutputOperation({ signal: caller, ...(registerCleanup ? { registerCleanup(cleanup) {
    caller.throwIfAborted();
    Reflect.apply(registerCleanup, context, [() => { admission.closed = true; return cleanup(); }]);
  } } : {}) }, captured);
  const budget = new Budget(context, limits, output.signal, caller, admission);
  let failure: { reason: unknown } | undefined, primary: { reason: unknown } | undefined;
  let exitCode = 0;
  try {
    lifecycle = new Lifecycle(budget, output, captured);
    const options = parse(budget);
    if (options.output !== undefined && options.output !== "-") {
      try {
        if (options.output === "") throw new FsError("ENOENT", { path: "" });
        const path = resolvePath(context.cwd, pathText(options.output));
        fileOutput = await lifecycle.operation(() => openFileOutput({
          fs: context.fs, signal: budget.signal,
          registerCleanup: output.registerCleanup.bind(output),
          outputBudget: "independent",
        }, path, "w"));
      } catch (error) {
        budget.signal.throwIfAborted();
        if (!(error instanceof FsError)) throw error;
        throw new IconvError(`cannot open output file \`${options.output}': ${fsDetail(error)}`);
      }
    }
    exitCode = await transcode(options, lifecycle);
    if (fileOutput) {
      try { await lifecycle.operation(() => fileOutput!.finish()); }
      catch (error) {
        budget.signal.throwIfAborted();
        if (!(error instanceof FsError)) throw error;
        throw new IconvError(`error while writing output: ${fsDetail(error)}`);
      }
    }
  } catch (error) {
    primary = { reason: error };
    if (error instanceof IconvError && !output.signal.aborted && lifecycle) {
      exitCode = error.status;
      try { await lifecycle.diagnostic(error.message); }
      catch (reporting) { failure = { reason: new AggregateError([error, reporting], "iconv failure reporting failed") }; }
    } else failure = { reason: error };
  }
  try { await output.close(); }
  catch (cleanup) {
    const previous = failure ?? primary;
    failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "iconv execution and cleanup failed") : cleanup };
  }
  caller.throwIfAborted(); output.signal.throwIfAborted();
  if (lifecycle?.diagnosticCancellation) throw lifecycle.diagnosticCancellation.reason;
  if (failure) throw failure.reason;
  return { exitCode };
}

export function createIconvCommand(options: IconvCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "iconv", description: "Convert bytes between bounded ASCII, Latin-1, UTF-8 and UTF-16 encodings", execute: context => execute(context, limits) };
}
