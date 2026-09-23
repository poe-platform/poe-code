import { FsError, readBytes, toByteSource, type ByteSource, type CommandContext, type CommandDefinition, type FileStat, type VirtualShellPlugin } from "../../contracts/index.js";
import { pathOf } from "../internal.js";
import { classify, type Classification } from "./classify.js";
import { limitMessage, FileFailure, FileLimitError, settings, SharedBudget, type FileCommandsOptions } from "./shared.js";

export type { FileCommandsOptions, FileLimits } from "./shared.js";

const profile = "virtual-bash-file-v1";
const help = "Usage: file [-bihL0] [-F SEPARATOR] [-f NAMEFILE] [--mime-type] [--mime-encoding] [--] FILE...\nClassify bounded VFS content; '-' reads stdin. -h is the default.\nOptions: --brief, --mime, --dereference, --no-dereference, --separator, --print0, --files-from, --help, --version\nNo decompression, external magic database, or complete format validation.\n";

interface Arguments {
  brief: boolean;
  follow: boolean;
  mimeType: boolean;
  mimeEncoding: boolean;
  separator: string;
  print0: number;
  action?: "help" | "version";
  names: string[];
  listed: { name: string; format: Arguments }[];
  stdinUsed: boolean;
}

async function parse(context: CommandContext, budget: SharedBudget): Promise<Arguments> {
  const args = context.args;
  const result: Arguments = { brief: false, follow: false, mimeType: false, mimeEncoding: false, separator: ":", print0: 0, names: [], listed: [], stdinUsed: false };
  let argumentBytes = 0;
  budget.check(args.length, budget.limits.maxArgumentBytes, "argument");
  for (const argument of args) {
    budget.check(argument.length + 1, budget.limits.maxArgumentBytes - argumentBytes, "argument");
    budget.work(argument.length);
    argumentBytes += Buffer.byteLength(argument) + 1;
    budget.check(argumentBytes, budget.limits.maxArgumentBytes, "argument");
  }
  let options = true;
  let hasList = false;
  for (let index = 0; index < args.length; index++) {
    const argument = args[index]!;
    if (options && argument === "--") { options = false; continue; }
    if (!options || !argument.startsWith("-") || argument === "-") { result.names.push(argument); continue; }
    const long = argument.startsWith("--");
    const equals = long ? argument.indexOf("=") : -1;
    const flags = long ? [equals < 0 ? argument : argument.slice(0, equals)] : Array.from(argument.slice(1), flag => `-${flag}`);
    for (let position = 0; position < flags.length; position++) {
      const flag = flags[position]!;
      if (flag === "-F" || flag === "--separator" || flag === "-f" || flag === "--files-from") {
        const attached = long ? (equals < 0 ? undefined : argument.slice(equals + 1))
          : (position + 1 < flags.length ? argument.slice(position + 2) : undefined);
        const value = attached ?? args[++index];
        if (value === undefined) throw new FileFailure(`option '${flag}' requires an argument`);
        if (flag === "-F" || flag === "--separator") result.separator = value;
        else {
          hasList = true;
          const names = value === "-" && result.stdinUsed ? { names: [], bytes: 0 }
            : await readNames(context, value, budget, budget.limits.maxArgumentBytes - argumentBytes);
          argumentBytes += names.bytes;
          const format = { ...result, names: [], listed: [] };
          for (const name of names.names) {
            budget.check(result.names.length + result.listed.length + 1, budget.limits.maxEntries, "entry");
            result.listed.push({ name, format });
          }
          if (value === "-") result.stdinUsed = true;
        }
        break;
      }
      if (long && equals >= 0) throw new FileFailure(`unsupported option '${await budget.escapeName(argument)}'`);
      switch (flag) {
        case "-b": case "--brief": result.brief = true; break;
        case "-L": case "--dereference": result.follow = true; break;
        case "-h": case "--no-dereference": result.follow = false; break;
        case "-i": case "--mime": result.mimeType = result.mimeEncoding = true; break;
        case "--mime-type": result.mimeType = true; break;
        case "--mime-encoding": result.mimeEncoding = true; break;
        case "-0": case "--print0": result.print0 = Math.min(2, result.print0 + 1); break;
        case "--help": result.action = "help"; break;
        case "--version": result.action = "version"; break;
        default: throw new FileFailure(`unsupported option '${await budget.escapeName(flag)}'`);
      }
    }
  }
  budget.check(result.names.length + result.listed.length, budget.limits.maxEntries, "entry");
  if (!result.names.length && !result.listed.length && !result.action && !hasList) throw new FileFailure("missing file operand (use '-' for stdin)");
  return result;
}

async function readNames(context: CommandContext, name: string, budget: SharedBudget, maximum: number): Promise<{ names: string[]; bytes: number }> {
  let source: ByteSource;
  if (name === "-") source = context.stdin;
  else {
    const path = pathOf(context, name);
    const fs = context.fs;
    const capabilities = fs.capabilitiesFor ? await budget.host(() => fs.capabilitiesFor!(path, { signal: budget.signal })) : fs.capabilities;
    if (fs.readStream && capabilities.streamingRead !== false) source = fs.readStream(path, { signal: budget.signal, chunkSize: Math.min(16384, budget.limits.maxChunkBytes) });
    else {
      const stat = await budget.host(() => fs.stat(path, { signal: budget.signal }));
      const bound = Math.min(maximum, budget.limits.maxReadFileBytes, budget.limits.maxChunkBytes, budget.remainingInputBytes);
      if (!Number.isSafeInteger(stat.size) || stat.size < 0) throw new FsError("ENOTSUP", { path, message: "bounded filename list requires readStream or a known size" });
      budget.check(stat.size, bound, "readFile");
      const bytes = await budget.host(() => fs.readFile(path, { signal: budget.signal, maxBytes: bound }));
      budget.check(bytes.length, bound, "readFile");
      source = toByteSource(bytes);
    }
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for await (const chunk of readBytes(source, budget.signal)) {
    budget.input(chunk.length);
    budget.check(chunk.length, maximum - size, "argument");
    await budget.step(chunk.length);
    chunks.push(new Uint8Array(chunk));
    size += chunk.length;
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
  catch { throw new FileFailure("filename list must contain UTF-8 names"); }
  const names: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index++) {
    if (index % 4096 === 0) await budget.step();
    if (text[index] !== "\n") continue;
    budget.check(names.length + 1, budget.limits.maxEntries, "entry");
    names.push(text.slice(start, index));
    start = index + 1;
  }
  if (start < text.length) { budget.check(names.length + 1, budget.limits.maxEntries, "entry"); names.push(text.slice(start)); }
  return { names, bytes: size };
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

async function inspect(context: CommandContext, name: string, follow: boolean, describe: boolean, budget: SharedBudget, stdinUsed: boolean): Promise<Classification | string> {
  if (name === "-") {
    if (stdinUsed) return classify(new Uint8Array(), true);
    const sample = await prefix(context.stdin, budget, budget.signal);
    await budget.step(sample.bytes.length);
    const result = classify(sample.bytes, sample.complete);
    budget.checkTime();
    return result;
  }
  const fs = context.fs;
  let path: string;
  let stat: FileStat;
  try {
    if (!name || name.includes("\0")) throw new FsError(name ? "EINVAL" : "ENOENT", { path: name });
    path = pathOf(context, name);
    stat = await budget.host(() => follow ? fs.stat(path, { signal: budget.signal }) : fs.lstat(path, { signal: budget.signal }));
  } catch (error) {
    budget.signal.throwIfAborted();
    if (!(error instanceof FsError) || error.code !== "ENOENT") throw error;
    return `cannot open \`${await budget.escapeName(name)}' (No such file or directory)`;
  }
  if (stat.type === "directory") return { description: "directory", mime: "inode/directory", encoding: "binary" };
  if (stat.type === "character") return { description: "character special", mime: "inode/chardevice", encoding: "binary" };
  if (stat.type === "symlink") {
    if (follow) throw new FsError("ENOTSUP", { path, message: "followed stat returned a symbolic link" });
    const target = fs.readlink ? await budget.host(() => fs.readlink!(path, { signal: budget.signal })) : undefined;
    const rendered = target === undefined ? undefined : await budget.escapeName(target, true, describe);
    return { description: rendered === undefined || !describe ? "symbolic link" : `symbolic link to ${rendered}`, mime: "inode/symlink", encoding: "binary" };
  }
  if (stat.type !== "file") throw new FsError("ENOTSUP", { path, message: "unsupported filesystem entry type" });
  let sample: { bytes: Uint8Array; complete: boolean };
  const capabilities = fs.capabilitiesFor
    ? await budget.host(() => fs.capabilitiesFor!(path, { signal: budget.signal }))
    : fs.capabilities;
  if (fs.readStream && capabilities.streamingRead !== false) {
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
      const args = await parse(context, budget);
      if (args.action) {
        writing = true;
        await budget.output(context.stdout, args.action === "help" ? help : `file (${profile})\n`);
        return { exitCode: 0 };
      }
      let failed = false;
      let stdinUsed = args.stdinUsed;
      for (const { name, format } of [...args.listed, ...args.names.map(name => ({ name, format: args }))]) {
        await budget.step();
        let detected: Classification | string;
        try { detected = await inspect(context, name, format.follow, !format.mimeType && !format.mimeEncoding, budget, stdinUsed); }
        catch (error) {
          budget.signal.throwIfAborted();
          if (!(error instanceof FsError)) throw error;
          failed = true;
          const label = await budget.escapeName(name);
          const message = await budget.escapeName(error.message, true);
          writing = true;
          await budget.output(context.stderr, `file: ${label}: ${message}\n`);
          writing = false;
          continue;
        } finally { if (name === "-") stdinUsed = true; }
        const content = typeof detected === "string" ? detected : format.mimeType && format.mimeEncoding ? `${detected.mime}; charset=${detected.encoding}`
          : format.mimeType ? detected.mime : format.mimeEncoding ? detected.encoding : detected.description;
        const label = format.brief || !name ? "" : `${name === "-" ? "/dev/stdin" : await budget.escapeName(name)}${format.print0 ? "\0" : ""}${format.print0 >= 2 ? "" : `${format.separator} `}`;
        writing = true;
        await budget.output(context.stdout, `${label}${content}${format.print0 >= 2 ? "\0" : "\n"}`);
        writing = false;
      }
      return { exitCode: failed ? 1 : 0 };
    } catch (error) {
      context.signal.throwIfAborted();
      budget.signal.throwIfAborted();
      if (writing && !(error instanceof FileLimitError)) throw error;
      if (!(error instanceof FileFailure) && !(error instanceof FsError)) throw error;
      let limited = error instanceof FileLimitError;
      let message: string;
      if (error instanceof FileLimitError) message = limitMessage(error);
      else {
        try { message = await budget.escapeName(error.message, true); }
        catch (failure) {
          budget.signal.throwIfAborted();
          if (!(failure instanceof FileLimitError)) throw failure;
          limited = true;
          message = limitMessage(failure);
        }
      }
      if (!limited) {
        try { await budget.output(context.stderr, `file: ${message}\n`); return { exitCode: error instanceof FsError ? 1 : 2 }; }
        catch (failure) {
          budget.signal.throwIfAborted();
          if (!(failure instanceof FileLimitError)) throw failure;
          message = limitMessage(failure);
        }
      }
      await budget.failure(`file: ${message}\n`);
      return { exitCode: 1 };
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
