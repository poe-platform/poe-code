import { commandRuntimeIdentity, CommandArgumentIdentityError, FsError, getCommandArguments, isFsError, readBytes, writeBytes, shellValueByteLength, type ByteSource, type CommandContext, type CommandDefinition, type FileSystemCapabilities } from 'safe-bash-contracts';
import { isAbsolutePath, validatePath } from '@poe-code/safe-fs/core';
import { assertCommandRequirements } from 'safe-bash-contracts/command-requirements';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import { FmtError, defaultFmtLimits, validateFmtLimits, type FmtLimits, type FmtProfile } from './contracts.js';
import { parseFmtArguments } from './arguments.js';
import { createFmtEngine, type FmtEngine } from './engine.js';
import { byteSpan, byteView } from './bytes.js';
import { captureFmtArguments, type FmtFormattingOptions } from './sdk.js';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { quote, unicodeLocale } from './quoting.js';

export interface FmtCommandOptions { readonly limits?: Partial<FmtLimits>; readonly profile?: FmtProfile }
export interface FmtRunOptions extends FmtCommandOptions, FmtFormattingOptions { readonly arguments?: readonly Uint8Array[] }
export interface FmtResult { readonly exitCode: number }
export interface FmtPluginOptions extends FmtCommandOptions { readonly replace?: boolean }
const inputRequirements = [
  { id: 'stdin', description: 'Read standard input', capabilities: [] },
  { id: 'file', description: 'Read file operands', capabilities: [], anyOf: [['streamingRead'], ['read']] },
] as const;
async function yieldTurn(signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>(resolve => setTimeout(resolve, 0));
  signal.throwIfAborted();
}
async function output(context: CommandContext, bytes: string | Uint8Array): Promise<void> {
  await writeBytes(context.stdout, typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes, context.signal);
}
async function diagnostic(context: CommandContext, error: unknown): Promise<void> {
  let message = 'internal error';
  if (error instanceof FmtError || error instanceof FsError || error instanceof CommandArgumentIdentityError) message = error.message;
  else {
    try { const pending = context.onInternalError?.(error); if (pending !== undefined) void Promise.resolve(pending).catch(() => undefined); } catch { /* Diagnostic delivery still proceeds. */ }
  }
  let escaped = '';
  for (const character of message) {
    const point = character.codePointAt(0)!;
    if (point === 9 || point === 10 || point >= 32 && (point < 127 || point > 159)) escaped += character;
    else for (const byte of new TextEncoder().encode(character)) escaped += `\\${byte.toString(8).padStart(3, '0')}`;
  }
  await writeBytes(context.stderr, new TextEncoder().encode(`fmt: ${escaped}\n`), context.signal);
}
function pathOf(context: Pick<CommandContext, 'cwd'>, path: string): string {
  if (!path) throw new FsError('ENOENT', { path });
  validatePath(path); validatePath(context.cwd);
  if (!isAbsolutePath(context.cwd)) throw new FsError('EINVAL', { path: context.cwd, message: 'cwd must be absolute' });
  return isAbsolutePath(path) ? path : `${context.cwd.endsWith('/') ? context.cwd.slice(0, -1) : context.cwd}/${path}`;
}
class InputBudget {
  private used = 0;
  constructor(readonly maximum: number, private sourceBufferBytes: number) {}
  get maxReadBytes(): number { return Math.max(0, Math.min(this.sourceBufferBytes, this.maximum - this.used)); }
  async *read(source: ByteSource, signal: AbortSignal): ByteSource {
    for await (const chunk of readBytes(source, signal)) {
      signal.throwIfAborted();
      const size = byteView(chunk).length;
      if (size > this.maximum - this.used) throw new FsError('EFBIG', { message: 'byte command input limit exceeded' });
      if (size > this.maxReadBytes) throw new FmtError('LIMIT', 'source chunk retention limit exceeded');
      this.used += size;
      if (!size) yield byteSpan(chunk, 0, 0);
      for (let offset = 0; offset < size; offset += 4096) yield byteSpan(chunk, offset, Math.min(4096, size - offset));
    }
  }
}

class InputScope {
  private iterator: AsyncIterator<Uint8Array> | undefined;
  private reader: AsyncIterator<Uint8Array> | undefined;
  private finished = false;
  private retirement: Promise<void> | undefined;
  private closing: Promise<void> | undefined;
  private acquisition: Promise<void> | undefined;

  constructor(private context: CommandContext, private budget: InputBudget) {}

  open(name: string, bytes: Uint8Array): Promise<void> {
    if (this.closing) throw new FmtError('CLOSED', 'fmt input is closed');
    const { context } = this;
    context.signal.throwIfAborted();
    // Metadata owns no stream. After it settles, the signal check closes
    // resource admission before any iterator can be acquired.
    this.acquisition = Promise.resolve().then(async () => {
      context.signal.throwIfAborted();
      let file: { path: string; capabilities: FileSystemCapabilities } | undefined;
      if (name !== "-") {
        const encoded = new TextEncoder().encode(name);
        if (encoded.length !== bytes.length || encoded.some((byte, index) => byte !== bytes[index])) throw new FsError("ENOENT", { path: name });
        const path = pathOf(context, name);
        const capabilities = await context.fs.capabilitiesFor?.(path, { signal: context.signal }) ?? context.fs.capabilities;
        context.signal.throwIfAborted();
        file = { path, capabilities };
      }
      context.signal.throwIfAborted();
      let source: ByteSource = context.stdin;
      if (file) {
        const { path, capabilities } = file;
        assertCommandRequirements(context, inputRequirements, ["file"], capabilities);
        if (context.fs.readStream && capabilities.streamingRead !== false) source = context.fs.readStream(path, { signal: context.signal, chunkSize: 4096 });
        else {
          if (capabilities.read === false) throw new FsError("ENOTSUP", { path, syscall: "readFile" });
          const maximum = this.budget.maxReadBytes;
          source = { async *[Symbol.asyncIterator]() { yield await context.fs.readFile(path, { signal: context.signal, maxBytes: maximum }); } };
        }
      }
      context.signal.throwIfAborted();
      this.iterator = source[Symbol.asyncIterator]();
      this.reader = this.budget.read({ [Symbol.asyncIterator]: () => ({
        next: async () => {
          const item = await this.iterator!.next();
          if (item.done) this.finished = true;
          return item;
        },
        return: async () => { await this.retire(); return { done: true, value: undefined }; },
      }) }, context.signal)[Symbol.asyncIterator]();
    });
    return this.acquisition;
  }

  async next(): Promise<Uint8Array | null> {
    const item = await this.reader!.next();
    // The engine takes its owned copy before the next source pull. A second
    // fragment copy would inflate the source-buffer retention allowance.
    return item.done ? null : item.value;
  }

  private retire(): Promise<void> {
    this.retirement ??= Promise.resolve().then(async () => { if (!this.finished) await this.iterator?.return?.(); });
    return this.retirement;
  }

  close(): Promise<void> {
    this.closing ??= (async () => {
      const results = await Promise.allSettled([this.retire(), this.reader?.return?.()]);
      for (const result of results) if (result.status === "rejected") throw result.reason;
    })();
    return this.closing;
  }
}

function fileError(error: unknown, name: string, bytes: Uint8Array, opening: boolean, context: CommandContext, releasedRead = false): unknown {
  if (!(error instanceof FsError)) return error;
  const messages: Readonly<Record<string, string>> = { ENOENT: "No such file or directory", EACCES: "Permission denied", EISDIR: "Is a directory", ENOTDIR: "Not a directory", ELOOP: "Too many levels of symbolic links", EIO: "Input/output error", EBADF: "Bad file descriptor" };
  const message = messages[error.code];
  if (!message) return error;
  if (releasedRead && !opening) return new FmtError('INPUT', `${name === '-' ? 'read error' : `error reading ${quote(bytes, true, unicodeLocale(context))}`}: ${message}`);
  return new FmtError("INPUT", `${opening ? `cannot open ${quote(bytes, true, unicodeLocale(context))} for reading` : name === "-" ? "standard input" : name}: ${message}`);
}

export function fmtCommand(configuration: FmtCommandOptions = {}): CommandDefinition {
  return { name: "fmt", runtimeIdentity: commandRuntimeIdentity, filesystemRequirements: inputRequirements, execute: context => fmt(context, configuration) };
}

export function fmtCommands(configuration: FmtPluginOptions = {}): VirtualShellPlugin {
  const command = fmtCommand(configuration);
  const replace = configuration.replace ?? false;
  return { name: 'fmt', setup(host) { host.commands.register(command, { replace }); } };
}

export async function fmt(context: CommandContext, configuration: FmtRunOptions = {}): Promise<FmtResult> {
    context.signal.throwIfAborted();
    const controller = new AbortController();
    const local = { ...context, signal: AbortSignal.any([context.signal, controller.signal]) };
    const limits: FmtLimits = { ...defaultFmtLimits, ...configuration.limits };
    let sdkArguments: readonly Uint8Array[] | undefined;
    let argumentFailure: { error: unknown } | undefined;
    let activeEngine: FmtEngine | undefined;
    let stdout: OutputOperation | undefined;
    let current: InputScope | undefined;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      let resolve!: () => void, reject!: (reason: unknown) => void;
      closing = new Promise<void>((complete, fail) => { resolve = complete; reject = fail; });
      controller.abort(new FsError("EPIPE", { message: "fmt input closed" }));
      activeEngine?.dispose();
      void Promise.allSettled([current?.close(), stdout?.close()]).then(results => {
        const failures = results.filter(result => result.status === "rejected").map(result => result.reason);
        if (failures.length) reject(failures.length === 1 ? failures[0] : new AggregateError(failures, "fmt cleanup failed"));
        else resolve();
      });
      return closing;
    };
    context.registerCleanup?.(close);
    // Capture SDK argv before the first await; never borrow mutable caller bytes.
    try {
      validateFmtLimits(limits);
      sdkArguments = captureFmtArguments(configuration, limits);
    } catch (error) { argumentFailure = { error }; }
    let failed = false;
    const run = async () => {
      try {
        if (argumentFailure) throw argumentFailure.error;
        const argumentsWithBytes = getCommandArguments(context);
        let extent = 0;
        if (argumentsWithBytes.values.length > 4096) throw new FmtError('LIMIT', 'argument count limit exceeded');
        const bytes = sdkArguments ?? argumentsWithBytes.values.map((value, index) => {
          if (typeof value === 'string' && value.length > limits.argumentBytes - extent) throw new FmtError('LIMIT', 'argument limit exceeded');
          const size = shellValueByteLength(value);
          if (size > limits.argumentBytes - extent) throw new FmtError('LIMIT', 'argument limit exceeded');
          extent += size;
          return argumentsWithBytes.bytes(index)!;
        });
        const settings = parseFmtArguments(bytes, { limits, ...(configuration.profile !== undefined ? { profile: configuration.profile } : {}), posixlyCorrect: context.env.POSIXLY_CORRECT !== undefined, unicodeQuotes: unicodeLocale(context) });
        if (settings.information) {
          await output(context, settings.information === "version" ? "fmt (virtual-bash)\n" : "Usage: fmt [-WIDTH] [OPTION]... [FILE]...\nReformat paragraphs; omitted FILE or '-' reads standard input.\n  -c, --crown-margin       preserve indentation of first two lines\n  -t, --tagged-paragraph   use distinct first and following margins\n  -p, --prefix=STRING      format only lines with this prefix\n  -s, --split-only         split lines without joining\n  -u, --uniform-spacing    one space between words, two after sentences\n  -w, --width=WIDTH        maximum width (default 75)\n  -g, --goal=WIDTH         preferred width (default 93% of width)\n      --help              display this help\n      --version           display virtual command identity\n");
          return { exitCode: 0 };
        }
        const budget = new InputBudget(limits.inputBytes, limits.retainedBytes - 10120 - settings.prefix.length);
        let work = 0, outputBytes = 0;
        stdout = createOutputOperation({ signal: local.signal }, context.stdout);
        const outputContext = { ...context, stdout: stdout.output };
        let stdinDone = false;
        let emptyChunks = 0;
        let chunks = 0;
        let exitCode = 0;
        for (const { name, bytes: nameBytes } of settings.files) {
          local.signal.throwIfAborted();
          if (name === "-" && stdinDone) continue;
          current = new InputScope(local, budget);
          try { await current.open(name, nameBytes); }
          catch (error) {
            local.signal.throwIfAborted();
            await diagnostic(context, fileError(error, name, nameBytes, true, context));
            await current.close();
            exitCode = 1;
            continue;
          }
          activeEngine = createFmtEngine(settings, { ...limits, inputBytes: limits.inputBytes, work: limits.work - work, outputBytes: limits.outputBytes - outputBytes }, local.signal);
          const machine = activeEngine.run();
          let step = machine.next();
          let readFailed = false;
          let readError: unknown;
          let received = false;
          while (!step.done) {
            local.signal.throwIfAborted();
            if (step.value === "input") {
              let bytes: Uint8Array | null = null;
              if (!readFailed) {
                try { bytes = await current.next(); if (bytes?.length) received = true; }
                catch (error) {
                  local.signal.throwIfAborted();
                  if (isFsError(error, "EFBIG")) throw new FmtError("LIMIT", "byte command input limit exceeded");
                  readFailed = true;
                  readError = !received && name !== "-" && error instanceof FsError && ["ENOENT", "EACCES", "ENOTDIR", "ELOOP"].includes(error.code) ? fileError(error, name, nameBytes, true, context) : error;
                }
              }
              if (bytes?.length === 0 && ++emptyChunks > 4096) throw new FmtError("LIMIT", "empty input chunk limit exceeded");
              if (++chunks % 64 === 0) await yieldTurn(local.signal);
              step = machine.next(bytes);
            } else {
              if (step.value) await output(outputContext, step.value);
              else await yieldTurn(local.signal);
              step = machine.next();
            }
          }
          try { await current.close(); }
          catch (error) { if (!readFailed) throw error; }
          current = undefined;
          work += activeEngine.accounting().work;
          outputBytes += activeEngine.accounting().outputBytes;
          activeEngine.dispose(); activeEngine = undefined;
          if (name === "-") stdinDone = true;
          if (readFailed && (settings.profile !== 'gnu-coreutils-8.30-C-bytes' || !isFsError(readError, "EISDIR") && !isFsError(readError, "EIO") && !isFsError(readError, "EBADF"))) { await diagnostic(context, fileError(readError, name, nameBytes, false, context, settings.profile !== 'gnu-coreutils-8.30-C-bytes')); exitCode = 1; }
        }
        return { exitCode };
      } catch (error) {
        failed = true;
        context.signal.throwIfAborted();
        if (error instanceof FmtError && error.usage) await writeBytes(context.stderr, Uint8Array.from(`fmt: ${error.message}\nTry 'fmt --help' for more information.\n`, character => character.charCodeAt(0)), context.signal);
        else await diagnostic(context, error);
        return { exitCode: 1 };
      }
    };
    let outcome: { result: { exitCode: number } } | { error: unknown };
    try { outcome = { result: await run() }; }
    catch (error) { outcome = { error }; }
    try { await close(); }
    catch (error) { if (!failed) throw error; }
    if ("error" in outcome) throw outcome.error;
    return outcome.result;
}
