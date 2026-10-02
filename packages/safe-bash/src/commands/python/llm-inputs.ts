import { createLlmSpool, type LlmInputSource } from 'safe-bash-command-llm';
import type { HttpTransport } from '../network/types.js';
import type { FileSystem } from '../../contracts/index.js';
import type { PythonHostValue } from './host-capabilities.js';

type Spool = Awaited<ReturnType<typeof createLlmSpool>>;
interface Entry {
  readonly ready: Promise<Spool>;
  bytes: number;
  leased: boolean;
  writing?: Promise<void>;
  closing?: Promise<void>;
}

/** Private byte handles retain canonical staging, including before Python can receive their IDs. */
export function createPythonLlmInputs(fs: FileSystem, maxBytes: number, transport?: HttpTransport) {
  const entries = new Map<number, Entry>();
  const pending = new Set<Promise<unknown>>();
  const controller = new AbortController();
  let serial = 0, retained = 0;
  let closing: Promise<void> | undefined;
  const track = <T>(work: Promise<T>): Promise<T> => {
    pending.add(work);
    return work.finally(() => pending.delete(work));
  };
  const live = (signal: AbortSignal): AbortSignal => {
    const combined = AbortSignal.any([signal, controller.signal]);
    combined.throwIfAborted();
    return combined;
  };
  const entryFor = (id: PythonHostValue | undefined): [number, Entry] => {
    if (typeof id !== 'number' || !Number.isSafeInteger(id) || !entries.has(id)) throw new TypeError('Unknown Python LLM input');
    return [id, entries.get(id)!];
  };
  const release = (id: number, entry: Entry): Promise<void> => {
    entry.closing ??= (async () => {
      await entry.writing?.catch(() => {});
      const spool = await entry.ready;
      await spool.close();
      retained -= entry.bytes;
      entries.delete(id);
    })();
    return entry.closing;
  };
  const inputs = {
    async remote(value: PythonHostValue | undefined, method: 'HEAD' | 'GET', directory: string, signal: AbortSignal): Promise<string | number | null> {
      signal = live(signal);
      const send = transport;
      if (!send) throw new Error('Python LLM URL attachments are disabled by the host');
      if (typeof value !== 'string' || value.length > 4096 || new TextEncoder().encode(value).byteLength > 4096) throw new TypeError('Invalid attachment URL');
      const url = new URL(value);
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new TypeError('Invalid attachment URL');
      // Register the whole acquisition before invoking host transport.
      return track(Promise.resolve().then(async () => {
        const cleanups = new Set<() => void | Promise<void>>();
        let id: number | undefined;
        let result: string | number | null = null;
        let failure: {error: unknown} | undefined;
        try {
          signal.throwIfAborted();
          const response = await send({url:url.href,method,headers:[['accept','*/*']],signal,
            responseBodyMode:method === 'HEAD' ? 'omit' : 'read',
            registerCleanup(cleanup) { cleanups.add(cleanup); }});
          cleanups.add(response.dispose);
          signal.throwIfAborted();
          let headerBytes = 0, mimeType: string | null = null;
          for (const [name, value] of response.headers) {
            if (name.length + value.length + 4 > 8192 - headerBytes) throw new RangeError('Attachment header byte limit exceeded');
            headerBytes += new TextEncoder().encode(name).byteLength + new TextEncoder().encode(value).byteLength + 4;
            if (headerBytes > 8192) throw new RangeError('Attachment header byte limit exceeded');
            if (name.toLowerCase() === 'content-type') mimeType = value;
          }
          // Match the reference library's default: redirects are not followed.
          if (response.status < 200 || response.status >= 300) throw new Error(`Attachment HTTP status ${response.status}`);
          if (method === 'HEAD') {
            if (mimeType !== null && new TextEncoder().encode(mimeType).byteLength > 256) throw new RangeError('Attachment MIME type byte limit exceeded');
            result = mimeType;
          } else {
            id = await inputs.open(directory, signal);
            for await (const bytes of response.body) {
              signal.throwIfAborted();
              if (bytes.byteLength > maxBytes - retained) throw new RangeError('Python LLM input byte limit exceeded');
              for (let offset = 0; offset < bytes.byteLength; offset += 16384) {
                await inputs.write(id, Array.from(bytes.subarray(offset, offset + 16384)), signal);
              }
            }
            signal.throwIfAborted();
            result = id;
          }
        } catch (error) { failure = {error}; }
        const results = await Promise.allSettled([...cleanups].map(cleanup => Promise.resolve().then(cleanup)));
        const cleanupErrors = results.flatMap(item => item.status === 'rejected' ? [item.reason] : []);
        if (cleanupErrors.length) {
          failure = {error:new AggregateError([...(failure ? [failure.error] : []),...cleanupErrors], 'Attachment transport cleanup failed')};
        }
        if (failure) {
          if (id !== undefined) await inputs.release(id);
          throw failure.error;
        }
        return result;
      }));
    },
    async open(directory: string, signal: AbortSignal): Promise<number> {
      signal = live(signal);
      if (entries.size >= 64) throw new RangeError('Python LLM input count limit exceeded');
      const id = ++serial;
      const entry: Entry = {ready: createLlmSpool(fs, directory, signal, 'input'), bytes: 0, leased: false};
      entries.set(id, entry);
      try {
        await track(entry.ready);
        live(signal);
        return id;
      } catch (error) {
        await entry.ready.then(() => release(id, entry), () => { entries.delete(id); });
        throw error;
      }
    },
    async write(id: PythonHostValue | undefined, value: PythonHostValue | undefined, signal: AbortSignal): Promise<void> {
      signal = live(signal);
      const [, entry] = entryFor(id);
      if (entry.leased || entry.writing || entry.closing) throw new Error('Python LLM input is busy or sealed');
      if (!Array.isArray(value) || value.length > 16384 ||
        value.some(byte => typeof byte !== 'number' || !Number.isInteger(byte) || byte < 0 || byte > 255)) {
        throw new TypeError('Invalid Python LLM input chunk');
      }
      if (value.length > maxBytes - retained) throw new RangeError('Python LLM input byte limit exceeded');
      retained += value.length;
      entry.bytes += value.length;
      const work = entry.ready.then(spool => { signal.throwIfAborted(); return spool.write(Uint8Array.from(value as number[])); });
      entry.writing = work;
      try { await track(work); } finally { delete entry.writing; }
    },
    source(value: PythonHostValue, signal: AbortSignal): LlmInputSource & {readonly size: number} {
      signal = live(signal);
      const [id, entry] = entryFor(value);
      if (entry.leased || entry.writing || entry.closing) throw new Error('Python LLM input is busy or sealed');
      entry.leased = true;
      return {size: entry.bytes, bytes: (async function* () {
        const spool = await entry.ready;
        for await (const bytes of spool.replay()) { signal.throwIfAborted(); yield bytes; }
      })(), dispose: () => release(id, entry)};
    },
    async release(value: PythonHostValue | undefined): Promise<void> {
      if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > serial) throw new TypeError('Unknown Python LLM input');
      const entry = entries.get(value);
      if (entry) await release(value, entry);
    },
    close(): Promise<void> {
      closing ??= (async () => {
        controller.abort(new Error('Python LLM inputs retired'));
        await Promise.allSettled([...pending]);
        const results = await Promise.allSettled([...entries].map(([id, entry]) => release(id, entry)));
        const failures = results.filter(result => result.status === 'rejected');
        if (failures.length) throw new AggregateError(failures.map(result => result.reason), 'Python LLM input cleanup failed');
      })();
      return closing;
    },
  };
  return inputs;
}
