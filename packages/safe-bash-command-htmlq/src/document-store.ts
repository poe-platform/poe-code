import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { HtmlError, type HtmlAttribute, type HtmlNamespace, type HtmlNode } from "./contracts.js";

type Storage = Pick<PagedStorage, "allocate" | "append" | "read" | "write">;
const kinds: readonly HtmlNode["kind"][] = ["document", "fragment", "element", "text", "comment", "doctype"];
const namespaces: readonly HtmlNamespace[] = ["html", "svg", "mathml"];
const attributeNamespaces: readonly HtmlAttribute["namespace"][] = ["none", "xml", "xmlns", "xlink"];
const fields = ["name", "data", "parent", "first", "last", "previous", "next", "templateContents", "firstAttribute", "lastAttribute", "childCount", "attributeCount"] as const;
type Field = typeof fields[number];
export interface StoredHtmlNode extends Record<Field, number> {
  readonly id: number;
  readonly kind: HtmlNode["kind"];
  readonly namespace: HtmlNamespace;
}
export interface StoredHtmlAttribute {
  readonly id: number;
  readonly next: number;
  readonly name: number;
  readonly value: number;
  readonly namespace: HtmlAttribute["namespace"];
}

/** Fixed-width DOM records. Text fields are references to caller-backed text;
 * node identity is its storage offset, with no resident node registry. */
export class DocumentStore {
  private readonly nodes = new Map<number, StoredHtmlNode>();
  get residentNodes(): number { return this.nodes.size; }
  private retain(node: StoredHtmlNode): void {
    this.nodes.delete(node.id);
    if (this.nodes.size === 512) this.nodes.delete(this.nodes.keys().next().value!);
    this.nodes.set(node.id, node);
  }
  constructor(private readonly storage: Storage, private readonly cooperate?: () => void | Promise<void>) {}

  async create(kind: HtmlNode["kind"], values: Partial<Record<Field, number>> & { namespace?: HtmlNamespace } = {}): Promise<number> {
    const bytes = new Uint8Array(112), view = new DataView(bytes.buffer);
    view.setFloat64(0, kinds.indexOf(kind), true);
    view.setFloat64(8, namespaces.indexOf(values.namespace ?? "html"), true);
    for (const [index, field] of fields.entries()) view.setFloat64(16 + index * 8, values[field] ?? 0, true);
    return this.storage.append(bytes);
  }

  async read(id: number): Promise<StoredHtmlNode> {
    const checkpoint = this.cooperate?.();
    if (checkpoint) await checkpoint;
    if (!id) throw new HtmlError("E_OWNERSHIP", "Absent stored HTML node");
    const cached = this.nodes.get(id);
    if (cached) { this.retain(cached); return { ...cached }; }
    const bytes = await this.storage.read(id, 112), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const node = { id, kind: kinds[view.getFloat64(0, true)]!, namespace: namespaces[view.getFloat64(8, true)]! } as StoredHtmlNode;
    for (const [index, field] of fields.entries()) node[field] = view.getFloat64(16 + index * 8, true);
    this.retain(node);
    return { ...node };
  }

  async patch(id: number, values: Partial<Record<Field, number>>): Promise<void> {
    const node = { ...await this.read(id), ...values };
    const bytes = new Uint8Array(112), view = new DataView(bytes.buffer);
    view.setFloat64(0, kinds.indexOf(node.kind), true);
    view.setFloat64(8, namespaces.indexOf(node.namespace), true);
    for (const [index, field] of fields.entries()) view.setFloat64(16 + index * 8, node[field], true);
    this.nodes.delete(id);
    await this.storage.write(id, bytes);
    this.retain(node);
  }

  async detach(id: number): Promise<void> {
    const node = await this.read(id);
    if (!node.parent) return;
    const parent = await this.read(node.parent);
    if (node.previous) await this.patch(node.previous, { next: node.next });
    if (node.next) await this.patch(node.next, { previous: node.previous });
    await this.patch(parent.id, { first: parent.first === id ? node.next : parent.first,
      last: parent.last === id ? node.previous : parent.last, childCount: parent.childCount - 1 });
    await this.patch(id, { parent: 0, previous: 0, next: 0 });
  }

  async attach(parentId: number, id: number, before = 0): Promise<void> {
    if (before === id) return;
    if (before && (await this.read(before)).parent !== parentId)
      throw new HtmlError("E_OWNERSHIP", "Stored insertion reference has a different parent");
    await this.detach(id);
    const parent = await this.read(parentId);
    const previous = before ? (await this.read(before)).previous : parent.last;
    await this.patch(id, { parent: parentId, previous, next: before });
    if (previous) await this.patch(previous, { next: id });
    if (before) await this.patch(before, { previous: id });
    await this.patch(parentId, { first: previous ? parent.first : id,
      last: before ? parent.last : id, childCount: parent.childCount + 1 });
  }

  async *children(parent: number): AsyncGenerator<number> {
    let id = (await this.read(parent)).first;
    while (id) {
      const next = (await this.read(id)).next;
      yield id;
      id = next;
    }
  }

  async attribute(nodeId: number, name: number, value: number, namespace: HtmlAttribute["namespace"]): Promise<number> {
    const node = await this.read(nodeId), bytes = new Uint8Array(32), view = new DataView(bytes.buffer);
    view.setFloat64(8, name, true); view.setFloat64(16, value, true);
    view.setFloat64(24, attributeNamespaces.indexOf(namespace), true);
    const id = await this.storage.append(bytes);
    if (node.lastAttribute) {
      view.setFloat64(0, id, true);
      await this.storage.write(node.lastAttribute, bytes.subarray(0, 8));
    }
    await this.patch(nodeId, { firstAttribute: node.firstAttribute || id, lastAttribute: id, attributeCount: node.attributeCount + 1 });
    return id;
  }

  async *attributes(node: number): AsyncGenerator<StoredHtmlAttribute> {
    let id = (await this.read(node)).firstAttribute;
    while (id) {
      const bytes = await this.storage.read(id, 32), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const next = view.getFloat64(0, true);
      yield { id, next, name: view.getFloat64(8, true), value: view.getFloat64(16, true), namespace: attributeNamespaces[view.getFloat64(24, true)]! };
      id = next;
    }
  }

  async patchAttribute(id: number, name: number, namespace: HtmlAttribute["namespace"]): Promise<void> {
    const bytes = new Uint8Array(8), view = new DataView(bytes.buffer);
    view.setFloat64(0, name, true); await this.storage.write(id + 8, bytes);
    view.setFloat64(0, attributeNamespaces.indexOf(namespace), true); await this.storage.write(id + 24, bytes);
  }

  async replaceAttribute(id: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.storage.write(id + 16, bytes);
  }

  async clone(id: number): Promise<number> {
    const node = await this.read(id);
    const clone = await this.create(node.kind, { name: node.name, namespace: node.namespace });
    for await (const attribute of this.attributes(id))
      await this.attribute(clone, attribute.name, attribute.value, attribute.namespace);
    return clone;
  }
}

/** Random-access parser/snapshot references with a constant-sized copy window.
 * Capacity growth retains only numeric metadata and spills through shared pages. */
export class StoredSequence {
  private start = 0;
  private capacity = 0;
  private count = 0;
  private window: { offset: number; bytes: Uint8Array } | undefined;
  get residentBytes(): number { return this.window?.bytes.byteLength ?? 0; }
  constructor(private readonly storage: Storage) {}
  get length(): number { return this.count; }

  private async reserve(count: number): Promise<void> {
    if (count <= this.capacity) return;
    const capacity = Math.max(256, this.capacity * 2, count);
    const start = this.storage.allocate(capacity * 8);
    for (let offset = 0; offset < this.count * 8; offset += 16384)
      await this.storage.write(start + offset, await this.storage.read(this.start + offset, Math.min(16384, this.count * 8 - offset)));
    this.start = start; this.capacity = capacity; this.window = undefined;
  }

  async get(index: number): Promise<number | undefined> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count) return undefined;
    const offset = Math.floor(index / 2048) * 16384;
    if (this.window?.offset !== offset) this.window = { offset, bytes: await this.storage.read(this.start + offset, Math.min(16384, this.capacity * 8 - offset)) };
    const { bytes } = this.window;
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getFloat64(index * 8 - offset, true);
  }

  async set(index: number, value: number): Promise<void> {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.count) throw new RangeError("Invalid stored sequence index");
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.storage.write(this.start + index * 8, bytes);
    if (this.window && index * 8 >= this.window.offset && index * 8 < this.window.offset + this.window.bytes.length)
      this.window.bytes.set(bytes, index * 8 - this.window.offset);
  }

  async push(value: number): Promise<void> {
    await this.reserve(this.count + 1);
    this.count++;
    await this.set(this.count - 1, value);
  }

  async pop(): Promise<number | undefined> {
    if (!this.count) return undefined;
    const value = await this.get(this.count - 1);
    this.count--;
    return value;
  }

  async truncate(length: number): Promise<void> {
    if (!Number.isSafeInteger(length) || length < 0 || length > this.count) throw new RangeError("Invalid stored sequence length");
    this.count = length;
  }

  async indexOf(value: number, reverse = false): Promise<number> {
    for (let index = reverse ? this.count - 1 : 0; index >= 0 && index < this.count; index += reverse ? -1 : 1)
      if (await this.get(index) === value) return index;
    return -1;
  }

  async splice(index: number, remove: number, insert?: number): Promise<void> {
    if (!Number.isSafeInteger(index) || !Number.isSafeInteger(remove) || index < 0 || index > this.count || remove < 0)
      throw new RangeError("Invalid stored sequence splice");
    remove = Math.min(remove, this.count - index);
    const added = insert === undefined ? 0 : 1;
    const count = this.count - remove + added;
    await this.reserve(count);
    this.window = undefined;
    const source = (index + remove) * 8, destination = (index + added) * 8;
    const length = (this.count - index - remove) * 8;
    if (destination > source) {
      for (let remaining = length; remaining > 0;) {
        const size = Math.min(16384, remaining); remaining -= size;
        await this.storage.write(this.start + destination + remaining, await this.storage.read(this.start + source + remaining, size));
      }
    } else if (destination < source) {
      for (let offset = 0; offset < length; offset += 16384)
        await this.storage.write(this.start + destination + offset, await this.storage.read(this.start + source + offset, Math.min(16384, length - offset)));
    }
    this.count = count;
    if (insert !== undefined) await this.set(index, insert);
  }
}
