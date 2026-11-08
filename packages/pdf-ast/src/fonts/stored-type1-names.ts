import type { PdfPixelStorage } from "../ast.js";
import { getGlyphsUnicode } from "../vendor/pdfjs-fonts.mjs";
import { StoredNumberRangeTree } from "./stored-range-tree.js";
import type { StoredType1Token } from "./stored-type1-lexer.js";

export type Type1Name = string | StoredType1Token | null;
async function hash(name: Type1Name): Promise<number> {
  if (name === null) return 0;
  let hash = 2166136261;
  for (let i = 0; i < name.length; i++)
    hash = Math.imul(
      hash ^
        (typeof name === "string" ? name.charCodeAt(i) : (await name.source.byte(name.start + i))!),
      16777619
    );
  return hash >>> 0;
}
async function equal(a: Type1Name, b: Type1Name): Promise<boolean> {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const left = typeof a === "string" ? a.charCodeAt(i) : await a.source.byte(a.start + i);
    const right = typeof b === "string" ? b.charCodeAt(i) : await b.source.byte(b.start + i);
    if (left !== right) return false;
  }
  return true;
}

/** Hash buckets and collision chains live in caller storage. Exact comparisons
 * preserve first-name mapping even for arbitrarily long or colliding names. */
export class StoredType1Names {
  private readonly tree: StoredNumberRangeTree;
  constructor(
    private readonly glyphName: (gid: number) => Promise<Type1Name>,
    private readonly storage: PdfPixelStorage,
    private readonly signal?: AbortSignal
  ) {
    this.tree = new StoredNumberRangeTree(storage, signal);
  }
  async build(count: number): Promise<void> {
    for (let gid = count - 1; gid >= 0; gid--) {
      if (gid % 256 === 0) await new Promise<void>((resolve) => setTimeout(resolve, 0));
      this.signal?.throwIfAborted();
      const key = await hash(await this.glyphName(gid)),
        next = await this.tree.lookup(key),
        position = this.storage.allocate(16),
        bytes = new Uint8Array(16),
        view = new DataView(bytes.buffer);
      view.setFloat64(0, gid);
      view.setFloat64(8, next);
      await this.storage.write(position, bytes, this.signal ? { signal: this.signal } : undefined);
      await this.tree.assign(key, key, position + 1);
    }
  }
  async find(name: Type1Name | undefined, start = 0): Promise<number> {
    this.signal?.throwIfAborted();
    if (name === undefined) return -1;
    let pointer = await this.tree.lookup(await hash(name));
    while (pointer) {
      const bytes = await this.storage.read(
          pointer - 1,
          16,
          this.signal ? { signal: this.signal } : undefined
        ),
        view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      this.signal?.throwIfAborted();
      const gid = view.getFloat64(0);
      pointer = view.getFloat64(8);
      if (gid >= start && (await equal(await this.glyphName(gid), name))) return gid;
    }
    return -1;
  }
}

const unicodeByName = getGlyphsUnicode(),
  maximumNameLength = Math.max(...Object.keys(unicodeByName).map((name) => name.length));
export async function type1NameUnicode(name: Type1Name): Promise<string | undefined> {
  if (name === null || name.length > maximumNameLength) return undefined;
  let text = typeof name === "string" ? name : "";
  if (typeof name !== "string")
    for (let i = 0; i < name.length; i++)
      text += String.fromCharCode((await name.source.byte(name.start + i))!);
  const unicode = unicodeByName[text];
  return unicode === undefined ? undefined : String.fromCodePoint(unicode);
}
