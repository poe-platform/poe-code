import {expect, it} from "vitest";
import {isAlias, isMap, isPair, isScalar, isSeq, parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlValues} from "./retained-yaml-value.js";
import type {TextRange} from "./backed-text.js";

async function compare(text: string, inspect?: (graph: RetainedYamlValues, source: RetainedSourceText, root: number) => Promise<void>) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
  await source.append(["excluded\n", text, "excluded"]);
  let maximum = 0;
  const read = storage.read.bind(storage), write = storage.write.bind(storage);
  storage.read = async (offset, length) => {maximum = Math.max(maximum, length); return read(offset, length);};
  storage.write = async (offset, bytes) => {maximum = Math.max(maximum, bytes.length); return write(offset, bytes);};
  const graph = new RetainedYamlValues(storage, async () => {});
  const collect = async (range: TextRange) => {let value = ""; for await (const chunk of graph.text.chunks(range)) value += chunk; return value;};
  const backed = async (ref: number): Promise<unknown> => {
    const node = await graph.get(ref), presentation = await graph.presentation(ref);
    const common = {commentBefore: await collect(presentation.commentBefore), comment: await collect(presentation.comment), spaceBefore: presentation.spaceBefore};
    const entries = []; for await (const entry of graph.entries(node)) entries.push(entry);
    if (presentation.pair) return {pair: [await backed(entries[0]!.key!), entries[0]!.value ? await backed(entries[0]!.value!) : null]};
    if (["map", "set", "omap"].includes(node.kind)) return {...common, kind: node.kind === "omap" ? "seq" : "map", items: await Promise.all(entries.map(async entry => ({pair: [await backed(entry.key!), entry.value ? await backed(entry.value) : null]})))};
    if (node.kind === "seq") return {...common, kind: "seq", items: await Promise.all(entries.map(entry => backed(entry.value!)))};
    return {...common, kind: node.kind === "alias" ? "alias" : "scalar", type: presentation.token?.type ?? "scalar"};
  };
  const native = (node: unknown): unknown => {
    if (isPair(node)) return {pair: [native(node.key), node.value == null ? null : native(node.value)]};
    if (!isAlias(node) && !isScalar(node) && !isMap(node) && !isSeq(node)) throw new Error("Expected YAML node");
    const common = {commentBefore: node.commentBefore ?? "", comment: node.comment ?? "", spaceBefore: !!node.spaceBefore};
    if (isMap(node) || isSeq(node)) return {...common, kind: isMap(node) ? "map" : "seq", items: node.items.map(native)};
    const types = {PLAIN: "scalar", QUOTE_DOUBLE: "double-quoted-scalar", QUOTE_SINGLE: "single-quoted-scalar", BLOCK_FOLDED: "block-scalar", BLOCK_LITERAL: "block-scalar"};
    return {...common, kind: isAlias(node) ? "alias" : "scalar", type: isAlias(node) ? "alias" : types[node.type ?? "PLAIN"]};
  };
  try {
    const expected = parseDocument(text); expect(expected.errors).toEqual([]);
    const root = await graph.compose(source, {start: 9, end: 9 + text.length});
    expect(await backed(root)).toEqual(native(expected.contents));
    await inspect?.(graph, source, root);
  } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]); expect(maximum).toBeLessThanOrEqual(8208);}
}
it.each([
  'value: "quoted" # trailing\n', "value: 'single'\n", "value: |- # block comment\n  block\n",
  "value:\n  # before\n  text\n", "value: # empty comment\n", "? key # key\n: value # value\n",
  "value: [{a: one} # own\n , # moved\n two]\n",
  "value: [one, # previous\n two,\n # before\n three]\n", "value: [one, #\n two]\n",
  "value: [one, # previous\r\n # before\r\n two]\n", "value: [one, # previous\n\n two]\n",
  "value: [one,\n # collection\n] # tail\n", "value: {one: 1, # previous\n two: 2}\n",
  "value: {one, # previous\n two}\n", "value: { ? one\n # key end\n , two}\n",
  "value:\n - one\n\n - two\n # collection\n", "value:\n a: one\n b: two\n # collection\n",
  "value: [one: 1, two: 2]\n", "value: !!pairs [one: 1, two: 2]\n",
  "value: !!pairs\n - # wrapper\n   a: one # value\n - {}\n - scalar\n",
  "value: !!omap\n - # wrapper\n   a: one # value\n - b: two\n",
  "value: !!pairs\n - {a: one} # outer\n", "value: !!pairs\n - {a: one # inner\n   } # outer\n",
  "value: !!set {one, two}\n", "a: &x one # anchor\nb: *x # alias\n",
  "value: {one: # before empty\n , two: 2}\n", "value: [\n\n # before\n one]\n"
])("preserves composed YAML presentation: %j", async text => {await compare(text);});
it("keeps long comment bodies and long runs of separators in caller storage", async () => {
  await compare("value: [one, #" + "x".repeat(65536) + "\n".repeat(128) + " two]\n");
});

it("matches generated nested flow presentations", async () => {
  const items = ["plain", "'single'", '"double"', "true", "0xAB", "null", "{a: one, # inner\n b: two}", "[one, # inner\n two]", "{a: one} # outer\n "];
  let seed = 1772;
  for (let sample = 0; sample < 120; sample++) {
    const selected: string[] = [];
    for (let index = 0; index < 3; index++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      selected.push(items[seed % items.length]!);
    }
    await compare("value: [\n # before\n " + selected.join(", # moved\n\n # before\n ") + "\n ]\n");
  }
});
it("retains original tag, anchor and scalar source spans", async () => {
  await compare('value: [ &name !!str "text", *name ]\n', async (graph, source, root) => {
    const pair = (await graph.entries(await graph.get(root)).next()).value!;
    const item = (await graph.entries(await graph.get(pair.value!)).next()).value!;
    const presentation = await graph.presentation(item.value!);
    const collected = [];
    for (const range of [presentation.anchor!, presentation.tag!, presentation.token!.source!]) {
      if (typeof range === "string") throw new Error("Expected original source span");
      let text = ""; for await (const chunk of source.chunks(range)) text += chunk; collected.push(text);
    }
    expect(collected).toEqual(["&name", "!!str", '"text"']);
  });
});
it("propagates presentation backing and cancellation failures exactly", async () => {
  for (const cancel of [false, true]) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), failure = new Error("presentation failure");
    let fail = false;
    const source = new RetainedSourceText(input, async () => {}), graph = new RetainedYamlValues(storage, async () => {if (cancel && fail) throw failure;});
    try {
      await source.append(["value: [one, # comment\n two]\n"]);
      const root = await graph.compose(source, {start: 0, end: source.length});
      fail = true;
      if (!cancel) storage.read = async () => {throw failure;};
      await expect(graph.presentation(root)).rejects.toBe(failure);
    } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
