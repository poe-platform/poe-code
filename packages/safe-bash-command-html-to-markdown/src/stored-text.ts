import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { ByteSink } from "safe-bash-contracts";
import { htmlSpace } from "./text.js";

interface TextNode {
  readonly left: number;
  readonly right: number;
  readonly data: number;
  readonly bytes: number;
  readonly length: number;
  readonly height: number;
  readonly points: number;
}
const empty: TextNode = { left: 0, right: 0, data: 0, bytes: 0, length: 0, height: 0, points: 0 };

/** Immutable balanced text ropes. Payloads and tree nodes share caller storage;
 * references are offsets, and traversal needs only a logarithmic stack. */
export class TextStore {
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder("utf-8", { ignoreBOM: true });
  constructor(private readonly storage: Pick<PagedStorage, "append" | "read">, private readonly cooperate?: (characters: number) => void | Promise<void>) {}

  async info(root: number): Promise<TextNode> {
    if (!root) return empty;
    const bytes = await this.storage.read(root, 56);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { left: view.getFloat64(0, true), right: view.getFloat64(8, true), data: view.getFloat64(16, true),
      bytes: view.getFloat64(24, true), length: view.getFloat64(32, true), height: view.getFloat64(40, true), points: view.getFloat64(48, true) };
  }

  private node(node: TextNode): Promise<number> {
    if (!Number.isSafeInteger(node.length) || !Number.isSafeInteger(node.bytes)) throw new RangeError("HTML text size overflow");
    const bytes = new Uint8Array(56), view = new DataView(bytes.buffer);
    for (const [index, value] of [node.left, node.right, node.data, node.bytes, node.length, node.height, node.points].entries()) view.setFloat64(index * 8, value, true);
    return this.storage.append(bytes);
  }

  private async branch(left: number, right: number): Promise<number> {
    if (!left || !right) return left || right;
    const a = await this.info(left), b = await this.info(right);
    return this.node({ left, right, data: 0, bytes: a.bytes + b.bytes, length: a.length + b.length, height: Math.max(a.height, b.height) + 1, points: a.points + b.points });
  }

  /** Persistent AVL join shares operands rather than copying their text. */
  async concat(left: number, right: number): Promise<number> {
    if (!left || !right) return left || right;
    const a = await this.info(left), b = await this.info(right);
    if (a.height > b.height + 1) return this.balance(a.left, await this.concat(a.right, right));
    if (b.height > a.height + 1) return this.balance(await this.concat(left, b.left), b.right);
    return this.branch(left, right);
  }

  private async balance(left: number, right: number): Promise<number> {
    const a = await this.info(left), b = await this.info(right);
    if (a.height > b.height + 1) {
      const outer = await this.info(a.left), inner = await this.info(a.right);
      if (outer.height >= inner.height) return this.branch(a.left, await this.branch(a.right, right));
      return this.branch(await this.branch(a.left, inner.left), await this.branch(inner.right, right));
    }
    if (b.height > a.height + 1) {
      const inner = await this.info(b.left), outer = await this.info(b.right);
      if (outer.height >= inner.height) return this.branch(await this.branch(left, b.left), b.right);
      return this.branch(await this.branch(left, inner.left), await this.branch(inner.right, b.right));
    }
    return this.branch(left, right);
  }

  async from(text: string): Promise<number> {
    let root = 0;
    for (let offset = 0; offset < text.length;) {
      let end = Math.min(offset + 2048, text.length);
      const last = text.charCodeAt(end - 1);
      if (end < text.length && last >= 0xd800 && last <= 0xdbff) end--;
      const chunk = text.slice(offset, end), bytes = this.encoder.encode(chunk);
      await this.cooperate?.(chunk.length);
      const data = await this.storage.append(bytes);
      root = await this.concat(root, await this.node({ left: 0, right: 0, data, bytes: bytes.length, length: chunk.length, height: 1, points: Array.from(chunk).length }));
      offset = end;
    }
    return root;
  }

  async *chunks(root: number, reverse = false): AsyncGenerator<string> {
    const pending = root ? [root] : [];
    while (pending.length) {
      const node = await this.info(pending.pop()!);
      if (node.data) {
        await this.cooperate?.(node.length);
        yield this.decoder.decode(await this.storage.read(node.data, node.bytes));
      }
      else if (reverse) pending.push(node.left, node.right);
      else pending.push(node.right, node.left);
    }
  }

  async *characters(root: number): AsyncGenerator<string> {
    for await (const chunk of this.chunks(root)) yield* chunk;
  }

  async at(root: number, index: number): Promise<string | undefined> {
    const original = await this.info(root);
    if (index < 0) index += original.length;
    if (index < 0 || index >= original.length) return undefined;
    while (root) {
      const node = await this.info(root);
      if (node.data) return this.decoder.decode(await this.storage.read(node.data, node.bytes))[index];
      const left = await this.info(node.left);
      if (index < left.length) root = node.left;
      else { index -= left.length; root = node.right; }
    }
    return undefined;
  }

  /** Locate a Unicode scalar by rank without materializing preceding text. */
  async pointOffset(root: number, index: number): Promise<number> {
    const original = await this.info(root);
    if (!Number.isSafeInteger(index) || index < 0 || index > original.points) throw new RangeError("Invalid scalar offset");
    let offset = 0;
    while (root) {
      const node = await this.info(root);
      if (index === node.points) return offset + node.length;
      if (node.data) {
        for (const character of this.decoder.decode(await this.storage.read(node.data, node.bytes))) {
          if (index-- === 0) break;
          offset += character.length;
        }
        return offset;
      }
      const left = await this.info(node.left);
      if (index < left.points) root = node.left;
      else { offset += left.length; index -= left.points; root = node.right; }
    }
    return offset;
  }

  async slice(root: number, start: number, end = Number.MAX_SAFE_INTEGER): Promise<number> {
    const node = await this.info(root);
    start = Math.max(0, Math.min(start, node.length));
    end = Math.max(start, Math.min(end, node.length));
    if (start === end) return 0;
    if (start === 0 && end === node.length) return root;
    if (node.data) return this.from(this.decoder.decode(await this.storage.read(node.data, node.bytes)).slice(start, end));
    const left = await this.info(node.left);
    return this.concat(await this.slice(node.left, start, end), await this.slice(node.right, Math.max(0, start - left.length), Math.max(0, end - left.length)));
  }

  async repeat(root: number, count: number): Promise<number> {
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError("Invalid HTML text repetition");
    let result = 0;
    while (count > 0) {
      if (count % 2) result = await this.concat(result, root);
      count = Math.floor(count / 2);
      if (count) root = await this.concat(root, root);
    }
    return result;
  }

  async trim(root: number): Promise<number> {
    let first = 0, last = (await this.info(root)).length;
    outer: for await (const chunk of this.chunks(root)) for (const character of chunk) {
      if (!htmlSpace(character)) break outer;
      first++;
    }
    if (first === last) return 0;
    outer: for await (const chunk of this.chunks(root, true)) for (let index = chunk.length - 1; index >= 0; index--) {
      if (!htmlSpace(chunk[index])) break outer;
      last--;
    }
    return this.slice(root, first, last);
  }

  async normalize(root: number, mode: "space" | "lines" | "inline"): Promise<number> {
    const result = this.builder();
    let space = false, carriage = false;
    for await (const chunk of this.chunks(root)) {
      let output = "";
      for (const character of chunk) {
        if (mode === "lines" && carriage && character === "\n") { carriage = false; continue; }
        carriage = false;
        if (mode === "space" && htmlSpace(character)) {
          if (!space) output += " ";
          space = true;
        } else {
          space = false;
          if (mode === "lines" && character === "\r") { output += "\n"; carriage = true; }
          else output += mode === "inline" && character === "\n" ? " " : character;
        }
      }
      await result.write(output);
    }
    return result.finish();
  }

  async includes(root: number, needle: string): Promise<boolean> {
    if (!needle) return true;
    let tail = "";
    for await (const chunk of this.chunks(root)) {
      const text = tail + chunk;
      if (text.includes(needle)) return true;
      tail = text.slice(-Math.max(0, needle.length - 1));
      if (needle.length === 1) tail = "";
    }
    return false;
  }

  async write(root: number, sink: ByteSink): Promise<void> {
    for await (const chunk of this.chunks(root)) await sink.write(this.encoder.encode(chunk));
  }

  builder(): TextBuilder { return new TextBuilder(this); }
}

/** The only mutable text buffer is at most 2048 UTF-16 code units. */
export class TextBuilder {
  private root = 0;
  private pending = "";
  constructor(private readonly text: TextStore) {}
  async write(value: string): Promise<void> {
    for (let offset = 0; offset < value.length;) {
      const count = Math.min(2048 - this.pending.length, value.length - offset);
      this.pending += value.slice(offset, offset + count);
      offset += count;
      if (this.pending.length === 2048) {
        const last = this.pending.charCodeAt(2047), keep = last >= 0xd800 && last <= 0xdbff;
        this.root = await this.text.concat(this.root, await this.text.from(keep ? this.pending.slice(0, -1) : this.pending));
        this.pending = keep ? this.pending.at(-1)! : "";
      }
    }
  }
  async append(root: number): Promise<void> {
    if (!root) return;
    this.root = await this.text.concat(await this.finish(), root);
  }
  async finish(): Promise<number> {
    if (this.pending) {
      this.root = await this.text.concat(this.root, await this.text.from(this.pending));
      this.pending = "";
    }
    return this.root;
  }
}
