import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { readBytes, writeBytes, type ByteSource } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { shellValueByteLength } from 'safe-bash-contracts/value';
import { parseFoldArguments } from './arguments.js';
import { FoldError, type FoldLimits, type FoldOptions } from './contracts.js';
import { createFoldEngine, type FoldAccounting, type FoldEngine } from './engine.js';
import type { FoldLocale } from './column.js';

const byteView = Object.getPrototypeOf(Uint8Array.prototype) as object;
const byteExtent = Object.getOwnPropertyDescriptor(byteView, 'byteLength')!.get!;
const byteKind = Object.getOwnPropertyDescriptor(byteView, Symbol.toStringTag)!.get!;
const byteBuffer = Object.getOwnPropertyDescriptor(byteView, 'buffer')!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(byteView, 'byteOffset')!.get!;

export interface FoldCommandOptions {
  readonly locale?: FoldLocale;
  readonly limits?: Partial<FoldLimits>;
  readonly replace?: boolean;
}
export type FoldRunOptions = Partial<FoldOptions> & FoldCommandOptions;
export interface FoldResult {
  readonly exitCode: 0 | 1;
  readonly filesRead: number;
  readonly filesFailed: number;
  readonly accounting: Readonly<FoldAccounting>;
}
const defaultLimits: FoldLimits = Object.freeze({ inputBytes: 16_777_216, outputBytes: 33_554_432, retainedBytes: 1_048_576, work: 268_435_456, argumentBytes: 65_536 });

async function executeFold(context: CommandContext, configuration: FoldCommandOptions, invocation?: FoldOptions): Promise<FoldResult> {
  const limits = { ...defaultLimits, ...configuration.limits };
  const locale = configuration.locale ?? 'UTF-8/Unicode-17.0.0';
  const controller = new AbortController();
  const signal = controller.signal;
  const abort = (): void => controller.abort(context.signal.reason);
  let engine: FoldEngine | undefined, stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let task: Promise<FoldResult | undefined> = Promise.resolve(undefined);
  let closing: Promise<void> | undefined;
  let accepting = true;
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    accepting = false;
    let resolve!: () => void;
    let reject!: (reason: unknown) => void;
    // Abort listeners may reenter cleanup synchronously. Publish its shared
    // completion first, while still cancelling admitted I/O immediately.
    closing = new Promise<void>((complete, fail) => { resolve = complete; reject = fail; });
    controller.abort(new FoldError('CLOSED', 'Fold invocation closed'));
    void (async () => {
      // The task owns its iterator and returns it before settling. A direct host
      // may call cleanup while input/output is still in flight.
      await Promise.allSettled([task]);
      engine?.dispose();
      context.signal.removeEventListener('abort', abort);
      const results = await Promise.allSettled([stdout?.close(), stderr?.close()]);
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Fold output cleanup failed');
    })().then(resolve, reject);
    return closing;
  };
  context.registerCleanup?.(cleanup);
  // Admit and own SDK operands before yielding to the caller. Deferred task
  // setup must not leave literal paths borrowed from a mutable options array.
  let sdkOptions: FoldOptions | undefined;
  let sdkExtent = 3;
  let sdkFailure: { readonly error: unknown } | undefined;
  if (invocation) {
    try {
      const args = ['--'];
      for (const file of invocation.files) {
        signal.throwIfAborted();
        // UTF-16 length is a constant-time lower bound for UTF-8 bytes. Reject
        // impossible operands before the byte-length helper scans their text.
        const minimum = sdkExtent + file.length + 1;
        if (minimum > limits.argumentBytes) throw new FoldError('LIMIT', 'Argument byte limit exceeded');
        if (minimum * 3 > limits.retainedBytes - 8196) throw new FoldError('LIMIT', 'Invocation retention limit exceeded');
        if (minimum * 4 > limits.work) throw new FoldError('LIMIT', 'Invocation work limit exceeded');
        sdkExtent += shellValueByteLength(file) + 1;
        if (sdkExtent > limits.argumentBytes) throw new FoldError('LIMIT', 'Argument byte limit exceeded');
        if (sdkExtent * 3 > limits.retainedBytes - 8196) throw new FoldError('LIMIT', 'Invocation retention limit exceeded');
        if (sdkExtent * 4 > limits.work) throw new FoldError('LIMIT', 'Invocation work limit exceeded');
        args.push(file);
      }
      sdkOptions = { ...invocation, files: parseFoldArguments(args, limits).files };
    } catch (error) { sdkFailure = { error }; }
  }
  task = Promise.resolve().then(async () => {
    if (!accepting) throw new FoldError('CLOSED', 'Fold invocation closed');
    context.signal.addEventListener('abort', abort, { once: true });
    if (context.signal.aborted) abort();
    signal.throwIfAborted();
    const scope = { signal, ...(context.registerCleanup ? { registerCleanup: context.registerCleanup.bind(context) } : {}) };
    stdout = createOutputOperation(scope, context.stdout);
    stderr = createOutputOperation(scope, context.stderr);
    let diagnostics = 0, filesRead = 0, filesFailed = 0, overheadWork = 0, peakRetained = 8196, argumentRetention = 0;
    const chargeWork = (amount: number): void => {
      if (amount > limits.work - overheadWork - (engine?.accounting().work ?? 0)) throw new FoldError('LIMIT', 'Invocation work limit exceeded');
      overheadWork += amount;
    };
    const retain = (amount: number): void => {
      if (amount > limits.retainedBytes - 8196 - argumentRetention) throw new FoldError('LIMIT', 'Invocation retention limit exceeded');
      peakRetained = Math.max(peakRetained, 8196 + argumentRetention + amount);
    };
    const accounting = (): Readonly<FoldAccounting> => Object.freeze({
      ...(engine?.accounting() ?? { inputBytes: 0, decodedBytes: 0, retainedBytes: 0, peakRetainedBytes: 0, outputBytes: 0, work: 0 }),
      outputBytes: (engine?.accounting().outputBytes ?? 0) + diagnostics,
      work: (engine?.accounting().work ?? 0) + overheadWork,
      peakRetainedBytes: peakRetained,
    });
    const diagnostic = async (message: string): Promise<void> => {
      signal.throwIfAborted();
      retain(message.length * 3);
      chargeWork(message.length * 4);
      // Supply realm-local storage to borrowed host encoders. Its conservative
      // UTF-8 extent has already been admitted by retain above.
      const storage = new Uint8Array(message.length * 3);
      const { written } = new TextEncoder().encodeInto(message, storage);
      const bytes = storage.subarray(0, written);
      if (bytes.length > limits.outputBytes - diagnostics - (engine?.accounting().outputBytes ?? 0)) throw new FoldError('LIMIT', 'Output byte limit exceeded');
      diagnostics += bytes.length;
      await writeBytes(stderr!.output, bytes, signal);
    };
    let options: FoldOptions;
    try {
      if (invocation) {
        if (sdkFailure) throw sdkFailure.error;
        retain(sdkExtent * 3); chargeWork(sdkExtent * 4);
        argumentRetention = sdkExtent * 3;
        options = sdkOptions!;
      } else {
        const carrier = getCommandArguments(context);
        let extent = 0;
        for (let index = 0; index < carrier.values.length; index++) {
          signal.throwIfAborted();
          const value = carrier.values[index]!;
          if (typeof value === 'string') {
            if (value.length + 1 > limits.argumentBytes - extent) throw new FoldError('LIMIT', 'Argument byte limit exceeded');
            retain(value.length * 3);
            if ((value.length + 1) * 4 > limits.work - overheadWork) throw new FoldError('LIMIT', 'Invocation work limit exceeded');
          }
          const length = shellValueByteLength(value);
          extent += length + 1;
          if (extent > limits.argumentBytes || length > limits.retainedBytes - 8196) throw new FoldError('LIMIT', 'Argument byte limit exceeded');
          // VFS paths are Unicode strings: refuse lossy byte argv explicitly.
          retain(length * 3); chargeWork((length + 1) * 4);
          const bytes = carrier.bytes(index)!;
          try { new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
          catch { throw new FoldError('OPTION', 'Only UTF-8 VFS arguments are available'); }
        }
        retain(extent * 3);
        argumentRetention = extent * 3;
        options = parseFoldArguments(context.args, limits);
      }
      for (const file of options.files) if (file.includes('\0')) throw new FoldError('OPTION', 'NUL is unavailable in VFS paths');
      engine = createFoldEngine(options, locale, { ...limits, work: limits.work - overheadWork }, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof FoldError)) throw error;
      await diagnostic(`fold: ${error.message}\n`);
      return { exitCode: 1, filesRead, filesFailed, accounting: accounting() };
    }
    const deliver = async (chunks: readonly Uint8Array[]): Promise<void> => {
      chargeWork(0);
      if (engine!.accounting().outputBytes > limits.outputBytes - diagnostics) throw new FoldError('LIMIT', 'Output byte limit exceeded');
      for (const bytes of chunks) await writeBytes(stdout!.output, bytes, signal);
    };
    const fileError = async (file: string, error: unknown): Promise<void> => {
      signal.throwIfAborted();
      if (!(error instanceof FsError)) throw error;
      filesFailed++;
      const messages: Partial<Record<FsError['code'], string>> = { ENOENT: 'No such file or directory', EACCES: 'Permission denied', EISDIR: 'Is a directory', ENOTDIR: 'Not a directory' };
      await diagnostic(`fold: '${file}': ${messages[error.code] ?? error.code}\n`);
    };
    for (const file of options.files.length ? options.files : ['-']) {
      signal.throwIfAborted();
      let source: ByteSource;
      let ownedInput = 0;
      try {
        if (file === '-') source = context.stdin;
        else {
          const path = file.startsWith('/') ? file : `${context.cwd}/${file}`;
          if (context.fs.readStream) source = context.fs.readStream(path, { signal });
          else {
            const maxBytes = Math.min(limits.inputBytes - engine.accounting().inputBytes, limits.retainedBytes - 8196 - argumentRetention);
            const bytes = await context.fs.readFile(path, { signal, maxBytes });
            signal.throwIfAborted();
            if (byteKind.call(bytes) !== 'Uint8Array') throw new FoldError('INPUT', 'Input must be byte storage');
            const length = byteExtent.call(bytes) as number;
            if (length > maxBytes) throw new FoldError('LIMIT', 'VFS input retention limit exceeded');
            ownedInput = length; retain(ownedInput);
            source = (async function* () { yield bytes; })();
          }
        }
      } catch (error) { await fileError(file, error); continue; }
      let producer: AsyncIterator<Uint8Array>;
      try { producer = source[Symbol.asyncIterator](); }
      catch (error) { await fileError(file, error); continue; }
      let inputClosing: Promise<IteratorResult<Uint8Array>> | undefined;
      const closeInput = (): Promise<IteratorResult<Uint8Array>> => inputClosing ??= Promise.resolve().then(() =>
        producer.return ? producer.return() : { done: true, value: undefined });
      const iterator = readBytes({ [Symbol.asyncIterator]() {
        return { async next() {
          const result = await producer.next();
          signal.throwIfAborted();
          if (result.done) return result;
          const bytes = result.value;
          if (byteKind.call(bytes) !== 'Uint8Array') throw new FoldError('INPUT', 'Input must be byte storage');
          // The shared reader checks realm-local Uint8Array identity. Rehome
          // the view, without copying/advancing or consulting producer properties.
          // Bounded engine calls still consume the storage before producer reuse.
          let view: Uint8Array;
          try { view = new Uint8Array(byteBuffer.call(bytes) as ArrayBuffer, byteOffset.call(bytes) as number, byteExtent.call(bytes) as number); }
          catch { throw new FoldError('INPUT', 'Input byte storage is unavailable'); }
          return { done: false as const, value: view };
        }, return: closeInput };
      } }, signal)[Symbol.asyncIterator]();
      let complete = false;
      let escaping = false, inputFailed = false;
      try {
        for (;;) {
          signal.throwIfAborted();
          let next: IteratorResult<Uint8Array>;
          try { chargeWork(1); next = await iterator.next(); }
          catch (error) { inputFailed = true; await fileError(file, error); break; }
          if (next.done) { complete = true; filesRead++; break; }
          // Consume/copy every producer byte before requesting its next chunk.
          if (byteKind.call(next.value) !== 'Uint8Array') throw new FoldError('INPUT', 'Input must be byte storage');
          const length = byteExtent.call(next.value) as number;
          if (!length) await deliver(engine.push(next.value));
          for (let offset = 0; offset < length; offset += 4096) {
            signal.throwIfAborted();
            // Intrinsic subarray still invokes producer-controlled species.
            // A direct view reads the original storage without that callback.
            const unit = new Uint8Array(byteBuffer.call(next.value) as ArrayBuffer, (byteOffset.call(next.value) as number) + offset, Math.min(4096, length - offset));
            context.inputBudget?.check(engine.accounting().inputBytes + unit.byteLength);
            retain(ownedInput + engine.accounting().retainedBytes + unit.byteLength * 2 + 4);
            await deliver(engine.push(unit));
          }
        }
        retain(ownedInput + engine.accounting().retainedBytes + 4);
        await deliver(engine.endFile());
      } catch (error) { escaping = true; throw error; }
      finally {
        if (!complete) {
          // readBytes schedules return without waiting after cancellation. Own
          // the same close promise and drain it before invocation cleanup ends.
          const results = await Promise.allSettled([iterator.return(undefined), closeInput()]);
          const failure = results.find(result => result.status === 'rejected');
          if (failure?.status === 'rejected' && !escaping && !inputFailed) await fileError(file, failure.reason);
        }
      }
    }
    return { exitCode: filesFailed ? 1 : 0, filesRead, filesFailed, accounting: accounting() };
  });
  try { return (await task)!; }
  finally {
    try { await cleanup(); }
    finally { context.signal.throwIfAborted(); }
  }
}

/** Stream SDK input and literal VFS operands using the same invocation as CLI. */
export function fold(context: CommandContext, options: FoldRunOptions = {}): Promise<FoldResult> {
  const invocation: FoldOptions = { width: options.width ?? 80, mode: options.mode ?? 'columns', spaces: options.spaces ?? false, files: options.files ?? [] };
  return executeFold(context, options, invocation);
}
export function createFoldCommand(options: FoldCommandOptions = {}): CommandDefinition {
  const configuration = Object.freeze({ ...options, limits: Object.freeze({ ...options.limits }) });
  return Object.freeze({ name: 'fold', runtimeIdentity: commandRuntimeIdentity, description: 'Wrap byte streams using an explicit locale profile', execute(context: CommandContext) { return executeFold(context, configuration); } });
}
export const foldCommand = createFoldCommand();
export function foldCommands(options: FoldCommandOptions = {}): VirtualShellPlugin {
  const command = createFoldCommand(options);
  const replace = options.replace ?? false;
  return { name: 'fold', setup(host) { host.commands.register(command, { replace }); } };
}
