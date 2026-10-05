import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { XmlBudget } from "./limits.js";

type Entry = { key: number; value: number; left: number; right: number; height: number };

/** Immutable AVL maps share unchanged subtrees in caller storage. AVL ancestry
 * is bounded by safe-integer storage addresses (fewer than 80 levels), rather
 * than XML depth or the number of entries. Tree records share separate token
 * bodies, so traversal and rotations never materialize unrelated strings.
 * get() and iteration still return complete strings for their consumers. */
export class StoredStringMap {
  constructor(private readonly storage: PagedStorage, private readonly budget: XmlBudget, readonly reference = 0) {}

  private async read(reference: number): Promise<Entry> {
    const bytes = await this.storage.read(reference, 40);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return { key: view.getFloat64(0, true), value: view.getFloat64(8, true),
      left: view.getFloat64(16, true), right: view.getFloat64(24, true), height: view.getFloat64(32, true) };
  }

  private async write(entry: Entry): Promise<number> {
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    view.setFloat64(0, entry.key, true); view.setFloat64(8, entry.value, true);
    view.setFloat64(16, entry.left, true); view.setFloat64(24, entry.right, true); view.setFloat64(32, entry.height, true);
    return this.storage.append(bytes);
  }

  async storeString(parts: Iterable<string> | AsyncIterable<string>): Promise<number> {
    const header = new Uint8Array(8), reference = await this.storage.append(header);
    let size = 0;
    // Consume one borrowed fragment at a time; tree records retain only this handle.
    for await (const value of parts) for (let offset = 0; offset < value.length; offset += 4096) {
      const length = Math.min(4096, value.length - offset), bytes = new Uint8Array(length * 2);
      const view = new DataView(bytes.buffer);
      const checkpoint = this.budget.tick(length); if (checkpoint) await checkpoint;
      for (let index = 0; index < length; index++) view.setUint16(index * 2, value.charCodeAt(offset + index), true);
      await this.storage.append(bytes); size += length;
    }
    new DataView(header.buffer).setFloat64(0, size, true);
    await this.storage.write(reference, header);
    return reference;
  }

  async compare(value: string | number, reference: number): Promise<number> {
    const header = await this.storage.read(reference, 8);
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    const valueHeader = typeof value === "number" ? await this.storage.read(value, 8) : undefined;
    const valueLength = valueHeader ? new DataView(valueHeader.buffer, valueHeader.byteOffset, 8).getFloat64(0, true) : (value as string).length;
    const common = Math.min(length, valueLength);
    for (let offset = 0; offset < common; offset += 4096) {
      const count = Math.min(4096, common - offset);
      const checkpoint = this.budget.tick(count); if (checkpoint) await checkpoint;
      const bytes = await this.storage.read(reference + 8 + offset * 2, count * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const other = typeof value === "number" ? await this.storage.read(value + 8 + offset * 2, count * 2) : undefined;
      const otherView = other ? new DataView(other.buffer, other.byteOffset, other.byteLength) : undefined;
      for (let index = 0; index < count; index++) {
        const difference = (otherView ? otherView.getUint16(index * 2, true) : (value as string).charCodeAt(offset + index)) - view.getUint16(index * 2, true);
        if (difference) return difference;
      }
    }
    return valueLength - length;
  }

  async *valueParts(reference: number): AsyncGenerator<string> {
    const header = await this.storage.read(reference, 8);
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    for (let offset = 0; offset < length;) {
      let count = Math.min(4096, length - offset);
      const checkpoint = this.budget.tick(count); if (checkpoint) await checkpoint;
      const bytes = await this.storage.read(reference + 8 + offset * 2, count * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const last = view.getUint16((count - 1) * 2, true);
      if (offset + count < length && last >= 0xd800 && last <= 0xdbff) count--;
      const units = new Uint16Array(count);
      for (let index = 0; index < count; index++) units[index] = view.getUint16(index * 2, true);
      yield String.fromCharCode(...units);
      offset += count;
    }
  }

  private async string(reference: number): Promise<string> {
    const parts: string[] = [];
    for await (const part of this.valueParts(reference)) parts.push(part);
    return parts.join("");
  }

  /** Compare handles from this storage, or a short literal, without buffered values. */
  async equals(reference: number, other: number | string): Promise<boolean> {
    if (typeof other === "string") return (await this.compare(other, reference)) === 0;
    if (reference === other) return true;
    const leftHeader = await this.storage.read(reference, 8), rightHeader = await this.storage.read(other, 8);
    const length = new DataView(leftHeader.buffer, leftHeader.byteOffset, 8).getFloat64(0, true);
    if (length !== new DataView(rightHeader.buffer, rightHeader.byteOffset, 8).getFloat64(0, true)) return false;
    for (let offset = 0; offset < length * 2; offset += 8192) {
      const size = Math.min(8192, length * 2 - offset);
      const checkpoint = this.budget.tick(size); if (checkpoint) await checkpoint;
      const left = await this.storage.read(reference + 8 + offset, size), right = await this.storage.read(other + 8 + offset, size);
      for (let index = 0; index < size; index++) if (left[index] !== right[index]) return false;
    }
    return true;
  }

  /** Locate a value without loading it; callers testing membership need only its reference. */
  async lookup(key: string): Promise<number | undefined> {
    let reference = this.reference;
    while (reference) {
      const checkpoint = this.budget.tick(1); if (checkpoint) await checkpoint;
      const entry = await this.read(reference), order = await this.compare(key, entry.key);
      if (!order) return entry.value;
      reference = order < 0 ? entry.left : entry.right;
    }
    return undefined;
  }

  async get(key: string): Promise<string | undefined> {
    const reference = await this.lookup(key);
    return reference === undefined ? undefined : this.string(reference);
  }

  private async height(reference: number): Promise<number> {
    return reference ? (await this.read(reference)).height : 0;
  }

  private async updated(entry: Entry): Promise<number> {
    return this.write({ ...entry, height: 1 + Math.max(await this.height(entry.left), await this.height(entry.right)) });
  }

  private async rotate(entry: Entry, left: boolean): Promise<number> {
    const pivot = await this.read(left ? entry.right : entry.left);
    const child = await this.updated(left ? { ...entry, right: pivot.left } : { ...entry, left: pivot.right });
    return this.updated(left ? { ...pivot, left: child } : { ...pivot, right: child });
  }

  private async balance(entry: Entry): Promise<number> {
    const difference = await this.height(entry.left) - await this.height(entry.right);
    if (difference > 1) {
      const child = await this.read(entry.left);
      if (await this.height(child.left) < await this.height(child.right)) entry = { ...entry, left: await this.rotate(child, true) };
      return this.rotate(entry, false);
    }
    if (difference < -1) {
      const child = await this.read(entry.right);
      if (await this.height(child.right) < await this.height(child.left)) entry = { ...entry, right: await this.rotate(child, false) };
      return this.rotate(entry, true);
    }
    return this.updated(entry);
  }

  async set(key: string | AsyncIterable<string>, value: string | AsyncIterable<string> | { reference: number }): Promise<StoredStringMap> {
    const storedKey = typeof key === "string" ? key : await this.storeString(key);
    const suppliedReference = typeof value === "string" ? undefined : "reference" in value ? value.reference : await this.storeString(value);
    const insert = async (reference: number): Promise<number> => {
      if (!reference) return this.write({ key: typeof storedKey === "number" ? storedKey : await this.storeString([storedKey]), value: suppliedReference ?? await this.storeString([value as string]), left: 0, right: 0, height: 1 });
      const entry = await this.read(reference);
      const checkpoint = this.budget.tick(1); if (checkpoint) await checkpoint;
      const order = await this.compare(storedKey, entry.key);
      if (!order) return await this.equals(entry.value, suppliedReference ?? value as string) ? reference
        : this.write({ ...entry, value: suppliedReference ?? await this.storeString([value as string]) });
      const side = order < 0 ? "left" : "right";
      const child = await insert(entry[side]);
      return child === entry[side] ? reference : this.balance({ ...entry, [side]: child });
    };
    return new StoredStringMap(this.storage, this.budget, await insert(this.reference));
  }

  async *references(): AsyncGenerator<readonly [string, number]> {
    const visit = async function* (scope: StoredStringMap, reference: number): AsyncGenerator<readonly [string, number]> {
      if (!reference) return;
      const entry = await scope.read(reference);
      yield* visit(scope, entry.left);
      yield [await scope.string(entry.key), entry.value];
      yield* visit(scope, entry.right);
    };
    yield* visit(this, this.reference);
  }
  async *[Symbol.asyncIterator](): AsyncGenerator<readonly [string, string]> {
    for await (const [key, reference] of this.references()) yield [key, await this.string(reference)];
  }

}
