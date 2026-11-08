import type { XmlAttributeRecord, XmlAttributeRequest, XmlSourceSpan } from "@poe-code/safe-fs/core";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { XmlBudget } from "./limits.js";
import { StoredStringMap } from "./stored-map.js";

/** Ordered metadata links and two backed dictionaries replace the current tag's
 * arrays/maps. All records share the parser's source/frame page cache. */
export class StoredParserAttributes {
  constructor(private readonly storage: PagedStorage, private readonly budget: XmlBudget, private readonly sourceParts: (span: XmlSourceSpan) => AsyncIterable<string>) {}

  private async number(reference: number, offset = 0): Promise<number> {
    if (!reference) return 0;
    const bytes = await this.storage.read(reference + offset, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  }

  private async set(reference: number, offset: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.storage.write(reference + offset, bytes);
  }

  private async append(attribute: Omit<XmlAttributeRecord, "next" | "value"> & { nameKey?: number }): Promise<number> {
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
      const sourceParts = this.sourceParts;
      if (request.attributeOperation === "expanded" && request.namespace) {
        const { scope, prefix, prefixSource } = request.namespace;
        const namespaces = new StoredStringMap(this.storage, this.budget, scope.reference);
        const key = prefixSource ? await namespaces.storeString(sourceParts(prefixSource)) : prefix;
        const uri = prefix || prefixSource ? await namespaces.lookup(key) : undefined;
        const parts = (async function* () {
          if (uri !== undefined) yield* namespaces.valueParts(uri);
          yield "\0";
          if (request.nameSource) yield* sourceParts(request.nameSource); else yield request.name;
        })();
        const next = await values.set(parts, "1");
        request.found = next.reference === values.reference;
        if (!request.found) await this.set(store, offset, next.reference);
      } else {
        const key = request.nameSource ? await values.storeString(sourceParts(request.nameSource)) : request.name;
        request.found = await values.lookup(key) !== undefined;
        if (request.attributeOperation === "expanded" && !request.found) {
          const next = await values.set(key, "1");
          await this.set(store, offset, next.reference);
        }
      }
      return;
    }
    if (request.attributeOperation === "append") {
      const reference = store || await this.storage.append(new Uint8Array(32));
      const values = new StoredStringMap(this.storage, this.budget, await this.number(reference, 16));
      const nameKey = request.attribute.nameSource ? await values.storeString(this.sourceParts(request.attribute.nameSource)) : request.attribute.name;
      const existing = await values.lookup(nameKey);
      const updated = await values.set(nameKey, request.attribute.source ? "" : request.attribute.value);
      const { value: ignoredValue, ...metadata } = request.attribute;
      const attribute = await this.append({ ...metadata, ...(typeof nameKey === "number" ? { nameKey } : {}) });
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
      const metadata = JSON.parse(parts.join("")) as Omit<XmlAttributeRecord, "next" | "value"> & { nameKey?: number };
      const values = new StoredStringMap(this.storage, this.budget, await this.number(store, 16));
      const value = request.values && !metadata.source ? await values.get(metadata.nameKey ?? metadata.name) : "";
      if (value === undefined) throw new TypeError("Missing stored XML attribute value");
      const { nameKey: ignoredKey, ...attribute } = metadata;
      request.result = { ...attribute, value, next: await this.number(request.reference) };
    }
  }
}
