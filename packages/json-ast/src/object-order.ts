import {IntegerTable, type PagedStorage} from "@poe-code/safe-fs/storage";
import type {BackedJson} from "./backed-json.js";
import {readJsonNumber} from "./json-number.js";

/** JSON.parse-compatible object enumeration over a completed tree. Duplicate
 * names use the final value at the first name's insertion position; canonical
 * array indexes precede other names in numeric order. The source tape is never
 * changed. Indexes, collision chains and insertion order use caller storage. */
export async function indexJsonObjects(tree: BackedJson, scratch: PagedStorage, cooperate: (units?: number) => Promise<void>) {
  const first = new IntegerTable(scratch, 64), next = new IntegerTable(scratch, 64);
  const pointer = async (position: number): Promise<number> => {
    const bytes = await scratch.read(position, 8);
    return new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true);
  };
  const put = async (position: number, value: number): Promise<void> => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await scratch.write(position, bytes);
  };
  const numericIndex = async (key: number): Promise<number | undefined> => {
    const text = await tree.smallText(key, 10);
    if (text === undefined) return undefined;
    const value = Number(text);
    return Number.isInteger(value) && value >= 0 && value < 0xffffffff && String(value) === text ? value : undefined;
  };
  const end = (await tree.describe(tree.rootPosition)).end;
  for (let position = tree.rootPosition; position < end;) {
    await cooperate();
    const header = await tree.describe(position);
    if (header.kind === "object") {
      const hashes = new IntegerTable(scratch, 64), numeric = new IntegerTable(scratch, 64);
      let head = 0, tail = 0;
      for (let key = position + 32; key < header.end;) {
        await cooperate();
        let hash = 0;
        for await (const fragment of tree.scalarChunks(key)) {
          for (let at = 0; at < fragment.length; at++) hash = Math.imul(hash ^ fragment.charCodeAt(at), 16777619) >>> 0;
          await cooperate(fragment.length);
        }
        const collision = Number(await hashes.get(BigInt(hash)) ?? 0n);
        let existing = 0;
        for (let record = collision; record; record = await pointer(record + 16)) {
          await cooperate();
          if (await tree.equalText(await pointer(record), key)) {existing = record; break;}
        }
        if (existing) await put(existing, key);
        else {
          // latest key, next in insertion order, next hash collision
          const record = scratch.allocate(24);
          await put(record, key); await put(record + 16, collision);
          if (tail) await put(tail + 8, record); else head = record;
          tail = record;
          await hashes.set(BigInt(hash), BigInt(record));
          const index = await numericIndex(key);
          if (index !== undefined) await numeric.set(BigInt(index), BigInt(record));
        }
        key = (await tree.describe((await tree.describe(key)).end)).end;
      }
      let previous = 0;
      const link = async (record: number) => {
        await cooperate();
        const key = await pointer(record);
        if (previous) await next.set(BigInt(previous), BigInt(key));
        else await first.set(BigInt(position), BigInt(key));
        previous = (await tree.describe(key)).end;
      };
      for await (const [, record] of numeric.entries()) await link(Number(record));
      for (let record = head; record; record = await pointer(record + 8)) {
        await cooperate();
        if (await numericIndex(await pointer(record)) === undefined) await link(record);
      }
      if (previous) await next.set(BigInt(previous), 0n);
      else await first.set(BigInt(position), 0n);
    }
    position = header.kind === "object" || header.kind === "array" ? position + 32 : header.end;
  }
  const entries = async function* (position: number): AsyncGenerator<{key: number; value: number}> {
    if ((await tree.describe(position)).kind !== "object") throw new Error("Object required");
    for (let key = Number(await first.get(BigInt(position)) ?? 0n); key;) {
      await cooperate();
      const value = (await tree.describe(key)).end;
      yield {key, value};
      key = Number(await next.get(BigInt(value)) ?? 0n);
    }
  };
  return {
    entries,
    async property(position: number, name: string): Promise<number | undefined> {
      for await (const entry of entries(position)) if (await tree.smallText(entry.key, name.length) === name) return entry.value;
      return undefined;
    },
    async first(position: number): Promise<number> {return Number(await first.get(BigInt(position)) ?? 0n);},
    async next(position: number, _parent: number): Promise<number> {return Number(await next.get(BigInt(position)) ?? 0n);},
    async literal(position: number): Promise<string> {
      const token = await tree.smallText(position, 5);
      if (token === "null" || token === "true" || token === "false") return token;
      return JSON.stringify(await readJsonNumber(tree.scalarChunks(position), cooperate, false));
    }
  };
}
