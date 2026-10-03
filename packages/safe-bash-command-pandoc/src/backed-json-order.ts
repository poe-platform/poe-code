import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import {readJsonNumber} from "./json-number.js";

/** JavaScript object enumeration emits array-index keys first in numeric order.
 * Build that order in caller storage instead of sorting a resident key array. */
export async function backedJsonOrder(tree: BackedJson, scratch: PagedStorage, cooperate: (units?: number) => Promise<void>) {
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
  const index = async (position: number): Promise<number | undefined> => {
    const text = await tree.smallText(position, 10);
    if (text === undefined) return undefined;
    const value = Number(text);
    return Number.isInteger(value) && value >= 0 && value < 0xffffffff && String(value) === text ? value : undefined;
  };
  const end = (await tree.describe(tree.rootPosition)).end;
  for (let position = tree.rootPosition; position < end;) {
    await cooperate();
    const header = await tree.describe(position);
    if (header.kind === "object") {
      let root = 0;
      for (let key = position + 32; key < header.end;) {
        const numeric = await index(key);
        if (numeric !== undefined) {
          root ||= scratch.allocate(128);
          let node = root;
          for (let shift = 28; shift >= 0; shift -= 4) {
            const slot = node + (numeric >>> shift & 15) * 8;
            if (!shift) {await put(slot, key); break;}
            let child = await pointer(slot);
            if (!child) {child = scratch.allocate(128); await put(slot, child);}
            node = child;
          }
        }
        key = (await tree.describe((await tree.describe(key)).end)).end;
      }
      if (root) {
        // Recursion is exactly eight radix levels, independent of document depth.
        const ordered = async function* (node: number, level: number): AsyncGenerator<number> {
          for (let slot = 0; slot < 16; slot++) {
            const child = await pointer(node + slot * 8);
            if (!child) continue;
            await cooperate();
            if (level === 7) yield child;
            else yield* ordered(child, level + 1);
          }
        };
        let previous = 0;
        const link = async (key: number) => {
          if (previous) await next.set(BigInt(previous), BigInt(key));
          else await first.set(BigInt(position), BigInt(key));
          previous = (await tree.describe(key)).end;
        };
        for await (const key of ordered(root, 0)) await link(key);
        for (let key = position + 32; key < header.end;) {
          if (await index(key) === undefined) await link(key);
          key = (await tree.describe((await tree.describe(key)).end)).end;
        }
        await next.set(BigInt(previous), 0n);
      }
    }
    position = header.kind === "object" || header.kind === "array" ? position + 32 : header.end;
  }
  return {
    async first(position: number): Promise<number> {return Number(await first.get(BigInt(position)) ?? BigInt(position + 32));},
    async next(position: number, parent: number): Promise<number> {
      const ordered = await next.get(BigInt(position));
      if (ordered !== undefined) return Number(ordered);
      const end = (await tree.describe(position)).end;
      return end < (await tree.describe(parent)).end ? end : 0;
    },
    async literal(position: number): Promise<string> {
      const token = await tree.smallText(position, 5);
      if (token === "null" || token === "true" || token === "false") return token;
      return JSON.stringify(await readJsonNumber(tree.scalarChunks(position), cooperate));
    }
  };
}
