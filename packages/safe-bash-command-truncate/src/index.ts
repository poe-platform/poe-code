import { shellValueByteLength } from "safe-bash-contracts/value";
import { commandRuntimeIdentity, FsError, dirname, getCommandArguments, writeBytes, type CommandContext, type CommandDefinition, type CommandResult, type FileStat, type FileSystemCapabilities, type VirtualShellPlugin } from "safe-bash-contracts";
import { builtInDirectContextExecutors, isDefaultCommandOptions, codeOf, pathOf, syncCommandEvaluators } from "safe-bash-io-engine/internal";
import { yieldTurn } from "safe-bash-contracts/yield";
import { argumentBytes, helpText, maximumSize, minimumSize, parseArguments, quote, TruncateError, type TruncateArguments } from "./arguments.js";

function operandPath(context: CommandContext, operand: string): string {
  let name: string;
  try { name = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(argumentBytes(operand)); }
  catch { throw new FsError("ENOTSUP"); }
  return pathOf(context, name);
}

export interface TruncateLimits { readonly maxArgumentBytes: number; }

export interface TruncateCommandsOptions {
  readonly limits?: Partial<TruncateLimits>;
  readonly replace?: boolean;
  readonly ioBlockSize?: (path: string, stat: FileStat, context: CommandContext) => number | Promise<number>;
  readonly seekEnd?: (path: string, stat: FileStat, context: CommandContext) => number | Promise<number>;
}

const errors: Readonly<Record<string, string>> = {
  EACCES: "Permission denied", EPERM: "Operation not permitted", ENOENT: "No such file or directory",
  EISDIR: "Is a directory", ENOTDIR: "Not a directory", ELOOP: "Too many levels of symbolic links",
  EROFS: "Read-only file system", ENOSPC: "No space left on device", EFBIG: "File too large",
  EINVAL: "Invalid argument", EIO: "Input/output error", ENAMETOOLONG: "File name too long",
  ENOTSUP: "Operation not supported", EOPNOTSUPP: "Operation not supported", ENOSYS: "Function not implemented",
};

function failure(operation: string, error: unknown): TruncateError {
  const code = codeOf(error);
  return new TruncateError(`${operation}: ${code && errors[code] || (error instanceof Error ? error.message : String(error))}`);
}

async function measuredSize(context: CommandContext, path: string, stat: FileStat, operand: string, options: TruncateCommandsOptions): Promise<bigint> {
  let size = stat.size;
  if (stat.type !== "file" && stat.type !== "symlink") {
    if (!options.seekEnd) throw new TruncateError(`cannot get the size of ${quote(operand)}: Operation not supported (seek-end measurement is unavailable)`);
    try {
      context.signal.throwIfAborted();
      size = await options.seekEnd(path, stat, context);
      context.signal.throwIfAborted();
    } catch (error) { throw failure(`cannot get the size of ${quote(operand)}`, error); }
  }
  if (!Number.isSafeInteger(size) || size < 0) throw new TruncateError(`${quote(operand)} has unusable size: Operation not supported`);
  return BigInt(size);
}

async function admit(context: CommandContext, path: string, create: boolean): Promise<void> {
  const check = (capabilities: FileSystemCapabilities) => {
    if (capabilities.readOnly) throw new FsError("EROFS");
    if (capabilities.truncate === false || !context.fs.truncate || capabilities.stat === false
      || (create && capabilities.append === false)) throw new FsError("ENOTSUP");
  };
  check(context.fs.capabilities);
  if (!context.fs.capabilitiesFor) return;
  let candidate = path;
  while (true) {
    context.signal.throwIfAborted();
    try {
      const capabilities = await context.fs.capabilitiesFor(candidate, { signal: context.signal });
      context.signal.throwIfAborted();
      check(capabilities);
      return;
    }
    catch (error) {
      if (codeOf(error) !== "ENOENT" || candidate === "/") throw error;
      candidate = dirname(candidate);
    }
  }
}

async function truncateFile(context: CommandContext, args: TruncateArguments, operand: string, reference: bigint | undefined, options: TruncateCommandsOptions): Promise<void> {
  let stat: FileStat, path: string;
  const fsOptions = { signal: context.signal };
  try {
    if (operand === "" && args.noCreate) return;
    path = operandPath(context, operand);
    let existing: FileStat | undefined;
    try { existing = await context.fs.stat(path, fsOptions); }
    catch (error) { if (codeOf(error) !== "ENOENT") throw error; }
    context.signal.throwIfAborted();
    if (existing === undefined && args.noCreate) return;
    if (existing?.type === "directory") throw new FsError("EISDIR");
    await admit(context, path, existing === undefined);
    context.signal.throwIfAborted();
    if (existing === undefined) {
      await context.fs.writeFile(path, new Uint8Array(), { ...fsOptions, flag: "a", mode: 0o666 });
      context.signal.throwIfAborted();
      existing = await context.fs.stat(path, fsOptions);
      context.signal.throwIfAborted();
    }
    stat = existing;
  } catch (error) { throw failure(`cannot open ${quote(operand)} for writing`, error); }
  let size = args.size ?? reference!;
  if (args.ioBlocks) {
    let blockSize: unknown = "ioBlockSize" in stat ? stat.ioBlockSize : undefined;
    if (blockSize === undefined && options.ioBlockSize) {
      try {
        context.signal.throwIfAborted();
        blockSize = await options.ioBlockSize(path, stat, context);
        context.signal.throwIfAborted();
      } catch (error) { throw failure(`cannot get the I/O block size of ${quote(operand)}`, error); }
    }
    if (blockSize === undefined) throw new TruncateError(`cannot truncate ${quote(operand)}: Operation not supported (I/O block size is unavailable)`);
    if (typeof blockSize !== "number" || !Number.isSafeInteger(blockSize) || blockSize <= 0) throw new TruncateError(`cannot truncate ${quote(operand)}: Operation not supported (invalid I/O block size)`);
    const scaled = size * BigInt(blockSize);
    if (scaled > maximumSize || scaled < minimumSize) throw new TruncateError(`overflow in ${size} * ${blockSize} byte blocks for file ${quote(operand)}`);
    size = scaled;
  }
  if (args.mode !== "absolute") {
    const base = reference ?? await measuredSize(context, path, stat, operand, options);
    if (args.mode === "<") size = base < size ? base : size;
    else if (args.mode === ">") size = base > size ? base : size;
    else if (args.mode === "/") size = base - base % size;
    else {
      if (args.mode === "%") size = base % size === 0n ? 0n : size - base % size;
      size += base;
      if (size > maximumSize || size < minimumSize) throw new TruncateError(`overflow extending size of file ${quote(operand)}`);
    }
  }
  if (size < 0n) size = 0n;
  if (size > BigInt(Number.MAX_SAFE_INTEGER)) throw new TruncateError(`failed to truncate ${quote(operand)} at ${size} bytes: Operation not supported (size exceeds exact filesystem integer range)`);
  try {
    context.signal.throwIfAborted();
    await context.fs.truncate!(path, Number(size), fsOptions);
    context.signal.throwIfAborted();
  } catch (error) { throw failure(`failed to truncate ${quote(operand)} at ${size} bytes`, error); }
}

async function executeInvocation(context: CommandContext, settings: TruncateCommandsOptions): Promise<CommandResult> {
  context.signal.throwIfAborted();
  const report = async (error: unknown) => {
    context.signal.throwIfAborted();
    const message = error instanceof Error ? error.message : String(error);
    const diagnostic = `truncate: ${message}\n${error instanceof TruncateError && error.usage ? "Try 'truncate --help' for more information.\n" : ""}`;
    await writeBytes(context.stderr, error instanceof TruncateError && error.raw ? argumentBytes(diagnostic) : new TextEncoder().encode(diagnostic), context.signal);
  };
  let args: TruncateArguments, reference: bigint | undefined;
  try {
    args = parseArguments(context.args, Object.hasOwn(context.env, "POSIXLY_CORRECT"), getCommandArguments(context));
    if (args.display) {
      await writeBytes(context.stdout, new TextEncoder().encode(args.display === "help" ? helpText : "truncate (safe-bash; GNU coreutils 9.7 semantics)\n"), context.signal);
      return { exitCode: 0 };
    }
    if (args.reference !== undefined) {
      let stat: FileStat;
      try { stat = await context.fs.stat(operandPath(context, args.reference), { signal: context.signal }); }
      catch (error) { throw failure(`cannot stat ${quote(args.reference)}`, error); }
      reference = await measuredSize(context, operandPath(context, args.reference), stat, args.reference, settings);
    }
  } catch (error) { await report(error); return { exitCode: 1 }; }
  let exitCode = 0;
  let completed = 0;
  for (const operand of args.files) {
    context.signal.throwIfAborted();
    try { await truncateFile(context, args, operand, reference, settings); }
    catch (error) { await report(error); exitCode = 1; }
    if (++completed % 64 === 0) await yieldTurn(context.signal);
  }
  return { exitCode };
}


export function evalSyncTruncate(
  opArgs: readonly string[],
  readFileSync?: (filePath: string) => Uint8Array | undefined,
  writeFileSync?: (filePath: string, bytes: Uint8Array) => boolean,
): string | undefined {
  try {
    const args = parseArguments(opArgs, false);
    if (args.display === "help") return helpText;
    if (args.display === "version") return "truncate (safe-bash; GNU coreutils 9.7 semantics)\n";
    if (!writeFileSync || args.files.length === 0) return undefined;
    const blockFactor = args.ioBlocks ? 4096n : 1n;
    let refSize: bigint | undefined;
    if (args.reference !== undefined) {
      const refBytes = readFileSync?.(args.reference);
      if (!refBytes) return undefined;
      refSize = BigInt(refBytes.length);
    }
    for (const file of args.files) {
      const existing = readFileSync?.(file);
      if (!existing && args.noCreate) continue;
      const curSize = BigInt(existing?.length ?? 0);
      const base = refSize ?? curSize;
      const scaledSize = args.size === undefined ? undefined : args.size * blockFactor;
      let target: bigint;
      if (scaledSize === undefined) target = refSize!;
      else if (args.mode === "absolute") target = scaledSize;
      else if (args.mode === "relative") target = base + scaledSize;
      else if (args.mode === "<") target = curSize < scaledSize ? curSize : scaledSize;
      else if (args.mode === ">") target = curSize > scaledSize ? curSize : scaledSize;
      else if (args.mode === "/") target = (curSize / scaledSize) * scaledSize;
      else target = ((curSize + scaledSize - 1n) / scaledSize) * scaledSize;
      if (target < 0n || target > 1048576n) return undefined;
      const n = Number(target);
      const out = new Uint8Array(n);
      if (existing && existing.length > 0) {
        out.set(existing.subarray(0, Math.min(existing.length, n)));
      }
      if (!writeFileSync(file, out)) return undefined;
    }
    return "";
  } catch {
    return undefined;
  }
}

syncCommandEvaluators.evalSyncTruncate = evalSyncTruncate;

export function createTruncateCommand(options: TruncateCommandsOptions = {}): CommandDefinition {
  const maximum = options.limits?.maxArgumentBytes ?? Infinity;
  if (maximum !== Infinity && (!Number.isSafeInteger(maximum) || maximum < 1)) throw new RangeError("maxArgumentBytes must be positive");
  const settings = { ...options };
  const def: CommandDefinition = {
    name: "truncate",
    runtimeIdentity: commandRuntimeIdentity,
    filesystemRequirements: [
      { id: "resize", description: "Resize existing files", capabilities: ["stat", "truncate"], mutates: true },
      { id: "create", description: "Create missing files without replacing existing bytes", capabilities: ["stat", "truncate", "append"], mutates: true },
    ],
    async execute(context) {
      let total = 0;
      for (const value of getCommandArguments(context).values) { total += shellValueByteLength(value); if (total > maximum) throw new FsError("EFBIG", { message: "argument byte limit exceeded" }); }

      const controller = new AbortController();
      let pending: Promise<CommandResult> | undefined;
      let cleanup: Promise<void> | undefined;
      const close = (): Promise<void> => {
        controller.abort(new Error("truncate invocation is closed"));
        return cleanup ??= (async () => { await pending?.catch(() => {}); })();
      };
      context.registerCleanup?.(close);
      const invocation = context.registerCleanup ? { ...context, signal: AbortSignal.any([context.signal, controller.signal]) } : context;
      try {
        pending = Promise.resolve().then(() => executeInvocation(invocation, settings));
        return await pending;
      } finally { await close(); }
    },
  };
  if (isDefaultCommandOptions(options)) builtInDirectContextExecutors.add(def.execute);
  return def;
}

export function createTruncateCommands(options: TruncateCommandsOptions = {}): readonly CommandDefinition[] {
  return [createTruncateCommand(options)];
}

export function truncateCommands(options: TruncateCommandsOptions = {}): VirtualShellPlugin {
  const commands = createTruncateCommands(options), replace = options.replace ?? false;
  return { name: "truncate-commands", setup(host) {
    if (!replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace });
  } };
}
