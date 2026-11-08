import type { PdfPixelStorage } from "../ast.js";
import type { CffCodeSource } from "../vendor/pdfjs-fonts.mjs";
import { StoredNumberRangeTree } from "./stored-range-tree.js";
import { StoredType1Token } from "./stored-type1-lexer.js";

/** Type1's array indexes use signed int32 keys, including sparse properties.
 * Names remain views of the immutable header instead of retained strings. */
export class StoredType1Encoding {
  private readonly tree: StoredNumberRangeTree;
  constructor(
    private readonly source: CffCodeSource,
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal,
    private readonly builtin?: readonly string[]
  ) {
    this.tree = new StoredNumberRangeTree(storage, signal);
  }
  async set(index: number, token: StoredType1Token | null): Promise<void> {
    const position = this.storage.allocate(16),
      bytes = new Uint8Array(16),
      view = new DataView(bytes.buffer);
    view.setFloat64(0, token?.start ?? 0);
    view.setFloat64(8, token?.length ?? -1);
    await this.storage.write(position, bytes, this.signal ? { signal: this.signal } : undefined);
    await this.tree.assign(index + 0x80000000, index + 0x80000000, position + 1);
  }
  async get(index: number): Promise<string | StoredType1Token | null | undefined> {
    this.signal?.throwIfAborted();
    if (this.builtin) return this.builtin[index];
    if (!Number.isInteger(index) || index < -0x80000000 || index > 0x7fffffff) return undefined;
    const position = await this.tree.lookup(index + 0x80000000);
    if (!position) return undefined;
    const bytes = await this.storage.read(
        position - 1,
        16,
        this.signal ? { signal: this.signal } : undefined
      ),
      view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.signal?.throwIfAborted();
    const start = view.getFloat64(0),
      length = view.getFloat64(8);
    return length < 0 ? null : new StoredType1Token(this.source, start, length);
  }
  async *entries(): AsyncGenerator<[number, string | StoredType1Token | null]> {
    if (this.builtin) {
      for (let i = 0; i < this.builtin.length; i++) yield [i, this.builtin[i]!];
      return;
    }
    for await (const leaf of this.tree.leaves()) {
      const index = leaf.low - 0x80000000;
      yield [index, (await this.get(index))!];
    }
  }
}
