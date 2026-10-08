import {IntegerTable, PagedStorage, PagedStorageCache} from '@poe-code/safe-fs/storage';
import {FsError, type FileSystem} from 'safe-bash-contracts';
import {yieldTurn} from 'safe-bash-contracts/yield';
import type {EmbeddingJsonNode} from './import-json-document.js';

const nodeTypes = ['object', 'array', 'string', 'number', 'boolean', 'null'] as const;
// Seven numeric fields per node or child link. All pointers are exact JS integers.
const recordBytes = 56;
const pageBytes = 16384;

class JsonStorage extends PagedStorage {
  constructor(fs: FileSystem, directory: string, signal: AbortSignal, private readonly limit: number, cache: PagedStorageCache) {
    super({fs, cwd: directory, env: {}, signal}, 4, cache);
  }
  override allocate(length: number): number {
    const end = super.allocate(0);
    if (Math.ceil((end + length) / pageBytes) * pageBytes > this.limit) throw new FsError('EFBIG', {message: 'JSON staging file byte limit exceeded'});
    return super.allocate(length);
  }
}

/** Index records and streamed string payloads have separate caller-owned files.
 * maxFileBytes bounds the index, as with the former SQLite index plus spool.
 * Both files share one fixed page cache; child links preserve insertion
 * order independently of key hashes and duplicate value replacements. */
export class JsonDocumentStore {
  readonly #storage: JsonStorage;
  readonly #payload: PagedStorage;
  readonly #keys: IntegerTable;
  #steps = 0;
  constructor(options: {fs: FileSystem; directory: string; signal: AbortSignal; maxFileBytes: number; maxOpenFiles: number}) {
    if (!Number.isSafeInteger(options.maxFileBytes) || options.maxFileBytes < 1 || !Number.isSafeInteger(options.maxOpenFiles) || options.maxOpenFiles < 1) throw new RangeError('Invalid JSON staging limits');
    this.#signal = options.signal;
    const cache = new PagedStorageCache(4);
    this.#storage = new JsonStorage(options.fs, options.directory, options.signal, options.maxFileBytes, cache);
    this.#payload = new PagedStorage({fs: options.fs, cwd: options.directory, env: {}, signal: options.signal}, 4, cache);
    this.#keys = new IntegerTable(this.#storage, 64);
  }
  readonly #signal: AbortSignal;

  async #step(): Promise<void> {
    this.#signal.throwIfAborted();
    if (++this.#steps % 256 === 0) await yieldTurn(this.#signal);
  }
  async #number(position: number): Promise<number> {
    const bytes = await this.#storage.read(position, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  async #put(position: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.#storage.write(position, bytes);
  }
  async #record(values: readonly number[]): Promise<number> {
    const bytes = new Uint8Array(recordBytes), view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index++) view.setFloat64(index * 8, values[index]!, true);
    return this.#storage.append(bytes);
  }
  async appendPoints(points: readonly number[], storage: PagedStorage = this.#payload): Promise<void> {
    for (let offset = 0; offset < points.length; offset += pageBytes / 4) {
      await this.#step();
      const count = Math.min(pageBytes / 4, points.length - offset);
      const bytes = new Uint8Array(count * 4), view = new DataView(bytes.buffer);
      for (let index = 0; index < count; index++) view.setUint32(index * 4, points[offset + index]!, true);
      await storage.append(bytes);
    }
  }
  async #equalKey(entry: number, points: readonly number[]): Promise<boolean> {
    const start = await this.#number(entry + 16), end = await this.#number(entry + 24);
    if (end - start !== points.length * 4) return false;
    for (let offset = 0; offset < points.length; offset += pageBytes / 4) {
      await this.#step();
      const count = Math.min(pageBytes / 4, points.length - offset);
      const bytes = await this.#storage.read(start + offset * 4, count * 4);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let index = 0; index < count; index++) if (view.getUint32(index * 4, true) !== points[offset + index]) return false;
    }
    return true;
  }
  async insert(type: EmbeddingJsonNode['type'], parent: number, key: number, keyPoints: readonly number[] | null, token = ''): Promise<number> {
    await this.#step();
    // Node: type, parent, payload start/end, first/last child, child count.
    const id = await this.#record([nodeTypes.indexOf(type), parent, 0, 0, 0, 0, 0]);
    if (token) {
      const bytes = new TextEncoder().encode(token);
      const start = await this.#storage.append(bytes);
      await this.#put(id + 16, start); await this.#put(id + 24, start + bytes.length);
    }
    if (parent) {
      let hash = 0;
      if (keyPoints) for (const point of keyPoints) hash = Math.imul(hash ^ point, 16777619) >>> 0;
      hash = (hash ^ parent ^ Math.floor(parent / 0x100000000)) >>> 0;
      const collision = keyPoints ? Number(await this.#keys.get(BigInt(hash)) ?? 0n) : 0;
      let existing = 0;
      for (let entry = collision; entry; entry = await this.#number(entry + 8)) {
        await this.#step();
        if (await this.#number(entry) === parent && await this.#equalKey(entry, keyPoints!)) {existing = entry; break;}
      }
      if (existing) await this.#put(existing + 32, id);
      else {
        const start = this.#storage.allocate(0);
        if (keyPoints) await this.appendPoints(keyPoints, this.#storage);
        const end = this.#storage.allocate(0);
        // Link: parent, hash collision, key start/end, value, successor, array key.
        const entry = await this.#record([parent, collision, start, end, id, 0, keyPoints ? -1 : key]);
        const tail = await this.#number(parent + 40);
        if (tail) await this.#put(tail + 40, entry); else await this.#put(parent + 32, entry);
        await this.#put(parent + 40, entry);
        await this.#put(parent + 48, await this.#number(parent + 48) + 1);
        if (keyPoints) await this.#keys.set(BigInt(hash), BigInt(entry));
      }
    }
    if (type === 'string') await this.#put(id + 16, this.#payload.allocate(0));
    return id;
  }
  async endString(id: number): Promise<void> {
    await this.#put(id + 24, this.#payload.allocate(0));
  }
  async parent(id: number): Promise<number> {
    return this.#number(id + 8);
  }
  async node(id: number): Promise<EmbeddingJsonNode> {
    await this.#step();
    const type = nodeTypes[await this.#number(id)]!;
    const start = await this.#number(id + 16), end = await this.#number(id + 24);
    let token = '';
    if (type === 'number' || type === 'boolean') {
      const decoder = new TextDecoder();
      for (let offset = start; offset < end; offset += pageBytes) {
        await this.#step();
        token += decoder.decode(await this.#storage.read(offset, Math.min(pageBytes, end - offset)), {stream: true});
      }
      token += decoder.decode();
    }
    return {id, type, start, end, token};
  }
  async *points(node: EmbeddingJsonNode, storage: PagedStorage = this.#payload): AsyncIterable<readonly number[]> {
    if (node.type !== 'string') throw new TypeError('JSON node is not a string');
    for (let offset = node.start; offset < node.end; offset += pageBytes) {
      await this.#step();
      const bytes = await storage.read(offset, Math.min(pageBytes, node.end - offset));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length), points: number[] = [];
      for (let index = 0; index < bytes.length; index += 4) points.push(view.getUint32(index, true));
      yield points;
    }
  }
  async child(parent: number, after = -1): Promise<{node: EmbeddingJsonNode; position: number; key: string | number; keyPoints?: number[]} | undefined> {
    await this.#step();
    const entry = after < 0 ? await this.#number(parent + 32) : await this.#number(after + 40);
    if (!entry) return undefined;
    const node = await this.node(await this.#number(entry + 32)), key = await this.#number(entry + 48);
    if (key >= 0) return {node, position: entry, key};
    const keyPoints: number[] = [];
    // Parser control limits bound key code points; streamed values stay on disk.
    let text = '';
    for await (const points of this.points({id: entry, type: 'string', start: await this.#number(entry + 16), end: await this.#number(entry + 24), token: ''}, this.#storage)) {
      keyPoints.push(...points); text += String.fromCodePoint(...points);
    }
    return {node, position: entry, key: text, keyPoints};
  }
  async close(): Promise<void> {
    const results = await Promise.allSettled([this.#storage.close(), this.#payload.close()]);
    for (const result of results) if (result.status === 'rejected') throw result.reason;
  }
}
