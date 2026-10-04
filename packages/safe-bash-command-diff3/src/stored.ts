import { PagedStorage } from '@poe-code/safe-fs/storage';
import { IndexedDocument, closeDocumentResources } from 'safe-bash-diff-engine/document';
import { monotonicNow, yieldTurn } from 'safe-bash-contracts/yield';
import type { ByteSource, CommandContext } from 'safe-bash-contracts';
import { Budget } from './budget.js';
import { type Diff3Limits, type Diff3Edit, type Diff3Options, type Diff3Region } from './contracts.js';
import type { Diff3BehaviorLimits } from './behavior.js';

/** One invocation owns fixed caches; numeric vectors share the same page pool. */
export class StoredWork extends Budget {
  readonly storage: PagedStorage;
  private readonly resources: { close(): Promise<void> }[] = [];
  private nextYield = 4096;
  private nextTime = 0;
  private reserved = false;
  constructor(readonly context: CommandContext, readonly behaviorLimits: Diff3BehaviorLimits, private readonly charge?: (amount: number) => void, private readonly retain?: (amount: number) => void) {
    super(behaviorLimits, context.signal);
    this.storage = new PagedStorage(context, 8);
    this.resources.push(this.storage);
  }
  override admit(resource: keyof Diff3Limits, amount: number): void {
    if (resource === 'work') this.charge?.(amount);
    super.admit(resource, amount);
  }
  step(amount = 1): void { this.admit('work', amount); }
  checkpoint(): void | Promise<void> {
    this.context.signal.throwIfAborted();
    if (this.work < this.nextYield) return;
    this.nextYield = this.work + 4096;
    const now = monotonicNow();
    if (now < this.nextTime) return;
    this.nextTime = now + 16;
    return yieldTurn(this.context.signal);
  }
  reserve(): void {
    if (this.reserved) return;
    // Three document/index caches, comparison records, shared numeric pages,
    // two output caches, and owned input/output blocks fit inside this reserve.
    this.retain?.(1024 * 1024);
    this.admit('retainedBytes', 1024 * 1024);
    this.reserved = true;
  }
  async load(source: ByteSource): Promise<IndexedDocument> {
    const document = new IndexedDocument(this, 2);
    this.resources.push(document);
    const iterator = source[Symbol.asyncIterator]();
    try {
      const first = await iterator.next();
      if (!first.done) {
        this.reserve();
        await document.load({ async *[Symbol.asyncIterator]() {
          yield first.value;
          for (;;) {
            const next = await iterator.next();
            if (next.done) break;
            yield next.value;
          }
        } });
      }
    } finally { await iterator.return?.(); }
    this.admit('tokens', document.length);
    return document;
  }
  output(): StoredOutput {
    const output = new StoredOutput(this);
    this.resources.push(output);
    return output;
  }
  async close(): Promise<void> {
    try { await closeDocumentResources(this.resources); }
    finally { this.dispose(); }
  }
}

/** Zero-initialized random-access cells with no input-sized resident array. */
export class Numbers {
  private readonly position: number;
  constructor(readonly work: StoredWork, readonly length: number, position?: number) {
    this.position = position ?? work.storage.allocate(length * 8);
  }
  async get(index: number): Promise<number> {
    if (index < 0 || index >= this.length) return 0;
    const checkpoint = this.work.checkpoint(); if (checkpoint) await checkpoint;
    const bytes = await this.work.storage.read(this.position + index * 8, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }
  async set(index: number, value: number): Promise<void> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.length) throw new RangeError('Diff3 vector index');
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.work.storage.write(this.position + index * 8, bytes);
    const checkpoint = this.work.checkpoint(); if (checkpoint) await checkpoint;
  }
  slice(start: number, end: number): Numbers { return new Numbers(this.work, end - start, this.position + start * 8); }
}

export class Edits {
  length = 0;
  private readonly cells: Numbers;
  constructor(work: StoredWork, capacity: number) { this.cells = new Numbers(work, capacity * 4); }
  async push(edit: Diff3Edit): Promise<void> {
    const values = [edit.base.start, edit.base.end, edit.variant.start, edit.variant.end];
    for (let i = 0; i < 4; i++) await this.cells.set(this.length * 4 + i, values[i]!);
    this.length++;
  }
  async get(index: number): Promise<Diff3Edit | undefined> {
    if (index >= this.length) return undefined;
    return { base: { start: await this.cells.get(index * 4), end: await this.cells.get(index * 4 + 1) },
      variant: { start: await this.cells.get(index * 4 + 2), end: await this.cells.get(index * 4 + 3) } };
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<Diff3Edit> {
    for (let index = 0; index < this.length; index++) yield (await this.get(index))!;
  }
}

const kinds: readonly Diff3Region['kind'][] = ['left', 'right', 'identical', 'adjacent', 'conflict'];
export class Regions {
  length = 0;
  private readonly cells: Numbers;
  constructor(work: StoredWork, capacity: number) { this.cells = new Numbers(work, capacity * 7); }
  async push(region: Diff3Region): Promise<void> {
    const values = [kinds.indexOf(region.kind), region.base.start, region.base.end, region.left.start, region.left.end, region.right.start, region.right.end];
    for (let i = 0; i < 7; i++) await this.cells.set(this.length * 7 + i, values[i]!);
    this.length++;
  }
  async *iterate(reverse: boolean): AsyncGenerator<Diff3Region> {
    for (let i = 0; i < this.length; i++) {
      const offset = (reverse ? this.length - i - 1 : i) * 7;
      yield { kind: kinds[await this.cells.get(offset)]!,
        base: { start: await this.cells.get(offset + 1), end: await this.cells.get(offset + 2) },
        left: { start: await this.cells.get(offset + 3), end: await this.cells.get(offset + 4) },
        right: { start: await this.cells.get(offset + 5), end: await this.cells.get(offset + 6) } };
    }
  }
}

export interface StoredLine { readonly document: IndexedDocument; readonly start: number; readonly end: number; readonly terminated: boolean }
export async function storedLine(document: IndexedDocument, index: number): Promise<StoredLine> {
  const line = await document.line(index);
  const last = await document.data.read(8 + line.end - 1, 1);
  return { document, start: line.start, end: line.end, terminated: last[0] === 10 };
}
export async function bodyEnd(line: StoredLine, options: Diff3Options): Promise<number> {
  const end = line.end - Number(line.terminated);
  if (options.stripTrailingCR && line.terminated && end > line.start && (await line.document.data.read(8 + end - 1, 1))[0] === 13) return end - 1;
  return end;
}
export async function equalStoredLines(a: StoredLine, b: StoredLine, options: Diff3Options, work: StoredWork): Promise<boolean> {
  work.step();
  const endA = await bodyEnd(a, options), endB = await bodyEnd(b, options);
  if (a.terminated !== b.terminated || endA - a.start !== endB - b.start) return false;
  for (let offset = 0; offset < endA - a.start; offset += 16384) {
    const size = Math.min(16384, endA - a.start - offset);
    const left = await a.document.data.read(8 + a.start + offset, size), right = await b.document.data.read(8 + b.start + offset, size);
    work.step(size);
    for (let i = 0; i < size; i++) if (left[i] !== right[i]) return false;
    const checkpoint = work.checkpoint(); if (checkpoint) await checkpoint;
  }
  return true;
}
export class StoredOutput {
  private readonly data: PagedStorage;
  size = 0;
  constructor(private readonly work: StoredWork) { this.data = new PagedStorage(work.context, 2); }
  async append(bytes: Uint8Array): Promise<void> {
    if (bytes.length) this.work.reserve();
    await this.data.append(bytes); this.size += bytes.length;
    const checkpoint = this.work.checkpoint(); if (checkpoint) await checkpoint;
  }
  async *bytes(): ByteSource {
    for (let offset = 0; offset < this.size; offset += 16384) yield await this.data.read(8 + offset, Math.min(16384, this.size - offset));
  }
  close(): Promise<void> { return this.data.close(); }
}
