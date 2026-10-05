import type { StoredAttribute as XmlAttribute } from "./stored-document.js";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { XmlBudget } from "./limits.js";

/** Stable bottom-up merge sort over caller-backed links. The document owns the
 * storage lifetime; only the two current comparison values are resident. */
export class StoredAttributes {
  private head = 0;
  private tail = 0;
  constructor(private readonly storage: PagedStorage, private readonly budget: XmlBudget) {}

  async append(value: XmlAttribute): Promise<void> {
    const source = JSON.stringify(value), encoder = new TextEncoder();
    const header = new Uint8Array(16);
    const reference = await this.storage.append(header);
    let size = 0;
    for (let offset = 0; offset < source.length;) {
      let end = Math.min(source.length, offset + 4096);
      const last = source.charCodeAt(end - 1);
      if (end < source.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(source.slice(offset, end));
      const checkpoint = this.budget.tick(bytes.length); if (checkpoint) await checkpoint;
      await this.storage.append(bytes);
      size += bytes.length; offset = end;
    }
    new DataView(header.buffer).setFloat64(8, size, true);
    await this.storage.write(reference, header);
    if (this.tail) await this.link(this.tail, reference); else this.head = reference;
    this.tail = reference;
  }

  private async link(reference: number, next: number): Promise<void> {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, next, true);
    await this.storage.write(reference, bytes);
  }

  private async next(reference: number): Promise<number> {
    const bytes = await this.storage.read(reference, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }

  private async value(reference: number): Promise<XmlAttribute> {
    const bytes = await this.storage.read(reference + 8, 8);
    const size = new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
    const checkpoint = this.budget.tick(size); if (checkpoint) await checkpoint;
    const decoder = new TextDecoder(), parts: string[] = [];
    for (let offset = 0; offset < size; offset += 16384)
      parts.push(decoder.decode(await this.storage.read(reference + 16 + offset, Math.min(16384, size - offset)), { stream: true }));
    parts.push(decoder.decode());
    return JSON.parse(parts.join("")) as XmlAttribute;
  }

  async sort(compare: (left: XmlAttribute, right: XmlAttribute) => number | Promise<number>): Promise<void> {
    for (let width = 1; this.head; width *= 2) {
      let left = this.head, head = 0, tail = 0, merges = 0;
      while (left) {
        merges++;
        let right = left, leftCount = 0, rightCount = width;
        for (; leftCount < width && right; leftCount++) right = await this.next(right);
        let leftValue: XmlAttribute | undefined, rightValue: XmlAttribute | undefined;
        while (leftCount || rightCount && right) {
          const checkpoint = this.budget.tick(); if (checkpoint) await checkpoint;
          let takeLeft = false;
          if (leftCount) {
            if (!rightCount || !right) takeLeft = true;
            else {
              leftValue ??= await this.value(left);
              rightValue ??= await this.value(right);
              const work = this.budget.tick(leftValue.namespace.length + leftValue.localName.length + rightValue.namespace.length + rightValue.localName.length + 1);
              if (work) await work;
              takeLeft = await compare(leftValue, rightValue) <= 0;
            }
          }
          let selected: number;
          if (takeLeft) {
            selected = left; left = await this.next(left); leftCount--; leftValue = undefined;
          } else {
            selected = right; right = await this.next(right); rightCount--; rightValue = undefined;
          }
          if (tail) await this.link(tail, selected); else head = selected;
          tail = selected;
        }
        left = right;
      }
      await this.link(tail, 0);
      this.head = head; this.tail = tail;
      if (merges <= 1) break;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<XmlAttribute> {
    for (let reference = this.head; reference; reference = await this.next(reference)) yield await this.value(reference);
  }
}
