import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import type {TextRange} from "./backed-text.js";
import type {RetainedSourceText, SourceRange} from "./retained-source-text.js";
import {RetainedYamlValues} from "./retained-yaml-value.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {renderRetainedYamlKey} from "./retained-yaml-render.js";
import {AstError} from "./errors.js";

/** Convert native YAML value semantics to typed Pandoc metadata. Each top-level
 * value commits only after conversion succeeds, preserving earlier entries when
 * a later value is cyclic. Source graphs, order indexes, work and results stay
 * in separate caller-backed arenas; no complete JS metadata object is built. */
export async function readRetainedYamlMetadata(source: RetainedSourceText, range: SourceRange | undefined,
  scratch: PagedStorage, output: PagedStorage, cooperate: (units?: number) => Promise<void>) {
  const graph = new RetainedYamlValues(scratch, cooperate), text = graph.text;
  const put = async (ref: number, fields: number[]) => {
    const bytes = new Uint8Array(fields.length * 8), view = new DataView(bytes.buffer);
    fields.forEach((value, index) => view.setFloat64(index * 8, value, true)); await scratch.write(ref, bytes); await cooperate();
  };
  const get = async (ref: number, count: number) => {
    const bytes = await scratch.read(ref, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    await cooperate(); return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
  };
  const small = async (value: TextRange, limit: number) => {
    if (value.units > limit) return undefined;
    let result = ""; for await (const chunk of text.chunks(value)) result += chunk; return result;
  };
  const orders = new IntegerTable(scratch, 64);
  const order = async (ref: number) => {
    const saved = await orders.get(BigInt(ref)); if (saved !== undefined) return Number(saved);
    let radix = 0, ordinary = 0, tail = 0;
    for await (const entry of graph.entries(await graph.get(ref))) {
      const key = await graph.get(entry.key!); if (key.kind !== "string") continue; // Object.entries omits Symbols.
      const item = scratch.allocate(24); await put(item, [0, entry.key!, entry.value!]);
      const name = await small(key.text!, 10), numeric = Number(name);
      if (name !== undefined && Number.isInteger(numeric) && numeric >= 0 && numeric < 0xffffffff && String(numeric) === name) {
        radix ||= scratch.allocate(128); let node = radix;
        for (let shift = 28; shift >= 0; shift -= 4) {
          const slot = node + (numeric >>> shift & 15) * 8;
          if (!shift) {await put(slot, [item]); break;}
          let child = (await get(slot, 1))[0]!;
          if (!child) {child = scratch.allocate(128); await put(slot, [child]);} node = child;
        }
      } else {if (tail) await put(tail, [item]); else ordinary = item; tail = item;}
    }
    const numeric = async function* (node: number, depth: number): AsyncGenerator<number> {
      for (let index = 0; index < 16; index++) {
        const child = (await get(node + index * 8, 1))[0]!;
        if (child) {if (depth === 7) yield child; else yield* numeric(child, depth + 1);}
      }
    };
    let first = 0; tail = 0;
    if (radix) for await (const item of numeric(radix, 0)) {if (tail) await put(tail, [item]); else first = item; tail = item;}
    if (tail) await put(tail, [ordinary]); else first = ordinary;
    await orders.set(BigInt(ref), BigInt(first)); return first;
  };
  const supported = async (ref: number) => !["null", "undefined", "merge"].includes((await graph.get(ref)).kind);
  const build = async (ref: number, number?: number) => {
    const tree = new BackedJson(output, cooperate), active = new IntegerTable(scratch, 64); let top = 0;
    const push = async (op: number, a = 0) => {const job = scratch.allocate(24); await put(job, [top, op, a]); top = job;};
    const primitive = async (tag: "MetaString" | "MetaBool", value: string | boolean | TextRange) => {
      await tree.begin("object"); await tree.key("t"); await tree.value(tag); await tree.key("c");
      if (typeof value === "object") {await tree.begin("string"); for await (const chunk of text.chunks(value)) await tree.text(chunk); await tree.end();}
      else await tree.value(value);
      await tree.end();
    };
    if (number !== undefined) await primitive("MetaString", String(number));
    else await push(0, ref);
    while (top) {
      const [next, op, a] = await get(top, 3); top = next!;
      if (op === 1) {await tree.end(); await tree.end(); await active.set(BigInt(a!), 0n); continue;}
      if (op === 2) {
        if (!a) continue;
        const [next, key, value] = await get(a!, 3); await push(2, next!);
        if (!await supported(value!)) continue;
        // Keep __proto__ temporarily as a marker. Its value must still fully
        // convert (and may be cyclic), but is not an own property of the result.
        await tree.begin("key"); for await (const chunk of text.chunks((await graph.get(key!)).text!)) await tree.text(chunk); await tree.end();
        await push(0, value!); continue;
      }
      const node = await graph.get(a!);
      if (node.kind === "string") await primitive("MetaString", node.text!);
      else if (node.kind === "number") await primitive("MetaString", String(node.value));
      else if (node.kind === "boolean") await primitive("MetaBool", !!node.value);
      else {
        if (await active.get(BigInt(a!))) throw new RetainedYamlSyntaxError(0);
        await active.set(BigInt(a!), 1n);
        await tree.begin("object"); await tree.key("t"); await tree.value(node.kind === "seq" ? "MetaList" : "MetaMap"); await tree.key("c");
        await tree.begin(node.kind === "seq" ? "array" : "object"); await push(1, a!);
        if (node.kind === "seq") {
          for await (const entry of graph.entries(node, true)) if (await supported(entry.value!)) await push(0, entry.value!);
        } else if (node.kind === "map") await push(2, await order(a!));
        else if (node.kind === "binary") {
          let index = 0;
          for await (const chunk of text.chunks(node.text!)) for (let i = 0; i < chunk.length; i++) {
            await tree.key(String(index++)); await primitive("MetaString", String(chunk.charCodeAt(i)));
          }
        }
      }
    }
    return tree.rootPosition;
  };
  const temporary = new BackedJson(output, cooperate), tree = new BackedJson(output, cooperate), prototypes = new IntegerTable(scratch, 64);
  const copy = async (root: number, target: BackedJson, strip: boolean) => {
    let top = 0;
    const push = async (op: number, a = 0, b = 0, c = 0) => {const job = scratch.allocate(40); await put(job, [top, op, a, b, c]); top = job;};
    await push(0, root);
    while (top) {
      const [next, op, a, b, c] = await get(top, 5); top = next!;
      if (op === 1) {await target.end(); continue;}
      if (op === 2) {
        if (a! >= b!) continue;
        const header = await temporary.describe(a!);
        if (strip && header.kind === "key" && await temporary.smallText(a!, 9) === "__proto__") {
          await prototypes.set(BigInt(c!), 1n); await push(2, (await temporary.describe(header.end)).end, b!, c!); continue;
        }
        await push(2, header.end, b!, c!); await push(0, a!); continue;
      }
      const header = await temporary.describe(a!), position = await target.begin(header.kind);
      if (header.kind === "object" || header.kind === "array") {await push(1); await push(2, a! + 32, header.end, position);}
      else {for await (const chunk of temporary.scalarChunks(a!)) await target.text(chunk); await target.end();}
    }
  };
  let parsed = false, first = 0, last = 0;
  const append = async (key: TextRange, value: number) => {
    const entry = scratch.allocate(40); await put(entry, [0, key.first, key.last, key.units, value]);
    if (last) await put(last, [entry]); else first = entry; last = entry;
  };
  if (range) try {
    const composed = await graph.compose(source, range), root = await graph.convert(composed, ref => renderRetainedYamlKey(graph, source, ref, scratch, cooperate));
    const node = await graph.get(root);
    if (["map", "omap", "set", "date", "binary"].includes(node.kind)) {
      parsed = true;
      if (node.kind === "map") for (let entry = await order(root); entry;) {
        const [next, key, value] = await get(entry, 3);
        if (await supported(value!)) await append((await graph.get(key!)).text!, await build(value!));
        entry = next!;
      } else if (node.kind === "binary") {
        let index = 0;
        for await (const chunk of text.chunks(node.text!)) for (let i = 0; i < chunk.length; i++) await append(await text.from([String(index++)]), await build(0, chunk.charCodeAt(i)));
      }
    }
  } catch (error) {if (!(error instanceof RetainedYamlSyntaxError)) throw error; parsed = false;}
  const root = await tree.begin("object");
  for (let entry = first; entry;) {
    const [next, first, last, units, value] = await get(entry, 5), key = {first: first!, last: last!, units: units!};
    if (await small(key, 9) === "__proto__") await prototypes.set(BigInt(root), 1n);
    else {await tree.begin("key"); for await (const chunk of text.chunks(key)) await tree.text(chunk); await tree.end(); await copy(value!, tree, true);}
    entry = next!;
  }
  await tree.end();
  const fail = async (position: number, message = "Invalid shape"): Promise<never> => {
    let path = "";
    for (let child = position; child !== tree.rootPosition;) {
      const parent = (await tree.describe(child)).parent, header = await tree.describe(parent); let index = 0;
      for await (const sibling of tree.children(parent)) {
        const item = await tree.describe(sibling);
        if (header.kind === "object") {
          if (item.kind === "key" && (sibling === child || item.end === child)) {
            let key = ""; for await (const chunk of tree.scalarChunks(sibling)) key += chunk; path = "." + key + path; break;
          }
        } else if (sibling === child) {path = `[${index}]` + path; break;}
        index++;
      }
      child = parent;
    }
    throw new AstError("E_AST", "$.metadata" + path, message);
  };
  return {
    parsed, tree,
    async write(target: BackedJson) {await copy(tree.rootPosition, target, false);},
    async validate() {
      const end = (await tree.describe(tree.rootPosition)).end;
      // Native normalization checks all own data and Unicode before record
      // prototypes. Prototype contents are absent from this owned tree.
      for (let position = tree.rootPosition; position < end;) {
        await cooperate();
        const header = await tree.describe(position);
        if (header.kind === "key" || header.kind === "string") {
          let high = false;
          const location = header.kind === "key" ? header.parent : position;
          for await (const chunk of tree.scalarChunks(position)) for (let i = 0; i < chunk.length; i++) {
            const code = chunk.charCodeAt(i);
            if (high) {if (code < 0xdc00 || code > 0xdfff) await fail(location, "Invalid Unicode"); high = false;}
            else if (code >= 0xd800 && code <= 0xdbff) high = true;
            else if (code >= 0xdc00 && code <= 0xdfff) await fail(location, "Invalid Unicode");
          }
          if (high) await fail(location, "Invalid Unicode");
          if (header.kind === "key" && ["constructor", "prototype"].includes(await tree.smallText(position, 11) ?? "")) await fail(position);
        }
        position = header.kind === "object" || header.kind === "array" ? position + 32 : header.end;
      }
      for (let position = tree.rootPosition; position < end;) {
        await cooperate();
        const header = await tree.describe(position);
        if (await prototypes.get(BigInt(position))) await fail(position);
        position = header.kind === "object" || header.kind === "array" ? position + 32 : header.end;
      }
    }
  };
}
