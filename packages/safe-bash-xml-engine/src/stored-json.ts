import { IntegerTable } from "@poe-code/safe-fs/storage";
import type { XmlElement } from "@poe-code/safe-fs/core";
import type { XmlBudget } from "./limits.js";
import type { StoredXmlDocument } from "./stored-document.js";

type Task = { kind: "element" | "group" | "members"; reference: number }
  | { kind: "attribute"; reference: number }
  | { kind: "text"; reference: number; first: number; last: number }
  | { kind: "literal"; value: string };

async function* quoted(parts: Iterable<string> | AsyncIterable<string>): AsyncGenerator<string> {
  yield '"';
  for await (const part of parts) for (let start = 0; start < part.length;) {
    let end = Math.min(start + 1024, part.length);
    if (end < part.length && part.charCodeAt(end - 1) >= 0xd800 && part.charCodeAt(end - 1) <= 0xdbff) end--;
    yield JSON.stringify(part.slice(start, end)).slice(1, -1);
    start = end;
  }
  yield '"';
}

/** xmltodict grouping and traversal use caller-backed records. Only the current
 * node's metadata and a fixed page cache are resident; jq owns its input values. */
export async function* storedXmlToJson(document: StoredXmlDocument, budget: XmlBudget): AsyncGenerator<Uint8Array> {
  const storage = document.storage;
  const parents = new IntegerTable(storage, 128), hashes = new IntegerTable(storage, 128);
  const encoder = new TextEncoder();
  let cached: { reference: number; value: XmlElement } | undefined;
  async function node(reference: number): Promise<XmlElement> {
    if (cached?.reference === reference) return cached.value;
    const value = await document.metadata(reference);
    if (value.kind !== "element") throw new TypeError("XML JSON conversion expected an element");
    cached = { reference, value };
    return value;
  }
  async function record(values: readonly number[]): Promise<number> {
    const bytes = new Uint8Array(values.length * 8), view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index++) view.setFloat64(index * 8, values[index]!, true);
    return storage.append(bytes);
  }
  async function fields(reference: number, count: number): Promise<number[]> {
    const bytes = await storage.read(reference, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return Array.from({ length: count }, (_, index) => view.getFloat64(index * 8, true));
  }
  async function set(reference: number, index: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8); new DataView(bytes.buffer).setFloat64(0, value, true);
    await storage.write(reference + index * 8, bytes);
  }
  async function hash(parent: number, name: XmlElement): Promise<bigint> {
    let value = 14695981039346656037n;
    for await (const part of (async function* () { yield String(parent); yield ":"; yield* document.nameText(name); })()) for (const character of part) {
      const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
      value = BigInt.asUintN(64, (value ^ BigInt(character.codePointAt(0)!)) * 1099511628211n);
    }
    return value;
  }
  // Group: parent, representative node, first/last member, previous/next
  // sibling group, hash-collision chain, member count. Member: node, next.
  for await (const entry of document.walk(document.root)) {
    if (entry.closing || entry.reference === document.root) continue;
    const current = await document.metadata(entry.reference);
    if (current.kind !== "element") continue;
    const parent = await document.parent(entry.reference), key = await hash(parent, current);
    const bucket = Number(await hashes.get(key) ?? 0n);
    let group = bucket;
    while (group) {
      const value = await fields(group, 8);
      const checkpoint = budget.tick(current.name.length + 1); if (checkpoint) await checkpoint;
      if (value[0] === parent && await document.nameEquals(await node(value[1]!), current)) break;
      group = value[6]!;
    }
    const member = await record([entry.reference, 0]);
    if (group) {
      const value = await fields(group, 8);
      await set(value[3]!, 1, member); await set(group, 3, member); await set(group, 7, value[7]! + 1);
    } else {
      let owner = Number(await parents.get(BigInt(parent)) ?? 0n);
      if (!owner) { owner = await record([0, 0]); await parents.set(BigInt(parent), BigInt(owner)); }
      const ends = await fields(owner, 2);
      group = await record([parent, entry.reference, member, member, ends[1]!, 0, bucket, 1]);
      if (ends[1]) await set(ends[1], 5, group); else await set(owner, 0, group);
      await set(owner, 1, group); await hashes.set(key, BigInt(group));
    }
  }
  async function* directText(reference: number, first = 0, last = Infinity): AsyncGenerator<string> {
    let offset = 0;
    for await (const child of document.children(reference)) {
      const value = await document.metadata(child);
      if (value.kind !== "text" && value.kind !== "cdata") continue;
      for await (const part of document.text(child)) {
        const end = offset + part.length;
        if (end > first && offset < last) yield part.slice(Math.max(0, first - offset), Math.min(part.length, last - offset));
        offset = end;
      }
    }
  }
  let head = 0;
  async function push(task: Task): Promise<void> {
    const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
    const bytes = encoder.encode(JSON.stringify(task));
    const reference = await record([head, bytes.length]);
    await storage.append(bytes); head = reference;
  }
  async function pop(): Promise<Task | undefined> {
    if (!head) return undefined;
    const reference = head, value = await fields(reference, 2); head = value[0]!;
    return JSON.parse(new TextDecoder().decode(await storage.read(reference + 16, value[1]!))) as Task;
  }
  async function* output(): AsyncGenerator<string> {
    const root = await node(document.root);
    yield "{"; yield* quoted(document.nameText(root)); yield ":";
    await push({ kind: "literal", value: "}" }); await push({ kind: "element", reference: document.root });
    while (true) {
      const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
      const task = await pop(); if (!task) break;
      if (task.kind === "literal") { yield task.value; continue; }
      if (task.kind === "attribute") {
        const value = await document.metadata(task.reference);
        if (value.kind !== "attribute") throw new TypeError("Expected XML attribute");
        const attribute = value.value;
        yield* quoted((async function* () { yield "@"; yield* document.nameText(attribute); })()); yield ":"; yield* quoted(document.text(task.reference)); continue;
      }
      if (task.kind === "text") { yield* quoted(directText(task.reference, task.first, task.last)); continue; }
      if (task.kind === "members") {
        const member = await fields(task.reference, 2);
        if (member[1]) { await push({ kind: "members", reference: member[1] }); await push({ kind: "literal", value: "," }); }
        await push({ kind: "element", reference: member[0]! }); continue;
      }
      if (task.kind === "group") {
        const group = await fields(task.reference, 8);
        yield* quoted(document.nameText(await node(group[1]!))); yield ":";
        if (group[7] === 1) await push({ kind: "element", reference: group[1]! });
        else { yield "["; await push({ kind: "literal", value: "]" }); await push({ kind: "members", reference: group[2]! }); }
        continue;
      }
      const hasAttributes = !(await document.attributeReferences(task.reference).next()).done;
      let first = -1, last = 0, offset = 0;
      for await (const part of directText(task.reference)) for (const character of part) {
        const checkpoint = budget.tick(); if (checkpoint) await checkpoint;
        if (character.trim()) { if (first < 0) first = offset; last = offset + character.length; }
        offset += character.length;
      }
      const owner = Number(await parents.get(BigInt(task.reference)) ?? 0n);
      if (!owner && !hasAttributes) {
        if (first < 0) yield "null"; else yield* quoted(directText(task.reference, first, last));
        continue;
      }
      yield "{"; await push({ kind: "literal", value: "}" });
      if (first >= 0) {
        await push({ kind: "text", reference: task.reference, first, last });
        await push({ kind: "literal", value: ',"#text":' });
      }
      if (owner) {
        let group = (await fields(owner, 2))[1]!;
        while (group) {
          const value = await fields(group, 8);
          await push({ kind: "group", reference: group });
          if (value[4] || hasAttributes) await push({ kind: "literal", value: "," });
          group = value[4]!;
        }
      }
      let following = false;
      for await (const reference of document.attributeReferences(task.reference, true)) {
        if (following) await push({ kind: "literal", value: "," });
        await push({ kind: "attribute", reference });
        following = true;
      }
    }
    yield "\n";
  }
  for await (const part of output()) {
    const checkpoint = budget.tick(part.length); if (checkpoint) await checkpoint;
    yield encoder.encode(part);
  }
}
