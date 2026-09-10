import { FsError, type CommandContext, type CommandDefinition } from "../../contracts/index.js";
import { createOutputOperation } from "../../contracts/output.js";
import { outputFailure, type ByteSink } from "../../contracts/io.js";
import { Budget, HexdumpError, settings, type HexdumpCommandsOptions, type HexdumpLimits } from "./internal.js";
import { Lifecycle, Reader, fsDetail } from "./io.js";
import { parse, type Parsed } from "./options.js";
import { formatBlock } from "./format.js";

async function dump(options: Parsed, lifecycle: Lifecycle, name: string): Promise<number> {
  if (options.count === 0) return 0;
  const { budget } = lifecycle;
  budget.retain(32);
  const block = new Uint8Array(16), previous = new Uint8Array(16);
  let address = 0, used = 0, skip = options.skip, count = options.count;
  let hasPrevious = false, squeezed = false, exitCode = 0;
  const emit = async (): Promise<void> => {
    let same = hasPrevious;
    for (let index = 0; same && index < used; index++) if (block[index] !== previous[index]) same = false;
    budget.charge(used);
    if (!options.verbose && same) {
      if (!squeezed) await lifecycle.write("*\n");
      squeezed = true;
    } else {
      for (let index = 0; index < Math.max(1, options.canonical); index++) {
        budget.charge(16);
        await budget.checkpointWork();
        await lifecycle.write(formatBlock(block, used, address, options.canonical > 0));
      }
      previous.set(block);
      hasPrevious = true;
      squeezed = false;
    }
    address += used;
    used = 0;
  };
  for (const file of options.files.length ? options.files : [undefined]) {
    if (count === 0) break;
    const reader = new Reader(file, lifecycle);
    let opened = true;
    try {
      await reader.open();
    } catch (error) {
      budget.signal.throwIfAborted();
      if (!(error instanceof FsError)) throw error;
      opened = false;
      if (error.code !== "EISDIR") exitCode = 1;
      await lifecycle.write(`${name}: ${file ?? "stdin"}: ${fsDetail(error)}\n`, true);
    }
    if (opened) {
      while (count > 0) {
        let byte: number;
        try { byte = await reader.get(); }
        catch (error) {
          budget.signal.throwIfAborted();
          if (!(error instanceof FsError)) throw error;
          await lifecycle.write(`${name}: ${file ?? "stdin"}: ${fsDetail(error)}\n`, true);
          break;
        }
        if (byte < 0) break;
        if (skip > 0) { skip--; address++; continue; }
        block[used++] = byte;
        count--;
        if (used === 16) await emit();
      }
    }
    await lifecycle.operation(() => reader.close());
  }
  if (used) await emit();
  if (address > 0) await lifecycle.write(address.toString(16).padStart(options.canonical ? 8 : 7, "0") + "\n");
  return exitCode;
}

async function execute(context: CommandContext, name: string, limits: HexdumpLimits): Promise<{ exitCode: number }> {
  let lifecycle: Lifecycle | undefined;
  const caller = context.signal;
  caller.throwIfAborted();
  const stdout = context.stdout;
  caller.throwIfAborted();
  const capability = stdout.ownedOutput;
  caller.throwIfAborted();
  const consumer = capability?.consumerClosed;
  caller.throwIfAborted();
  consumer?.throwIfAborted();
  const failureHandler = stdout[outputFailure];
  caller.throwIfAborted();
  consumer?.throwIfAborted();
  const registerCleanup = context.registerCleanup;
  caller.throwIfAborted();
  consumer?.throwIfAborted();
  const destination = capability ?? stdout;
  const write = async (value: Uint8Array): Promise<void> => {
    lifecycle!.assertOpen();
    const method = destination.write;
    lifecycle!.assertOpen();
    await Reflect.apply(method, destination, [value]);
  };
  const captured: ByteSink = {
    write,
    ...(capability ? { ownedOutput: { consumerClosed: consumer!, write } } : {}),
    ...(failureHandler ? { [outputFailure]: failureHandler } : {}),
  };
  const output = createOutputOperation({ signal: caller, ...(registerCleanup ? { registerCleanup(cleanup) {
    caller.throwIfAborted();
    Reflect.apply(registerCleanup, context, [cleanup]);
  } } : {}) }, captured);
  const budget = new Budget(context, limits, output.signal, caller);
  let failure: { reason: unknown } | undefined;
  let primary: { reason: unknown } | undefined;
  let exitCode = 0;
  try {
    lifecycle = new Lifecycle(budget, output, captured, caller);
    exitCode = await dump(parse(budget, name), lifecycle, name);
  } catch (error) {
    primary = { reason: error };
    if (error instanceof HexdumpError && !output.signal.aborted && lifecycle) {
      exitCode = 1;
      try { await lifecycle.write(`${error.bare ? "" : name + ": "}${error.message}\n`, true); }
      catch (reporting) { failure = { reason: new AggregateError([error, reporting], "hexdump failure reporting failed") }; }
    } else failure = { reason: error };
  }
  try { await output.close(); }
  catch (cleanup) {
    const previous = failure ?? primary;
    failure = { reason: previous ? new AggregateError([previous.reason, cleanup], "hexdump execution and cleanup failed") : cleanup };
  }
  caller.throwIfAborted();
  output.signal.throwIfAborted();
  if (lifecycle?.diagnosticCancellation) throw lifecycle.diagnosticCancellation.reason;
  if (failure) throw failure.reason;
  return { exitCode };
}

export function createHexdumpCommand(options: HexdumpCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "hexdump", description: "Display bytes as hexadecimal words or canonical hex and ASCII",
    execute: context => execute(context, "hexdump", limits),
  };
}

export function createHdCommand(options: HexdumpCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "hd", description: "Display canonical hexadecimal and ASCII bytes",
    execute: context => execute(context, "hd", limits),
  };
}
