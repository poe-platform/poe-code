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

  private async storeString(value: string): Promise<number> {
    const header = new Uint8Array(8); new DataView(header.buffer).setFloat64(0, value.length, true);
    const reference = await this.storage.append(header);
    // UTF-16 units preserve JS ordering and lone surrogates without a second full string.
    for (let offset = 0; offset < value.length; offset += 4096) {
      const length = Math.min(4096, value.length - offset), bytes = new Uint8Array(length * 2);
      const view = new DataView(bytes.buffer);
      const checkpoint = this.budget.tick(length); if (checkpoint) await checkpoint;
      for (let index = 0; index < length; index++) view.setUint16(index * 2, value.charCodeAt(offset + index), true);
      await this.storage.append(bytes);
    }
    return reference;
  }

  private async compare(value: string, reference: number): Promise<number> {
    const header = await this.storage.read(reference, 8);
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    const common = Math.min(length, value.length);
    for (let offset = 0; offset < common; offset += 4096) {
      const count = Math.min(4096, common - offset);
      const checkpoint = this.budget.tick(count); if (checkpoint) await checkpoint;
      const bytes = await this.storage.read(reference + 8 + offset * 2, count * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      for (let index = 0; index < count; index++) {
        const difference = value.charCodeAt(offset + index) - view.getUint16(index * 2, true);
        if (difference) return difference;
      }
    }
    return value.length - length;
  }

  private async string(reference: number): Promise<string> {
    const header = await this.storage.read(reference, 8);
    const length = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    const parts: string[] = [];
    for (let offset = 0; offset < length; offset += 4096) {
      const count = Math.min(4096, length - offset);
      const checkpoint = this.budget.tick(count); if (checkpoint) await checkpoint;
      const bytes = await this.storage.read(reference + 8 + offset * 2, count * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), units = new Uint16Array(count);
      for (let index = 0; index < count; index++) units[index] = view.getUint16(index * 2, true);
      parts.push(String.fromCharCode(...units));
    }
    return parts.join("");
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

  async set(key: string, value: string): Promise<StoredStringMap> {
    const insert = async (reference: number): Promise<number> => {
      if (!reference) return this.write({ key: await this.storeString(key), value: await this.storeString(value), left: 0, right: 0, height: 1 });
      const entry = await this.read(reference);
      const checkpoint = this.budget.tick(1); if (checkpoint) await checkpoint;
      const order = await this.compare(key, entry.key);
      if (!order) return (await this.compare(value, entry.value)) === 0 ? reference : this.write({ ...entry, value: await this.storeString(value) });
      const side = order < 0 ? "left" : "right";
      const child = await insert(entry[side]);
      return child === entry[side] ? reference : this.balance({ ...entry, [side]: child });
    };
    return new StoredStringMap(this.storage, this.budget, await insert(this.reference));
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<readonly [string, string]> {
    const visit = async function* (scope: StoredStringMap, reference: number): AsyncGenerator<readonly [string, string]> {
      if (!reference) return;
      const entry = await scope.read(reference);
      yield* visit(scope, entry.left);
      yield [await scope.string(entry.key), await scope.string(entry.value)];
      yield* visit(scope, entry.right);
    };
    yield* visit(this, this.reference);
  }
}
