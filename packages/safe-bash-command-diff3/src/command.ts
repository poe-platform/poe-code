import { resolvePath } from 'safe-bash-contracts';
import type { IndexedDocument } from 'safe-bash-diff-engine/document';
import { Budget as ReadBudget, inspect, ToolError } from 'safe-bash-diff-engine/shared';
import { StoredWork } from './stored.js';
import { compareStoredDiff3 } from './stored-behavior.js';
import { yieldTurn } from "safe-bash-contracts/yield";
import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { readBytes, writeBytes, type ByteSource } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { shellValueByteLength } from 'safe-bash-contracts/value';
import { Diff3Error } from './contracts.js';
import { byteView } from './bytes.js';
import { diff3DefaultLimits, parseDiff3Arguments, validateDiff3Invocation, type Diff3BehaviorLimits, type Diff3Invocation } from './behavior.js';

export interface Diff3CommandOptions { readonly limits?: Partial<Diff3BehaviorLimits>; readonly replace?: boolean }
export type Diff3RunOptions = Diff3Invocation & Diff3CommandOptions;
export interface Diff3CommandResult {
  readonly exitCode: 0 | 1 | 2;
  readonly error?: Diff3Error | FsError;
  readonly accounting: { readonly inputBytes: number; readonly decodedBytes: number; readonly outputBytes: number; readonly retainedBytes: number; readonly peakRetainedBytes: number; readonly graphCells: number; readonly peakGraphCells: number; readonly tokens: number; readonly work: number };
}
async function executeDiff3(context: CommandContext, configuration: Diff3CommandOptions, invocation?: Diff3Invocation): Promise<Diff3CommandResult> {
  context.signal.throwIfAborted();
  const limits = { ...diff3DefaultLimits, ...configuration.limits };
  const controller = new AbortController(), signal = controller.signal;
  const abort = (): void => controller.abort(context.signal.reason);
  let stdout: OutputOperation | undefined, stderr: OutputOperation | undefined;
  let task: Promise<Diff3CommandResult | undefined> = Promise.resolve(undefined);
  let closing: Promise<void> | undefined;
  let accepting = true;
  let inputBytes = 0, decodedBytes = 0, outputBytes = 0, retained = 0, metadataRetained = 0, peakRetained = 0, peakGraphCells = 0, work = 0;
  const inputs: IndexedDocument[] = [];
  let stored: StoredWork | undefined;
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    accepting = false;
    let resolve!: () => void, reject!: (reason: unknown) => void;
    closing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    controller.abort(new Diff3Error('CLOSED', 'Diff3 invocation closed'));
    void (async () => {
      await Promise.allSettled([task]);
      inputs.length = 0; retained = 0;
      context.signal.removeEventListener('abort', abort);
      const results = await Promise.allSettled([stdout?.close(), stderr?.close(), stored?.close()]);
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, 'Diff3 output cleanup failed');
    })().then(resolve, reject);
    return closing;
  };
  context.registerCleanup?.(cleanup);
  // Copy SDK metadata before the first await; later mutations do not change runs.
  let owned: Diff3Invocation | undefined, snapshotError: { error: unknown } | undefined;
  try { if (invocation) owned = validateDiff3Invocation(invocation, limits); }
  catch (error) { snapshotError = { error }; }
  const charge = (amount: number): void => {
    signal.throwIfAborted();
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > limits.work - work) throw new Diff3Error('LIMIT', 'Invocation work limit exceeded');
    work += amount;
  };
  const hold = (amount: number): void => {
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > limits.retainedBytes - retained) throw new Diff3Error('LIMIT', 'Invocation retention limit exceeded');
    retained += amount; peakRetained = Math.max(peakRetained, retained);
  };
  const result = (exitCode: 0 | 1 | 2): Diff3CommandResult => ({ exitCode, accounting: { inputBytes, decodedBytes, outputBytes, retainedBytes: 0, peakRetainedBytes: peakRetained, graphCells: 0, peakGraphCells: Math.max(peakGraphCells, stored?.peakGraphCells ?? 0), tokens: 0, work } });
  task = Promise.resolve().then(async () => {
    if (!accepting) throw new Diff3Error('CLOSED', 'Diff3 invocation closed');
    context.signal.addEventListener('abort', abort, { once: true }); if (context.signal.aborted) abort();
    signal.throwIfAborted();
    stdout = createOutputOperation({ signal }, context.stdout); stderr = createOutputOperation({ signal }, context.stderr);
    let publishing = false;
    try {
      if (snapshotError) throw snapshotError.error;
      let options: Diff3Invocation;
      if (owned) options = owned;
      else {
        const carrier = getCommandArguments(context);
        let size = 0;
        for (let i = 0; i < carrier.values.length; i++) {
          charge(1); const value = carrier.values[i]!;
          if (typeof value === 'string' && value.length > limits.argumentBytes - size) throw new Diff3Error('LIMIT', 'Argument byte limit exceeded');
          const length = shellValueByteLength(value); size += length + 1;
          if (size > limits.argumentBytes) throw new Diff3Error('LIMIT', 'Argument byte limit exceeded');
          hold(length * 3); charge(length * 4);
          if (length * 2 > limits.decodedBytes - decodedBytes) throw new Diff3Error('LIMIT', 'Decoded argument limit exceeded');
          try { decodedBytes += new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(carrier.bytes(i)!).length * 2; }
          catch { throw new Diff3Error('STATE', 'VFS arguments must be valid UTF-8'); }
          retained -= length * 3;
        }
        options = parseDiff3Arguments(context.args, limits);
      }
      for (const value of [...options.files, ...(options.labels ?? [])]) {
        decodedBytes += value.length * 2;
        if (decodedBytes > limits.decodedBytes) throw new Diff3Error('LIMIT', 'Decoded metadata limit exceeded');
        hold(value.length * 3 + 8); charge(value.length * 4 + 1);
        metadataRetained = retained;
      }
      const { registerCleanup: ignoredCleanup, ...storageContext } = context;
      stored = new StoredWork({ ...storageContext, signal }, limits, charge, hold);
      if (!options.information) for (const file of options.files) {
        await yieldTurn(signal);
        signal.throwIfAborted();
        signal.throwIfAborted();
        let source: ByteSource, borrowed = 0, acquiredInput: { bytes: Uint8Array | undefined } | undefined;
        if (file === '-') source = context.stdin;
        else {
          const path = resolvePath(context.cwd, file);
          const capabilities = await context.fs.capabilitiesFor?.(path, { signal }) ?? context.fs.capabilities;
          if (capabilities?.retainedRead && context.fs.openReadFile) {
            const reader = new ReadBudget({ ...context, signal }, {});
            const stat = await inspect(reader, path, 'follow');
            if (stat?.type === 'file') {
              if (stat.size > limits.inputBytes - inputBytes) throw new Diff3Error('LIMIT', 'Input byte limit exceeded');
              context.inputBudget?.check(inputBytes + stat.size);
              source = reader.diffSource(path);
            }
            else if (context.fs.readStream) source = context.fs.readStream(path, { signal });
            else throw new FsError(stat ? 'EISDIR' : 'ENOENT', { path });
          } else if (context.fs.readStream) source = context.fs.readStream(path, { signal });
          else {
            const maxBytes = Math.min(limits.inputBytes - inputBytes, limits.retainedBytes - retained);
            const resource = await stdout!.acquire(async readSignal => ({ bytes: await context.fs.readFile(path, { signal: readSignal, ...(Number.isFinite(maxBytes) ? { maxBytes } : {}) }) as Uint8Array | undefined }), resource => { resource.bytes = undefined; });
            acquiredInput = resource;
            signal.throwIfAborted();
            const bytes = byteView(resource.bytes!); borrowed = bytes.length; hold(borrowed);
            if (borrowed > maxBytes) throw new Diff3Error('LIMIT', 'VFS input byte limit exceeded');
            source = (async function* () { yield bytes; })();
          }
        }
        const producer = source[Symbol.asyncIterator]();
        let inputClosing: Promise<IteratorResult<Uint8Array>> | undefined;
        const closeInput = (): Promise<IteratorResult<Uint8Array>> => inputClosing ??= Promise.resolve().then(() => producer.return ? producer.return() : { done: true, value: undefined });
        const reader = readBytes({ [Symbol.asyncIterator]() { return {
          async next() { const next = await producer.next(); signal.throwIfAborted(); return next.done ? next : { done: false as const, value: byteView(next.value) }; }, return: closeInput
        }; } }, signal)[Symbol.asyncIterator]();
        let complete = false;
        let readFailure: { error: unknown } | undefined;
        try {
          inputs.push(await stored.load({ async *[Symbol.asyncIterator]() {
            for (;;) {
              charge(1); const next = await reader.next(); signal.throwIfAborted();
              if (next.done) { complete = true; break; }
              const bytes = next.value;
              if (bytes.length === 0) continue;
              if (bytes.length > limits.inputBytes - inputBytes) throw new Diff3Error('LIMIT', 'Input byte limit exceeded');
              context.inputBudget?.check(inputBytes + bytes.length);
              inputBytes += bytes.length; charge(bytes.length);
              // Ownership is transferred blockwise before asking the producer again.
              stored!.reserve();
              for (let offset = 0; offset < bytes.length; offset += 16384) yield new Uint8Array(bytes.subarray(offset, offset + 16384));
            }
          } }));
          retained -= borrowed;
          if (acquiredInput) acquiredInput.bytes = undefined;
        } catch (error) { readFailure = { error }; }
        if (!complete) {
          const results = await Promise.allSettled([reader.return(undefined), closeInput()]);
          const failures = results.filter(item => item.status === 'rejected').map(item => item.reason);
          if (failures.length) {
            if (readFailure) throw new AggregateError([readFailure.error, ...failures], 'Diff3 read and cleanup failed');
            throw new AggregateError(failures, 'Diff3 input cleanup failed');
          }
        }
        if (readFailure) throw readFailure.error;
      }
      charge(0);
      const rendered = await compareStoredDiff3(inputs, options, stored);
      peakGraphCells = Math.max(peakGraphCells, stored.peakGraphCells);
      outputBytes = rendered.outputBytes;
      publishing = true;
      for await (const bytes of rendered.stderr.bytes()) await writeBytes(stderr!.output, bytes, signal);
      for await (const bytes of rendered.stdout.bytes()) await writeBytes(stdout!.output, bytes, signal);
      return result(rendered.exitCode);
    } catch (caught) {
      const error = caught instanceof ToolError ? new Diff3Error('STATE', 'VFS input validation failed') : caught;
      signal.throwIfAborted();
      if (publishing) throw error;
      if (!(error instanceof Diff3Error) && !(error instanceof FsError)) throw error;
      await stdout!.close(); // Release acquired fallback payloads before diagnostics.
      peakGraphCells = Math.max(peakGraphCells, stored?.peakGraphCells ?? 0);
      await stored?.close();
      inputs.length = 0; retained = metadataRetained;
      const code = Object.getOwnPropertyDescriptor(error, 'code')?.value as unknown;
      const message = Object.getOwnPropertyDescriptor(error, 'message')?.value as unknown;
      const detail = error instanceof FsError ? 'VFS read failed' : code === 'LIMIT' ? 'resource limit exceeded' : typeof message === 'string' && message.length <= 1024 ? message : 'Command failed';
      if (detail.length * 2 > limits.work - work) return { ...result(2), error };
      charge(detail.length * 2);
      let size = 8; // ASCII prefix and final LF.
      for (let i = 0; i < detail.length; i++) { const char = detail.charCodeAt(i); size += char >= 32 && char <= 126 ? 1 : 6; }
      if (size > limits.retainedBytes - retained || size > limits.outputBytes - outputBytes || size + detail.length > limits.work - work) return { ...result(2), error };
      hold(size); charge(size + detail.length);
      const bytes = new Uint8Array(size), hex = '0123456789abcdef';
      let index = 0;
      for (const char of 'diff3: ') bytes[index++] = char.charCodeAt(0);
      for (let i = 0; i < detail.length; i++) {
        const char = detail.charCodeAt(i);
        if (char >= 32 && char <= 126) bytes[index++] = char;
        else {
          bytes[index++] = 92; bytes[index++] = 117;
          for (const shift of [12, 8, 4, 0]) bytes[index++] = hex.charCodeAt((char >>> shift) & 15);
        }
      }
      bytes[index] = 10; outputBytes += bytes.length;
      await writeBytes(stderr!.output, bytes, signal);
      return { ...result(2), error };
    }
  });
  try { return (await task)!; }
  finally { try { await cleanup(); } finally { context.signal.throwIfAborted(); } }
}
export function diff3(context: CommandContext, options: Diff3RunOptions): Promise<Diff3CommandResult> {
  return executeDiff3(context, { limits: { ...options.limits } }, options);
}
export function createDiff3Command(options: Diff3CommandOptions = {}): CommandDefinition {
  const configuration = Object.freeze({ limits: Object.freeze({ ...options.limits }) });
  return Object.freeze({ name: 'diff3', runtimeIdentity: commandRuntimeIdentity, description: 'Compare or merge three VFS byte streams', execute(context: CommandContext) { return executeDiff3(context, configuration); } });
}
export const diff3Command = createDiff3Command();
export function diff3Commands(options: Diff3CommandsOptions = {}): VirtualShellPlugin {
  const commands = createDiff3Commands(options);
  const replace = options.replace ?? false;
  return {
    name: "diff3",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}

export type Diff3CommandsOptions = Diff3CommandOptions;

export function createDiff3Commands(options: Diff3CommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createDiff3Command(options)]);
}
