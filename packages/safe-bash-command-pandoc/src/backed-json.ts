import type {PagedStorage} from "safe-bash-io-engine/storage";

type Kind = "array" | "object" | "string" | "key" | "literal";
const kinds: readonly Kind[] = ["array", "object", "string", "key", "literal"];
const headerBytes = 32;
type Header = {kind: Kind; end: number; parent: number; children: number};
type Value = null | boolean | number | string | readonly Value[] | {[key: string]: Value};

/** A depth-first tree tape. Payloads, child counts, parent links and subtree
 * boundaries all live in caller storage; construction and traversal keep no
 * resident node index or depth-dependent stack. Strings retain UTF-16 code units
 * so JSON escaping preserves even unpaired surrogates. */
export class BackedJson {
  private root = 0;
  private current = 0;
  private complete = false;
  constructor(private readonly storage: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {}

  async describe(position: number): Promise<Header> {
    const bytes = await this.storage.read(position, headerBytes);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {kind: kinds[view.getFloat64(0, true)]!, end: view.getFloat64(8, true), parent: view.getFloat64(16, true), children: view.getFloat64(24, true)};
  }
  private async put(position: number, header: Header): Promise<void> {
    const bytes = new Uint8Array(headerBytes);
    const view = new DataView(bytes.buffer);
    view.setFloat64(0, kinds.indexOf(header.kind), true);
    view.setFloat64(8, header.end, true);
    view.setFloat64(16, header.parent, true);
    view.setFloat64(24, header.children, true);
    await this.storage.write(position, bytes);
  }

  async begin(kind: Kind): Promise<number> {
    await this.cooperate();
    if (this.complete || !this.current && this.root) throw new Error("Tree already complete");
    if (this.current) {
      const parent = await this.describe(this.current);
      if (parent.kind !== "array" && parent.kind !== "object") throw new Error("Scalar cannot contain children");
      const expectsKey = parent.kind === "object" && parent.children % 2 === 0;
      if ((kind === "key") !== expectsKey) throw new Error("Invalid object key/value order");
      parent.children++;
      await this.put(this.current, parent);
    } else if (kind === "key") throw new Error("Root cannot be an object key");
    const position = this.storage.allocate(headerBytes);
    await this.put(position, {kind, end: 0, parent: this.current, children: 0});
    this.root ||= position;
    this.current = position;
    return position;
  }

  async text(value: string): Promise<void> {
    const header = await this.describe(this.current);
    if (!["string", "key", "literal"].includes(header.kind)) throw new Error("Text requires a scalar");
    for (let start = 0; start < value.length; start += 4096) {
      const length = Math.min(4096, value.length - start);
      const bytes = new Uint8Array(length * 2);
      const view = new DataView(bytes.buffer);
      for (let index = 0; index < length; index++) view.setUint16(index * 2, value.charCodeAt(start + index), true);
      await this.storage.append(bytes);
      await this.cooperate(length);
    }
  }

  async end(): Promise<number> {
    await this.cooperate();
    if (!this.current) throw new Error("No open tree node");
    const header = await this.describe(this.current);
    if (header.kind === "object" && header.children % 2) throw new Error("Object key has no value");
    header.end = this.storage.allocate(0);
    await this.put(this.current, header);
    this.current = header.parent;
    if (!this.current) this.complete = true;
    return this.current;
  }

  /** Compare stored scalar code units without collecting either token. */
  async equalText(left: number, right: number): Promise<boolean> {
    const a = await this.describe(left), b = await this.describe(right);
    const length = a.end - left - headerBytes;
    if (length !== b.end - right - headerBytes) return false;
    for (let offset = 0; offset < length; offset += 8192) {
      const count = Math.min(8192, length - offset);
      const first = await this.storage.read(left + headerBytes + offset, count);
      const second = await this.storage.read(right + headerBytes + offset, count);
      await this.cooperate(count / 2);
      for (let index = 0; index < count; index++) if (first[index] !== second[index]) return false;
    }
    return true;
  }

  async key(value: string): Promise<void> {
    await this.begin("key");
    await this.text(value);
    await this.end();
  }

  /** Convenience for already-resident, small literal subtrees. Large structures
   * use begin/text/end directly and never require a JavaScript tree. */
  async value(value: Value): Promise<void> {
    if (value !== null && typeof value === "object") {
      if (Array.isArray(value)) {
        await this.begin("array");
        for (const child of value) await this.value(child);
      } else {
        await this.begin("object");
        for (const key of Object.keys(value)) {
          await this.key(key);
          await this.value((value as {[key: string]: Value})[key]!);
        }
      }
    } else {
      if (typeof value === "number" && !Number.isFinite(value)) throw new Error("JSON number must be finite");
      await this.begin(typeof value === "string" ? "string" : "literal");
      await this.text(typeof value === "string" ? value : JSON.stringify(value));
    }
    await this.end();
  }

  /** Read a completed scalar without materializing its contents. */
  async *scalarChunks(position: number): AsyncGenerator<string> {
    const header = await this.describe(position);
    if (!header.end || header.kind === "array" || header.kind === "object") throw new Error("Expected a completed scalar");
    yield* this.textChunks(position + headerBytes, header.end);
  }

  private async *textChunks(position: number, end: number): AsyncGenerator<string> {
    for (let offset = position; offset < end; offset += 8192) {
      const bytes = await this.storage.read(offset, Math.min(8192, end - offset));
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      let text = "";
      for (let index = 0; index < bytes.length; index += 2) text += String.fromCharCode(view.getUint16(index, true));
      await this.cooperate(bytes.length / 2);
      yield text;
    }
  }

  async *chunks(): AsyncGenerator<Uint8Array> {
    if (!this.complete) throw new Error("Tree is incomplete");
    const encoder = new TextEncoder();
    let output = "";
    function* add(text: string): Generator<Uint8Array> {
      output += text;
      if (output.length >= 4096) {yield encoder.encode(output); output = "";}
    }
    const surrogate = (char: string) => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    let position = this.root;
    let closing = false;
    while (position) {
      await this.cooperate();
      const header = await this.describe(position);
      if (!closing) {
        if (header.parent) {
          const parent = await this.describe(header.parent);
          if (parent.kind === "object" && header.kind !== "key") yield* add(":");
          else if (position !== header.parent + headerBytes) yield* add(",");
        }
        if (header.kind === "array" || header.kind === "object") {
          yield* add(header.kind === "array" ? "[" : "{");
          if (header.end > position + headerBytes) {position += headerBytes; continue;}
          yield* add(header.kind === "array" ? "]" : "}");
        } else if (header.kind === "literal") {
          for await (const text of this.textChunks(position + headerBytes, header.end)) yield* add(text);
        } else {
          yield* add('"');
          let high = "";
          for await (const text of this.textChunks(position + headerBytes, header.end)) {
            for (let index = 0; index < text.length; index++) {
              const char = text[index]!, code = text.charCodeAt(index);
              if (high && code >= 0xdc00 && code <= 0xdfff) {
                output += high + char; high = "";
              } else {
                if (high) {output += surrogate(high); high = "";}
                if (code >= 0xd800 && code <= 0xdbff) high = char;
                else if (code >= 0xdc00 && code <= 0xdfff) output += surrogate(char);
                else output += code < 32 || char === '"' || char === "\\" ? JSON.stringify(char).slice(1, -1) : char;
              }
              if (output.length >= 4096) {yield encoder.encode(output); output = "";}
            }
          }
          if (high) yield* add(surrogate(high));
          yield* add('"');
        }
      }
      if (!header.parent) break;
      const parent = await this.describe(header.parent);
      if (header.end < parent.end) {position = header.end; closing = false;}
      else {
        yield* add(parent.kind === "array" ? "]" : "}");
        position = header.parent;
        closing = true;
      }
    }
    if (output) yield encoder.encode(output);
  }
}
