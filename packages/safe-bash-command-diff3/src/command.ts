import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from 'safe-bash-contracts/command';
import { FsError } from 'safe-bash-contracts/errors';
import { readBytes, writeBytes, type ByteSource } from 'safe-bash-contracts/io';
import { createOutputOperation, type OutputOperation } from 'safe-bash-contracts/output';
import type { VirtualShellPlugin } from 'safe-bash-contracts/plugin';
import { shellValueByteLength } from 'safe-bash-contracts/value';
import { Diff3Error } from './contracts.js';
import { byteView } from './bytes.js';
import { compareDiff3, diff3DefaultLimits, parseDiff3Arguments, validateDiff3Invocation, type Diff3BehaviorLimits, type Diff3Invocation } from './behavior.js';

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
  const chunks: Uint8Array[][] = [], inputs: Uint8Array[] = [];
  const cleanup = (): Promise<void> => {
    if (closing) return closing;
    accepting = false;
    let resolve!: () => void, reject!: (reason: unknown) => void;
    closing = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
    controller.abort(new Diff3Error('CLOSED', 'Diff3 invocation closed'));
    void (async () => {
      await Promise.allSettled([task]);
      chunks.length = inputs.length = 0; retained = 0;
      context.signal.removeEventListener('abort', abort);
      const results = await Promise.allSettled([stdout?.close(), stderr?.close()]);
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
  const result = (exitCode: 0 | 1 | 2): Diff3CommandResult => ({ exitCode, accounting: { inputBytes, decodedBytes, outputBytes, retainedBytes: 0, peakRetainedBytes: peakRetained, graphCells: 0, peakGraphCells, tokens: 0, work } });
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
      if (!options.information) for (const file of options.files) {
        signal.throwIfAborted();
        let source: ByteSource, borrowed = 0, acquiredInput: { bytes: Uint8Array | undefined } | undefined;
        if (file === '-') source = context.stdin;
        else {
          const path = file.startsWith('/') ? file : `${context.cwd}/${file}`;
          if (context.fs.readStream) source = context.fs.readStream(path, { signal });
          else {
            const maxBytes = Math.min(limits.inputBytes - inputBytes, limits.retainedBytes - retained);
            const resource = await stdout!.acquire(async readSignal => ({ bytes: await context.fs.readFile(path, { signal: readSignal, maxBytes }) as Uint8Array | undefined }), resource => { resource.bytes = undefined; });
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
        const parts: Uint8Array[] = []; chunks.push(parts); let size = 0, complete = false;
        let readFailure: { error: unknown } | undefined;
        try {
          for (;;) {
            charge(1); const next = await reader.next(); signal.throwIfAborted();
            if (next.done) { complete = true; break; }
            const bytes = next.value;
            if (bytes.length === 0) continue;
            if (bytes.length > limits.inputBytes - inputBytes) throw new Diff3Error('LIMIT', 'Input byte limit exceeded');
            context.inputBudget?.check(inputBytes + bytes.length);
            inputBytes += bytes.length; charge(bytes.length); hold(bytes.length + 8);
            const cells = parts.length + inputs.length + chunks.length + 1;
            if (cells > limits.graphCells) throw new Diff3Error('LIMIT', 'Spool fragment limit exceeded');
            peakGraphCells = Math.max(peakGraphCells, cells);
            parts.push(new Uint8Array(bytes)); size += bytes.length;
          }
          hold(size); charge(size);
          const bytes = new Uint8Array(size); let index = 0;
          for (const part of parts) { charge(1); bytes.set(part, index); index += part.length; }
          retained -= size + parts.length * 8 + borrowed; parts.length = 0; inputs.push(bytes);
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
      const spoolCells = inputs.length + chunks.length;
      const rendered = compareDiff3(inputs, options, { ...limits, work: limits.work - work, retainedBytes: limits.retainedBytes - retained, graphCells: limits.graphCells - spoolCells, decodedBytes: limits.decodedBytes - decodedBytes }, signal);
      work += rendered.accounting.work;
      decodedBytes += rendered.accounting.decodedBytes;
      peakGraphCells = Math.max(peakGraphCells, spoolCells + rendered.accounting.peakGraphCells);
      peakRetained = Math.max(peakRetained, retained + rendered.accounting.peakRetainedBytes);
      hold(rendered.stdout.length + rendered.stderr.length);
      outputBytes = rendered.stdout.length + rendered.stderr.length;
      publishing = true;
      if (rendered.stderr.length) await writeBytes(stderr!.output, rendered.stderr, signal);
      if (rendered.stdout.length) await writeBytes(stdout!.output, rendered.stdout, signal);
      return result(rendered.exitCode);
    } catch (error) {
      signal.throwIfAborted();
      if (publishing) throw error;
      if (!(error instanceof Diff3Error) && !(error instanceof FsError)) throw error;
      await stdout!.close(); // Release acquired fallback payloads before diagnostics.
      chunks.length = inputs.length = 0; retained = metadataRetained;
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
export function diff3Commands(options: Diff3CommandOptions = {}): VirtualShellPlugin {
  const command = createDiff3Command(options);
  const replace = options.replace ?? false;
  return { name: 'diff3', setup(host) { host.commands.register(command, { replace }); } };
}
