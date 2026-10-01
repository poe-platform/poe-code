import type {ByteSource, InterpreterProvider, CsvpyConvertedInput, InterpreterWorkBudget} from './contracts.js';
import {CsvkitBlocked, CsvkitDiagnostic} from './errors.js';

export interface CsvpyWasiOptions {
  readonly stdin?: ByteSource;
  readonly terminal?: {readLine(signal: AbortSignal): Promise<string | null>};
  readonly admitInput?: (bytes: Uint8Array) => void;
}
import {createPythonWorker} from '#csvpy-worker';
import type {Endpoint} from './python-worker-contract.js';

/** CPython/WASI owns only its guest memory and the explicitly supplied streams. */
export function createDefaultCsvpyInterpreter(options: CsvpyWasiOptions = {}): InterpreterProvider {
  return {
    modes: ['reader', 'dict', 'agate'],
    async load() {throw new CsvkitBlocked('csvpy requires converted input');},
    async loadConverted(input: CsvpyConvertedInput, signal: AbortSignal, work: InterpreterWorkBudget) {
      signal.throwIfAborted();
      if (input.mode === 'dict' && input.settings.no_header_row) throw new CsvkitDiagnostic("TypeError: 'header' is an invalid keyword argument for this function");
      const table = input.mode === 'agate' ? await input.table() : undefined;
      const payload = JSON.stringify({mode: input.mode, settings: input.settings, ...(table ? {table: {headers: table.headers, columns: table.columns, rows: table.rows}} : {})}, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value);
      input.retainOutput(payload.length * 4);
      let endpoint: Endpoint | undefined;
      let iterator: AsyncIterator<Uint8Array> | undefined;
      let closing: Promise<void> | undefined;
      let rejectInteraction: ((error: unknown) => void) | undefined;
      const retirement = new AbortController();
      const activeSignal = AbortSignal.any([signal, retirement.signal]);
      if (typeof SharedArrayBuffer !== 'function') throw new CsvkitBlocked('csvpy requires shared memory');
      const shared = new SharedArrayBuffer(65544);
      const state = new Int32Array(shared, 0, 2);
      const transfer = new Uint8Array(shared, 8);
      let pendingIO: Promise<void> = Promise.resolve();
      const close = (): Promise<void> => closing ??= (async () => {
        retirement.abort(new CsvkitBlocked('csvpy session closed'));
        rejectInteraction?.(activeSignal.reason);
        Atomics.store(state, 0, 2); Atomics.notify(state, 0);
        // Terminate before draining IO so a guest loop cannot delay cancellation.
        await endpoint?.terminate();
        await iterator?.return?.();
        await pendingIO.catch(() => {});
      })();
      return {
        profile: 'cpython-3.12-wasi-agate-1.14.2', close,
        async interact(banner, interactionSignal) {
          const invocationSignal = AbortSignal.any([activeSignal, interactionSignal]);
          invocationSignal.throwIfAborted();
          const {source} = await import('../dist/python-worker-source.js');
          invocationSignal.throwIfAborted();
          endpoint = createPythonWorker(source);
          let fragment: Uint8Array = new Uint8Array(); let offset = 0; let accountedWork = 0;
          const decoder = {stdout: new TextDecoder(), stderr: new TextDecoder()};
          const read = async (size: number): Promise<number> => {
            while (offset === fragment.length) {
              if (!iterator) {
                iterator = options.stdin?.[Symbol.asyncIterator]() ?? (async function* () {
                  while (options.terminal) {const line = await options.terminal.readLine(invocationSignal); if (line === null) return; yield new TextEncoder().encode(line.endsWith('\n') ? line : line + '\n');}
                })()[Symbol.asyncIterator]();
              }
              const next = await iterator.next(); invocationSignal.throwIfAborted();
              if (next.done) return 0;
              options.admitInput?.(next.value); fragment = next.value; offset = 0;
            }
            const length = Math.min(size, fragment.length - offset); transfer.set(fragment.subarray(offset, offset + length)); offset += length; return length;
          };
          let reader: Awaited<ReturnType<CsvpyConvertedInput['reader']>> | undefined;
          let recordBytes = new Uint8Array(); let recordOffset = 0; let readerLine = 0;
          const readRecord = async (size: number): Promise<number> => {
            if (recordOffset === recordBytes.length) {
              reader ??= await input.reader();
              let record: unknown;
              try {
                const next = reader.next();
                if (next.done) return 0;
                readerLine = next.value.line;
                record = ['row', next.value.cells.map(cell => typeof cell === 'number' && !Number.isFinite(cell) ? {kind: 'float', value: String(cell)} : cell), readerLine];
              } catch (error) {
                if (!(error instanceof CsvkitDiagnostic) || error instanceof CsvkitBlocked) throw error;
                const separator = error.message.indexOf(': ');
                const fieldError = error.message.startsWith('FieldSizeLimitError:');
                if (fieldError) {
                  const start = error.message.indexOf('characters on line ') + 'characters on line '.length;
                  const parsed = Number(error.message.slice(start, error.message.indexOf('.', start)));
                  if (Number.isSafeInteger(parsed) && parsed > 0) readerLine = parsed;
                }
                record = [fieldError ? 'field-error' : error.message.startsWith('ValueError:') ? 'value-error' : 'error', fieldError ? 'field larger than field limit (' + String(input.settings.field_size_limit ?? Infinity) + ')' : separator < 0 ? error.message : error.message.slice(separator + 2), readerLine];
              }
              const text = JSON.stringify(record) + '\n'; input.retainOutput(text.length * 4);
              recordBytes = new TextEncoder().encode(text); recordOffset = 0;
            }
            const length = Math.min(size, recordBytes.length - recordOffset);
            transfer.set(recordBytes.subarray(recordOffset, recordOffset + length)); recordOffset += length; return length;
          };
          const aborted = () => {rejectInteraction?.(invocationSignal.reason); void close();};
          invocationSignal.addEventListener('abort', aborted, {once: true});
          try {
            return await new Promise<number>((resolve, reject) => {
              rejectInteraction = reject;
              endpoint!.onMessage(message => {
                pendingIO = (async () => {
                  invocationSignal.throwIfAborted();
                  work.consume(message.work - accountedWork); accountedWork = message.work;
                  if (message.type === 'error') throw new CsvkitBlocked(message.message);
                  if (message.type === 'done') {
                    if (!input.writeBytes) for (const channel of ['stdout', 'stderr'] as const) {
                      const text = decoder[channel].decode(); if (text) await input.write(text, channel);
                    }
                    resolve(message.exitCode); return;
                  }
                  const size = message.channel === 'stdin' ? await read(message.size) : message.channel === 'reader' ? await readRecord(message.size) : 0;
                  if (message.channel === 'stdout' || message.channel === 'stderr') {
                    const bytes = transfer.subarray(0, message.size);
                    if (input.writeBytes) await input.writeBytes(bytes, message.channel);
                    else {
                      const text = decoder[message.channel].decode(bytes, {stream: true});
                      if (text) await input.write(text, message.channel);
                    }
                  }
                  invocationSignal.throwIfAborted();
                  Atomics.store(state, 1, size); Atomics.store(state, 0, 1); Atomics.notify(state, 0);
                })();
                void pendingIO.catch(reject);
              }, reject);
              endpoint!.postMessage({shared, payload, banner, workLimit: work.limit});
            });
          } finally {invocationSignal.removeEventListener('abort', aborted); await close();}
        }
      };
    }
  };
}
