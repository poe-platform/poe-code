import type { XmlAttributeRecord, XmlAttributeRequest } from "@poe-code/safe-fs/core";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { XmlBudget } from "./limits.js";
import { StoredStringMap } from "./stored-map.js";

/** Ordered metadata links and two backed dictionaries replace the current tag's
 * arrays/maps. All records share the parser's source/frame page cache. */
export class StoredParserAttributes {
  constructor(private readonly storage: PagedStorage, private readonly budget: XmlBudget) {}

  private async number(reference: number, offset = 0): Promise<number> {
    if (!reference) return 0;
    const bytes = await this.storage.read(reference + offset, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }

  private async set(reference: number, offset: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.storage.write(reference + offset, bytes);
  }

  private async append(attribute: Omit<XmlAttributeRecord, "next" | "value">): Promise<number> {
    const source = JSON.stringify(attribute), encoder = new TextEncoder();
    const reference = await this.storage.append(new Uint8Array(16));
    let size = 0;
    for (let offset = 0; offset < source.length;) {
      let end = Math.min(source.length, offset + 4096);
      const last = source.charCodeAt(end - 1);
      if (end < source.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(source.slice(offset, end));
      const checkpoint = this.budget.tick(bytes.length); if (checkpoint) await checkpoint;
      await this.storage.append(bytes); size += bytes.length; offset = end;
    }
    await this.set(reference, 8, size);
    return reference;
  }

  async execute(request: XmlAttributeRequest): Promise<void> {
    const store = request.state.reference;
    if (request.attributeOperation === "has" || request.attributeOperation === "expanded") {
      const offset = request.attributeOperation === "has" ? 16 : 24;
      const values = new StoredStringMap(this.storage, this.budget, await this.number(store, offset));
      request.found = await values.lookup(request.name) !== undefined;
      if (request.attributeOperation === "expanded" && !request.found) {
        const next = await values.set(request.name, "1");
        await this.set(store, offset, next.reference);
      }
      return;
    }
    if (request.attributeOperation === "append") {
      const reference = store || await this.storage.append(new Uint8Array(32));
      const values = new StoredStringMap(this.storage, this.budget, await this.number(reference, 16));
      const existing = await values.lookup(request.attribute.name);
      const updated = await values.set(request.attribute.name, request.attribute.source ? "" : request.attribute.value);
      const { value: ignoredValue, ...metadata } = request.attribute;
      const attribute = await this.append(metadata);
      const last = await this.number(reference, 8);
      if (last) await this.set(last, 0, attribute); else await this.set(reference, 0, attribute);
      await this.set(reference, 8, attribute); await this.set(reference, 16, updated.reference);
      request.result = { reference, first: request.state.first || attribute, length: request.state.length + 1,
        size: request.state.size + (existing === undefined ? 1 : 0) };
      return;
    }
    if (request.attributeOperation === "read") {
      const size = await this.number(request.reference, 8), decoder = new TextDecoder(), parts: string[] = [];
      for (let offset = 0; offset < size; offset += 16384) {
        const length = Math.min(16384, size - offset);
        const checkpoint = this.budget.tick(length); if (checkpoint) await checkpoint;
        parts.push(decoder.decode(await this.storage.read(request.reference + 16 + offset, length), { stream: true }));
      }
      parts.push(decoder.decode());
      const metadata = JSON.parse(parts.join("")) as Omit<XmlAttributeRecord, "next" | "value">;
      const values = new StoredStringMap(this.storage, this.budget, await this.number(store, 16));
      const value = request.values && !metadata.source ? await values.get(metadata.name) : "";
      if (value === undefined) throw new TypeError("Missing stored XML attribute value");
      request.result = { ...metadata, value, next: await this.number(request.reference) };
    }
  }
}
