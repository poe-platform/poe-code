import type {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText, type TextRange} from "./backed-text.js";
import type {BackedJson} from "./backed-json.js";

const tags = ["Code", "CodeBlock", "HorizontalRule", "Str", "Space", "LineBreak", "Strong", "Emph", "Underline", "Strikeout", "SmallCaps", "Superscript", "Subscript", "Span", "Para", "Header", "Div", "BulletList", "OrderedList", "Table", "ColWidthDefault", "AlignDefault", "Plain", "Image", "Link", "Note", "Decimal", "UpperRoman", "LowerRoman", "UpperAlpha", "LowerAlpha", "Period", "OneParen", "TwoParens", "BlockQuote", "Figure", "MetaMap", "MetaList", "MetaString", "MetaBlocks", "MetaInlines", "SoftBreak", "RawInline", "RawBlock", "AlignLeft", "AlignRight", "AlignCenter", "Cite", "NormalCitation", "SuppressAuthor"] as const;
export type RtfValue = {readonly position: number};
type Literal = string | number | null | RtfValue | readonly Literal[];

/** Mutable parser-owned nodes: list items and table bodies can receive children
 * after their parent is emitted. Array links, text and serialization frames all
 * use caller storage; no document-wide JavaScript arrays or recursive traversal.
 * Strings appended with appendText transfer their text-chain ownership. */
export class RetainedRtfAst {
  readonly text: BackedText;
  constructor(private readonly storage: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {
    this.text = new BackedText(storage, cooperate);
  }
  private async fields(position: number, count: number): Promise<number[]> {
    const bytes = await this.storage.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  }
  private async put(position: number, fields: readonly number[]): Promise<void> {
    const bytes = new Uint8Array(fields.length * 8), view = new DataView(bytes.buffer);
    fields.forEach((value, index) => view.setFloat64(index * 8, value, true));
    await this.storage.write(position, bytes);
  }
  private async record(fields: readonly number[]): Promise<number> {
    const position = this.storage.allocate(fields.length * 8); await this.put(position, fields); return position;
  }
  // Fixed 40-byte nodes: array(0), UTF-16 string(1), number/null(2), tag(3), object(4).
  async array(): Promise<RtfValue> {return {position: await this.record([0, 0, 0, 0, 0])};}
  async object(): Promise<RtfValue> {return {position: await this.record([4, 0, 0, 0, 0])};}
  async string(value: TextRange): Promise<RtfValue> {return {position: await this.record([1, value.first, value.last, value.units, 0])};}
  async tag(name: typeof tags[number], content?: RtfValue): Promise<RtfValue> {
    return {position: await this.record([3, tags.indexOf(name), content?.position ?? 0, 0, 0])};
  }
  /** Fixed-size literal tuples only. Payload arrays grow through push; document
   * strings are streamed into BackedText and passed to string. */
  async value(value: Literal): Promise<RtfValue> {
    if (typeof value === "string") return this.string(await this.text.from([value]));
    if (value === null || typeof value === "number") {
      if (value !== null && !Number.isFinite(value)) throw new Error("RTF AST number must be finite");
      return {position: await this.record([2, value ?? NaN, 0, 0, 0])};
    }
    if ("position" in value) return value;
    const node = await this.array();
    for (const child of value) await this.push(node, await this.value(child));
    return node;
  }
  private async list(value: RtfValue): Promise<number[]> {
    const fields = await this.fields(value.position, 5);
    if (fields[0] !== 0 && fields[0] !== 4) throw new Error("Retained AST collection required");
    return fields;
  }
  async count(value: RtfValue): Promise<number> {return (await this.list(value))[3]!;}
  async push(array: RtfValue, value: RtfValue): Promise<void> {
    await this.cooperate();
    const fields = await this.list(array), last = fields[2]!;
    // Linked child records: previous, next, value. Shared subtrees retain their
    // own identity without sharing the links of the arrays that contain them.
    const child = await this.record([last, 0, value.position]);
    if (last) await this.put(last + 8, [child]); else fields[1] = child;
    fields[2] = child; fields[3] = fields[3]! + 1;
    await this.put(array.position, fields);
  }
  async edge(array: RtfValue, last = false): Promise<RtfValue | undefined> {
    const fields = await this.list(array), link = fields[last ? 2 : 1]!;
    return link ? {position: (await this.fields(link + 16, 1))[0]!} : undefined;
  }
  async remove(array: RtfValue, last = false): Promise<void> {
    const fields = await this.list(array), link = fields[last ? 2 : 1]!;
    if (!link) return;
    const record = await this.fields(link, 3), next = record[last ? 0 : 1]!;
    if (next) await this.put(next + (last ? 8 : 0), [0]);
    else fields[last ? 1 : 2] = 0;
    fields[last ? 2 : 1] = next; fields[3]!--;
    await this.put(array.position, fields);
  }
  async *children(array: RtfValue): AsyncGenerator<RtfValue> {
    let link = (await this.list(array))[1]!;
    while (link) {
      await this.cooperate();
      const fields = await this.fields(link, 3); yield {position: fields[2]!}; link = fields[1]!;
    }
  }
  async name(value: RtfValue): Promise<typeof tags[number] | undefined> {
    const fields = await this.fields(value.position, 2);
    return fields[0] === 3 ? tags[fields[1]!] : undefined;
  }
  async content(value: RtfValue): Promise<RtfValue | undefined> {
    const fields = await this.fields(value.position, 3);
    return fields[0] === 3 && fields[2] ? {position: fields[2]} : undefined;
  }
  async range(value: RtfValue): Promise<TextRange> {
    const fields = await this.fields(value.position, 4);
    if (fields[0] !== 1) throw new Error("RTF AST string required");
    return {first: fields[1]!, last: fields[2]!, units: fields[3]!};
  }
  async appendText(value: RtfValue, source: TextRange): Promise<void> {
    const target = await this.range(value);
    await this.text.append(target, source);
    await this.put(value.position + 8, [target.first, target.last, target.units]);
  }
  async kind(value: RtfValue): Promise<"array" | "string" | "literal" | "tag" | "object"> {
    return (["array", "string", "literal", "tag", "object"] as const)[(await this.fields(value.position, 1))[0]!]!;
  }
  async at(array: RtfValue, index: number): Promise<RtfValue | undefined> {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Invalid retained array index");
    let ordinal = 0; for await (const child of this.children(array)) if (ordinal++ === index) return child;
    return undefined;
  }
  async set(array: RtfValue, index: number, value: RtfValue): Promise<void> {
    if (!Number.isSafeInteger(index) || index < 0) throw new RangeError("Invalid retained array index");
    let link = (await this.list(array))[1]!;
    while (link && index--) {await this.cooperate(); link = (await this.fields(link + 8, 1))[0]!;}
    await this.cooperate();
    if (!link) throw new RangeError("Retained array index out of range");
    await this.put(link + 16, [value.position]);
  }
  async replaceTag(value: RtfValue, name: typeof tags[number], content?: RtfValue): Promise<void> {
    if (await this.kind(value) !== "tag") throw new Error("Retained tag required");
    await this.put(value.position, [3, tags.indexOf(name), content?.position ?? 0, 0, 0]);
  }
  /** Preorder edits become visible to traversal. A visitor can skip children or
   * substitute an expansion root without retaining per-depth JS continuations. */
  async walk(root: RtfValue, visit: (value: RtfValue, depth: number, leaving: boolean) => Promise<void | false | {descend: RtfValue}>): Promise<void> {
    let pending = await this.record([0, root.position, 0, 0]);
    const push = async (position: number, depth: number, leaving: number) => {pending = await this.record([pending, position, depth, leaving]);};
    while (pending) {
      const [next, position, depth, leaving] = await this.fields(pending, 4); pending = next!;
      await this.cooperate(); const value = {position: position!};
      const action = await visit(value, depth!, !!leaving);
      if (leaving) continue;
      await push(position!, depth!, 1);
      if (action === false) continue;
      if (action) {await push(action.descend.position, depth! + 1, 0); continue;}
      const fields = await this.fields(position!, 5);
      if (fields[0] === 3 && fields[2]) await push(fields[2], depth! + 1, 0);
      else if (fields[0] === 0 || fields[0] === 4) {
        let link = fields[2]!;
        while (link) {await this.cooperate(); const [previous, , child] = await this.fields(link, 3); await push(child!, depth! + 1, 0); link = previous!;}
      }
    }
  }
  /** Independent mutable copy, including text chains, using backed copy jobs. */
  async clone(root: RtfValue): Promise<RtfValue> {
    let pending = 0;
    const shallow = async (source: RtfValue): Promise<RtfValue> => {
      await this.cooperate(); const fields = await this.fields(source.position, 5), kind = fields[0]!;
      if (kind === 1) return this.string(await this.text.from(this.text.chunks(await this.range(source))));
      const target = {position: await this.record(kind === 0 || kind === 4 ? [kind, 0, 0, 0, 0] : kind === 3 ? [kind, fields[1]!, 0, 0, 0] : fields)};
      if (kind === 0 || kind === 3 || kind === 4) pending = await this.record([pending, source.position, target.position]);
      return target;
    };
    const result = await shallow(root);
    while (pending) {
      const [next, source, target] = await this.fields(pending, 3); pending = next!;
      const fields = await this.fields(source!, 5);
      if (fields[0] === 3 && fields[2]) await this.put(target! + 16, [(await shallow({position: fields[2]})).position]);
      else if (fields[0] !== 3) for await (const child of this.children({position: source!})) await this.push({position: target!}, await shallow(child));
    }
    return result;
  }
  /** Target tape must use a different store: its records are contiguous, while
   * this store also receives traversal frames during serialization. The optional
   * string observer transfers parser identities to their wire positions. */
  async write(value: RtfValue, target: BackedJson, onString?: (value: RtfValue, position: number) => Promise<void>): Promise<void> {
    let frame = 0;
    const begin = async (value: RtfValue) => {
      await this.cooperate();
      const fields = await this.fields(value.position, 5), kind = fields[0]!;
      if (kind === 0 || kind === 4) {
        await target.begin(kind === 0 ? "array" : "object"); frame = await this.record([frame, fields[1]!, kind === 4 ? 2 : 0]);
      } else if (kind === 3) {
        await target.begin("object"); await target.key("t"); await target.value(tags[fields[1]!]!);
        if (fields[2]) await target.key("c");
        frame = await this.record([frame, fields[2]!, 1]);
      } else if (kind === 1) {
        const position = await target.begin("string");
        await onString?.(value, position);
        for await (const text of this.text.chunks({first: fields[1]!, last: fields[2]!, units: fields[3]!})) await target.text(text);
        await target.end();
      } else await target.value(Number.isNaN(fields[1]!) ? null : fields[1]!);
    };
    await begin(value);
    while (frame) {
      await this.cooperate();
      const [parent, cursor, tag] = await this.fields(frame, 3);
      if (!cursor) {await target.end(); frame = parent!;}
      else if (tag === 1) {await this.put(frame + 8, [0]); await begin({position: cursor});}
      else if (tag === 2) {
        const child = await this.fields(cursor, 3), pair = {position: child[2]!};
        if (await this.count(pair) !== 2) throw new Error("Retained object entry requires a key/value pair");
        const key = (await this.edge(pair))!, value = (await this.edge(pair, true))!;
        await target.begin("key"); for await (const text of this.text.chunks(await this.range(key))) await target.text(text); await target.end();
        await this.put(frame + 8, [child[1]!]); await begin(value);
      }
      else {
        const child = await this.fields(cursor, 3);
        await this.put(frame + 8, [child[1]!]); await begin({position: child[2]!});
      }
    }
  }
}
