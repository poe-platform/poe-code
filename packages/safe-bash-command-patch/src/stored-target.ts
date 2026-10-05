import { PagedStorage, PagedStorageCache } from "@poe-code/safe-fs/storage";
import { IndexedDocument, closeDocumentResources, type DocumentBudget } from "safe-bash-diff-engine/document";
import { Budget, ToolError, host } from "safe-bash-diff-engine/shared";
import type { ByteSource } from "safe-bash-contracts";

export type TargetLine = string | { document: IndexedDocument; index: number }
  | { storage: PagedStorage; start: number; end: number };

export async function* targetBytes(line: TargetLine): ByteSource {
  if (typeof line !== "string") {
    if ("storage" in line) {
      for (let offset = line.start; offset < line.end; offset += 16384)
        yield await line.storage.read(offset, Math.min(16384, line.end - offset));
      return;
    }
    const range = await line.document.line(line.index);
    yield* line.document.range(range.start, range.end);
    return;
  }
  for (let start = 0; start < line.length;) {
    let end = Math.min(start + 4096, line.length);
    const last = line.charCodeAt(end - 1);
    if (end < line.length && last >= 0xd800 && last <= 0xdbff) end--;
    yield new TextEncoder().encode(line.slice(start, end));
    start = end;
  }
}

async function* normalized(line: TargetLine, whitespace: boolean): ByteSource {
  if (!whitespace) { yield* targetBytes(line); return; }
  let pending = false, cr = false;
  let output: number[] = [];
  for await (const block of targetBytes(line)) {
    for (const byte of block) {
      if (cr) {
        if (byte !== 10 && pending) output.push(32);
        output.push(13); cr = false; pending = false;
      }
      if (byte === 32 || byte === 9) pending = true;
      else if (byte === 13 && pending) cr = true;
      else {
        if (pending && byte !== 10) output.push(32);
        pending = false; output.push(byte);
      }
      if (output.length >= 4096) { yield Uint8Array.from(output); output = []; }
    }
  }
  if (cr) output.push(32, 13);
  if (output.length) yield Uint8Array.from(output);
}

export async function equalTargetLines(left: TargetLine, right: TargetLine, budget: Budget, whitespace = false): Promise<boolean> {
  const a = normalized(left, whitespace)[Symbol.asyncIterator]();
  const b = normalized(right, whitespace)[Symbol.asyncIterator]();
  try {
    let x = await a.next(), y = await b.next(), i = 0, j = 0;
    while (!x.done && !y.done) {
      const count = Math.min(x.value.length - i, y.value.length - j);
      budget.step(count);
      for (let k = 0; k < count; k++) if (x.value[i + k] !== y.value[j + k]) return false;
      i += count; j += count;
      if (i === x.value.length) { x = await a.next(); i = 0; }
      if (j === y.value.length) { y = await b.next(); j = 0; }
      const checkpoint = budget.checkpoint(); if (checkpoint) await checkpoint;
    }
    return !!x.done && !!y.done;
  } finally { await a.return?.(); await b.return?.(); }
}

/** Owns caller-backed immutable targets for the duration of patch preflight/publication. */
export class TargetDocuments {
  readonly cache = new PagedStorageCache(16);
  private readonly documents = new Set<IndexedDocument>();
  private readonly documentBudget: DocumentBudget;
  constructor(readonly budget: Budget) {
    this.documentBudget = { context: budget.context, documentCache: this.cache,
      step: budget.step.bind(budget), checkpoint: budget.checkpoint.bind(budget) };
  }

  async load(source: ByteSource): Promise<IndexedDocument> {
    const document = new IndexedDocument(this.documentBudget, 2);
    this.documents.add(document);
    await document.load(source);
    if (document.binary) throw new ToolError("binary input is unsupported (NUL byte)");
    if (!document.validUtf8) throw new ToolError("binary input is unsupported (invalid UTF-8)");
    return document;
  }

  async read(path: string): Promise<IndexedDocument> {
    const iterator = this.budget.diffSource(path);
    const context = this.budget.context;
    return this.load({ async *[Symbol.asyncIterator]() {
      try {
        for (;;) {
          const next = await host(context, () => iterator.next());
          if (next.done) break;
          yield next.value;
        }
      } finally {
        // A non-cooperative read still owns its handle until it settles.
        const closed = iterator.return(undefined);
        if (context.signal.aborted) void closed.catch(() => {});
        else await closed;
      }
    } });
  }

  async concat(left: IndexedDocument, right: IndexedDocument): Promise<IndexedDocument> {
    return this.load({ async *[Symbol.asyncIterator]() {
      yield* left.range(0, left.size); yield* right.range(0, right.size);
    } });
  }

  async release(document: IndexedDocument): Promise<void> {
    await document.close();
    this.documents.delete(document);
  }

  close(): Promise<void> { return closeDocumentResources([...this.documents]); }
}

/** Append one logical record at a time, retaining only its final byte. */
export class TargetOutput {
  private readonly data: PagedStorage;
  private size = 0;
  private unterminated = false;
  length = 0;
  constructor(private readonly documents: TargetDocuments) {
    this.data = new PagedStorage(documents.budget.context, 2);
  }

  async append(line: TargetLine): Promise<void> {
    if (this.unterminated) await this.write(new Uint8Array([10]));
    this.unterminated = false;
    for await (const bytes of targetBytes(line)) {
      await this.write(bytes);
      this.unterminated = bytes.at(-1) !== 10;
    }
    this.length++;
  }

  private async write(bytes: Uint8Array): Promise<void> {
    this.size += bytes.length;
    if (this.size > this.documents.budget.limits.maxOutputBytes) throw new ToolError("output byte limit exceeded");
    await this.data.append(bytes);
  }

  async finish(): Promise<IndexedDocument> {
    const data = this.data, size = this.size;
    this.documents.budget.outputLength(size);
    return this.documents.load({ async *[Symbol.asyncIterator]() {
      for (let offset = 0; offset < size; offset += 16384) yield await data.read(8 + offset, Math.min(16384, size - offset));
    } });
  }

  close(): Promise<void> { return this.data.close(); }
}
