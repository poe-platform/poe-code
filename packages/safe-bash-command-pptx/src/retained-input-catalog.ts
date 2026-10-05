import type { PagedStorage } from '@poe-code/safe-fs/storage';
import { ZipDirectoryIndex } from '@poe-code/office-package/zip';
import type { FileStat } from 'safe-bash-contracts';

export interface RetainedInputRecord {
  readonly start: number;
  readonly size: number;
  readonly entry?: FileStat;
  readonly identity?: FileStat;
}
type StoredStat = Omit<FileStat, 'identityScope'> & { readonly scope?: number | string };
/** Stores per-path observations and replay offsets in caller pages. Scope labels
 * are weak capabilities: the catalog never keeps backend scope objects alive.
 * Registered symbols already have global names and need no resident index. */
export class RetainedInputCatalog {
  private readonly names: ZipDirectoryIndex;
  private readonly scopes = new WeakMap<object | symbol, number>();
  private readonly distinctScope = {};
  private nextScope = 1;
  private first = 0;
  private last = 0;
  constructor(private readonly pages: PagedStorage, private readonly signal: AbortSignal) { this.names = new ZipDirectoryIndex(pages, { signal, maximumKeyLength: Infinity }); }
  private scope(value: object | symbol | undefined): number | string | undefined {
    if (value === undefined) return undefined;
    if (typeof value === 'symbol') { const key = Symbol.keyFor(value); if (key !== undefined) return key; }
    let id = this.scopes.get(value); if (id === undefined) { id = this.nextScope++; this.scopes.set(value, id); } return id;
  }
  private storeStat(value: FileStat | undefined): StoredStat | undefined {
    if (!value) return undefined;
    const { identityScope, ...rest } = value, scope = this.scope(identityScope);
    return { ...rest, ...(scope === undefined ? {} : { scope }) };
  }
  private restoreStat(value: StoredStat | undefined, peer: FileStat | undefined): FileStat | undefined {
    if (!value) return undefined;
    const { scope, ...rest } = value;
    return { ...rest, ...(scope === undefined ? {} : { identityScope: scope === this.scope(peer?.identityScope) ? peer!.identityScope! : this.distinctScope }) };
  }
  private async row(position: number, peer?: FileStat): Promise<{ next: number; path: string; record: RetainedInputRecord }> {
    this.signal.throwIfAborted(); const header = await this.pages.read(position, 16), view = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const next = view.getFloat64(0, true), length = view.getFloat64(8, true), decoder = new TextDecoder(); let json = '';
    for (let offset = 0; offset < length; offset += 16384) { this.signal.throwIfAborted(); json += decoder.decode(await this.pages.read(position + 16 + offset, Math.min(16384, length - offset)), { stream: true }); }
    const value = JSON.parse(json + decoder.decode()) as { path: string; start: number; size: number; entry?: StoredStat; identity?: StoredStat };
    const entry = this.restoreStat(value.entry, peer), identity = this.restoreStat(value.identity, peer);
    return { next, path: value.path, record: { start: value.start, size: value.size, ...(entry ? { entry } : {}), ...(identity ? { identity } : {}) } };
  }
  async put(path: string, record: RetainedInputRecord): Promise<void> {
    this.signal.throwIfAborted();
    if (await this.names.get(path) !== undefined) throw new Error('Input record already exists');
    const position = this.pages.allocate(16), json = JSON.stringify({ path, start: record.start, size: record.size, entry: this.storeStat(record.entry), identity: this.storeStat(record.identity) });
    const encoder = new TextEncoder(); let text = '', length = 0;
    for (const character of json) { text += character; if (text.length >= 4096) { const bytes = encoder.encode(text); await this.pages.append(bytes); length += bytes.length; text = ''; } }
    if (text) { const bytes = encoder.encode(text); await this.pages.append(bytes); length += bytes.length; }
    const header = new Uint8Array(16); new DataView(header.buffer).setFloat64(8, length, true); await this.pages.write(position, header);
    if (this.last) { const link = new Uint8Array(8); new DataView(link.buffer).setFloat64(0, position, true); await this.pages.write(this.last, link); } else this.first = position;
    this.last = position; await this.names.set(path, position); this.signal.throwIfAborted();
  }
  async get(path: string, peer?: FileStat): Promise<RetainedInputRecord | undefined> { const position = await this.names.get(path); return position === undefined ? undefined : (await this.row(position, peer)).record; }
  async *entries(peer?: FileStat): AsyncGenerator<readonly [string, RetainedInputRecord]> { for (let position = this.first; position;) { const row = await this.row(position, peer); yield [row.path, row.record]; position = row.next; } this.signal.throwIfAborted(); }
}
