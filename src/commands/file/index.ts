import { FsError, readBytes, resolvePath, type ByteSource, type CommandContext, type CommandDefinition, type FileStat, type VirtualShellPlugin } from "../../contracts/index.js";
import { classify, type Classification } from "./classify.js";
import { diagnostic, escapeName, FileFailure, FileLimitError, settings, SharedBudget, type FileCommandsOptions } from "./shared.js";

export type { FileCommandsOptions, FileLimits } from "./shared.js";

const profile = "virtual-bash-file-v1";
const help = "Usage: file [-bihL] [--mime-type] [--mime-encoding] [--] FILE...\nClassify bounded VFS content; '-' reads stdin. -h is the default.\nOptions: --brief, --mime, --dereference, --no-dereference, --help, --version\nNo decompression, external magic database, or complete format validation.\n";

interface Arguments {
  brief: boolean;
  follow: boolean;
  mimeType: boolean;
  mimeEncoding: boolean;
  action?: "help" | "version";
  names: string[];
}

function parse(args: readonly string[], budget: SharedBudget): Arguments {
  const result: Arguments = { brief: false, follow: false, mimeType: false, mimeEncoding: false, names: [] };
  let argumentBytes = 0;
  for (const argument of args) {
    argumentBytes += Buffer.byteLength(argument) + 1;
    budget.check(argumentBytes, budget.limits.maxArgumentBytes, "argument");
  }
  let options = true;
  for (const argument of args) {
    if (options && argument === "--") { options = false; continue; }
    if (!options || !argument.startsWith("-") || argument === "-") { result.names.push(argument); continue; }
    const flags = argument.startsWith("--") ? [argument] : Array.from(argument.slice(1), flag => `-${flag}`);
    for (const flag of flags) {
      switch (flag) {
        case "-b": case "--brief": result.brief = true; break;
        case "-L": case "--dereference": result.follow = true; break;
        case "-h": case "--no-dereference": result.follow = false; break;
        case "-i": case "--mime": result.mimeType = result.mimeEncoding = true; break;
        case "--mime-type": result.mimeType = true; break;
        case "--mime-encoding": result.mimeEncoding = true; break;
        case "--help": result.action = "help"; break;
        case "--version": result.action = "version"; break;
        default: throw new FileFailure(`unsupported option '${escapeName(flag)}'`);
      }
    }
  }
  budget.check(result.names.length, budget.limits.maxEntries, "entry");
  if (!result.names.length && !result.action) throw new FileFailure("missing file operand (use '-' for stdin)");
  return result;
}

async function prefix(source: ByteSource, budget: SharedBudget, signal: AbortSignal, controller?: AbortController): Promise<{ bytes: Uint8Array; complete: boolean }> {
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = true;
  try {
    for await (const chunk of readBytes(source, signal)) {
      await budget.step();
      budget.input(chunk.length);
      const retained = new Uint8Array(chunk.subarray(0, budget.limits.maxSniffBytes - size));
      if (retained.length) chunks.push(retained);
      size += retained.length;
      if (size === budget.limits.maxSniffBytes) {
        complete = false;
        controller?.abort(new FsError("EPIPE", { message: "file prefix inspection ended" }));
        break;
      }
    }
  } catch (error) {
    signal.throwIfAborted();
    if (complete || !controller?.signal.aborted || error !== controller.signal.reason) throw error;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return { bytes, complete };
}

async function inspect(context: CommandContext, name: string, follow: boolean, budget: SharedBudget, stdinUsed: boolean): Promise<Classification> {
  if (name === "-") {
    if (stdinUsed) return classify(new Uint8Array(), true);
    const sample = await prefix(context.stdin, budget, budget.signal);
    await budget.step(sample.bytes.length);
    const result = classify(sample.bytes, sample.complete);
    budget.checkTime();
    return result;
  }
  if (!name || name.includes("\0")) throw new FsError(name ? "EINVAL" : "ENOENT", { path: name });
  const path = resolvePath(context.cwd, name);
  const fs = context.fs;
  const stat: FileStat = await budget.host(() => follow ? fs.stat(path, { signal: budget.signal }) : fs.lstat(path, { signal: budget.signal }));
  if (stat.type === "directory") return { description: "directory", mime: "inode/directory", encoding: "binary" };
  if (stat.type === "symlink") {
    if (follow) throw new FsError("ENOTSUP", { path, message: "followed stat returned a symbolic link" });
    const target = fs.readlink ? await budget.host(() => fs.readlink!(path, { signal: budget.signal })) : undefined;
    return { description: target === undefined ? "symbolic link" : `symbolic link to ${escapeName(target)}`, mime: "inode/symlink", encoding: "binary" };
  }
  if (stat.type !== "file") throw new FsError("ENOTSUP", { path, message: "unsupported filesystem entry type" });
  let sample: { bytes: Uint8Array; complete: boolean };
  if (fs.readStream) {
    const controller = new AbortController();
    const signal = AbortSignal.any([budget.signal, controller.signal]);
    try {
      sample = await prefix(fs.readStream(path, { signal, start: 0, endExclusive: budget.limits.maxSniffBytes,
        chunkSize: Math.min(16384, budget.limits.maxChunkBytes, budget.limits.maxSniffBytes) }), budget, budget.signal, controller);
    } finally { controller.abort(new FsError("EPIPE", { message: "file prefix inspection ended" })); }
  } else {
    if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new FsError("ENOTSUP", { path, message: "bounded file inspection requires readStream or a known size" });
    const maximum = Math.min(budget.limits.maxReadFileBytes, budget.limits.maxChunkBytes, budget.remainingInputBytes);
    budget.check(stat.size, maximum, "readFile");
    const bytes = await budget.host(() => fs.readFile(path, { signal: budget.signal, maxBytes: maximum }));
    if (!(bytes instanceof Uint8Array)) throw new TypeError("readFile must return Uint8Array");
    budget.check(bytes.length, maximum, "readFile");
    budget.input(bytes.length);
    sample = { bytes: new Uint8Array(bytes.subarray(0, budget.limits.maxSniffBytes)), complete: bytes.length <= budget.limits.maxSniffBytes };
  }
  await budget.step(sample.bytes.length);
  const result = classify(sample.bytes, sample.complete);
  budget.checkTime();
  return result;
}

export function createFileCommand(options: FileCommandsOptions = {}): CommandDefinition {
  const limits = settings(options);
  return { name: "file", description: `Bounded content classification (${profile})`, async execute(context) {
    context.signal.throwIfAborted();
    const budget = new SharedBudget(context, limits);
    let writing = false;
    try {
      const args = parse(context.args, budget);
      if (args.action) {
        writing = true;
        await budget.output(context.stdout, args.action === "help" ? help : `file (${profile})\n`);
        return { exitCode: 0 };
      }
      let failed = false;
      let stdinUsed = false;
      for (const name of args.names) {
        await budget.step();
        let detected: Classification;
        try { detected = await inspect(context, name, args.follow, budget, stdinUsed); }
        catch (error) {
          budget.signal.throwIfAborted();
          if (!(error instanceof FsError)) throw error;
          failed = true;
          writing = true;
          await budget.output(context.stderr, `file: ${escapeName(name)}: ${diagnostic(error)}\n`);
          writing = false;
          continue;
        } finally { if (name === "-") stdinUsed = true; }
        const content = args.mimeType && args.mimeEncoding ? `${detected.mime}; charset=${detected.encoding}`
          : args.mimeType ? detected.mime : args.mimeEncoding ? detected.encoding : detected.description;
        writing = true;
        await budget.output(context.stdout, `${args.brief ? "" : `${name === "-" ? "/dev/stdin" : escapeName(name)}: `}${content}\n`);
        writing = false;
      }
      return { exitCode: failed ? 1 : 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      budget.signal.throwIfAborted();
      if (writing && !(error instanceof FileLimitError)) throw error;
      if (!(error instanceof FileFailure)) throw error;
      await budget.failure(`file: ${diagnostic(error)}\n`);
      return { exitCode: error instanceof FileLimitError ? 1 : 2 };
    } finally { budget.dispose(); }
  } };
}

export function createFileCommands(options: FileCommandsOptions = {}): readonly CommandDefinition[] {
  return [createFileCommand(options)];
}

export function fileCommands(options: FileCommandsOptions = {}): VirtualShellPlugin {
  const commands = createFileCommands(options);
  return { name: "file-commands", setup(host) {
    if (!options.replace) for (const command of commands) {
      if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
    }
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
