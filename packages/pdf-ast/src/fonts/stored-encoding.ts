import { IntegerTable } from "@poe-code/safe-fs/storage";
import type { PdfCosNode, PdfPixelStorage } from "../ast.js";
import { readStoredRecord, writeStoredRecord } from "../content/stored-record.js";
import { FontEncodingPolicy } from "./standard14.js";
import type { PdfFontAllocationOptions } from "./memory.js";

type Label = { name: string; unicode?: string };

/** Declaration maps use caller backing and bounded radix/label caches. Individual
 * glyph-name strings retain the source token's lifetime and size requirements. */
export class StoredFontEncoding {
  readonly storedEncoding = true;
  private readonly index: IntegerTable;
  private pending: Promise<unknown> = Promise.resolve();
  private readonly cache = new Map<number, Label | undefined>();
  private constructor(
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {
    const pending: Array<{ at: number; length: number }> = [];
    async function initialize() {
      while (pending.length) {
        const { at, length } = pending.shift()!;
        signal?.throwIfAborted();
        await storage.write(at, new Uint8Array(length), signal ? { signal } : undefined);
        signal?.throwIfAborted();
      }
    }
    this.index = new IntegerTable(
      {
        allocate(length) {
          const at = storage.allocate(length);
          pending.push({ at, length });
          return at;
        },
        async read(at, length) {
          await initialize();
          signal?.throwIfAborted();
          const bytes = await storage.read(at, length, signal ? { signal } : undefined);
          signal?.throwIfAborted();
          return bytes.slice();
        },
        async write(at, bytes) {
          await initialize();
          signal?.throwIfAborted();
          await storage.write(at, bytes, signal ? { signal } : undefined);
          signal?.throwIfAborted();
        }
      },
      64
    );
  }
  static async create(
    nodes: () => Iterable<PdfCosNode> | AsyncIterable<PdfCosNode>,
    storage: PdfPixelStorage,
    options: Pick<PdfFontAllocationOptions, "onAllocation"> & { signal?: AbortSignal } = {}
  ): Promise<StoredFontEncoding> {
    const { signal } = options;
    signal?.throwIfAborted();
    options.onAllocation?.(65536);
    const result = new StoredFontEncoding(storage, signal),
      policy = new FontEncodingPolicy();
    let turns = 0;
    async function check() {
      if (++turns % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      signal?.throwIfAborted();
    }
    for await (const node of nodes()) {
      await check();
      policy.observe(node);
    }
    let code = 0;
    for await (const node of nodes()) {
      await check();
      if (node.kind === "number") code = node.value;
      else if (node.kind === "name") {
        const unicode = policy.unicode(node.decoded) ?? (await result.label(code))?.unicode;
        const label: Label = { name: node.decoded, ...(unicode === undefined ? {} : { unicode }) };
        const position = await writeStoredRecord(storage, label, -1, signal);
        await result.index.set(result.key(code), BigInt(position));
        signal?.throwIfAborted();
        result.cache.delete(code);
        code++;
      }
    }
    return result;
  }
  private key(code: number): bigint {
    const view = new DataView(new ArrayBuffer(8));
    // Match Map's SameValueZero rules, including every NaN payload and -0.
    view.setFloat64(0, Number.isNaN(code) ? NaN : code === 0 ? 0 : code);
    return view.getBigUint64(0);
  }
  private label(code: number): Promise<Label | undefined> {
    const operation = this.pending.then(async () => {
      this.signal?.throwIfAborted();
      if (this.cache.has(code)) return this.cache.get(code);
      const position = await this.index.get(this.key(code));
      this.signal?.throwIfAborted();
      const value =
        position === undefined
          ? undefined
          : (await readStoredRecord<Label>(this.storage, Number(position), this.signal)).value;
      if (this.cache.size === 64) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(code, value);
      return value;
    });
    this.pending = operation.then(
      () => {},
      () => {}
    );
    return operation;
  }
  readonly glyphName = async (code: number): Promise<string | undefined> =>
    (await this.label(code))?.name;
  readonly unicode = async (code: number): Promise<string | undefined> =>
    (await this.label(code))?.unicode;
}
