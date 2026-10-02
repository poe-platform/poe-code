import { createLlmSpool, type LlmInputSource } from 'safe-bash-command-llm';
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
export function createPythonLlmInputs(fs: FileSystem, maxBytes: number) {
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
  return {
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
}
