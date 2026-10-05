import type { PagedStorage } from "@poe-code/safe-fs/storage";
import type { XmlBudget } from "./limits.js";

type Entry = { prefix: string; uri: string; left: number; right: number; height: number };

/** Immutable AVL scopes share unchanged subtrees in caller storage. AVL ancestry
 * is bounded by safe-integer storage addresses (fewer than 80 levels), rather
 * than XML depth or the number of declarations in a scope. Individual namespace
 * names and URIs still have the parser's token cost. */
export class StoredNamespaces {
  constructor(private readonly storage: PagedStorage, private readonly budget: XmlBudget, readonly reference = 0) {}

  private async read(reference: number): Promise<Entry> {
    const header = await this.storage.read(reference, 8);
    const size = new DataView(header.buffer, header.byteOffset, 8).getFloat64(0, true);
    const decoder = new TextDecoder(), parts: string[] = [];
    for (let offset = 0; offset < size; offset += 16384) {
      const length = Math.min(16384, size - offset);
      const checkpoint = this.budget.tick(length); if (checkpoint) await checkpoint;
      parts.push(decoder.decode(await this.storage.read(reference + 8 + offset, length), { stream: true }));
    }
    parts.push(decoder.decode());
    return JSON.parse(parts.join("")) as Entry;
  }

  private async write(entry: Entry): Promise<number> {
    const source = JSON.stringify(entry), encoder = new TextEncoder(), header = new Uint8Array(8);
    const reference = await this.storage.append(header);
    let size = 0;
    for (let offset = 0; offset < source.length;) {
      let end = Math.min(source.length, offset + 4096);
      const last = source.charCodeAt(end - 1);
      if (end < source.length && last >= 0xd800 && last <= 0xdbff) end--;
      const bytes = encoder.encode(source.slice(offset, end));
      const checkpoint = this.budget.tick(bytes.length); if (checkpoint) await checkpoint;
      await this.storage.append(bytes); size += bytes.length; offset = end;
    }
    new DataView(header.buffer).setFloat64(0, size, true);
    await this.storage.write(reference, header);
    return reference;
  }

  async get(prefix: string): Promise<string | undefined> {
    let reference = this.reference;
    while (reference) {
      const entry = await this.read(reference);
      const checkpoint = this.budget.tick(prefix.length + 1); if (checkpoint) await checkpoint;
      if (prefix === entry.prefix) return entry.uri;
      reference = prefix < entry.prefix ? entry.left : entry.right;
    }
    return undefined;
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

  async set(prefix: string, uri: string): Promise<StoredNamespaces> {
    const insert = async (reference: number): Promise<number> => {
      if (!reference) return this.write({ prefix, uri, left: 0, right: 0, height: 1 });
      const entry = await this.read(reference);
      const checkpoint = this.budget.tick(prefix.length + uri.length + 1); if (checkpoint) await checkpoint;
      if (prefix === entry.prefix) return entry.uri === uri ? reference : this.write({ ...entry, uri });
      const side = prefix < entry.prefix ? "left" : "right";
      const child = await insert(entry[side]);
      return child === entry[side] ? reference : this.balance({ ...entry, [side]: child });
    };
    return new StoredNamespaces(this.storage, this.budget, await insert(this.reference));
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<readonly [string, string]> {
    const visit = async function* (scope: StoredNamespaces, reference: number): AsyncGenerator<readonly [string, string]> {
      if (!reference) return;
      const entry = await scope.read(reference);
      yield* visit(scope, entry.left);
      yield [entry.prefix, entry.uri];
      yield* visit(scope, entry.right);
    };
    yield* visit(this, this.reference);
  }
}
