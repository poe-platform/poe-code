import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlValues} from "./retained-yaml-value.js";

async function compare(text: string, prefix = "", renderedKey?: string) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
  await source.append([prefix, text, "outside"]);
  let maximum = 0;
  const originalRead = storage.read.bind(storage), originalWrite = storage.write.bind(storage);
  storage.read = async (offset, length) => {maximum = Math.max(maximum, length); return originalRead(offset, length);};
  storage.write = async (offset, bytes) => {maximum = Math.max(maximum, bytes.length); return originalWrite(offset, bytes);};
  const graph = new RetainedYamlValues(storage, async () => {});
  const read = async (ref: number, seen = new Map<number, unknown>()): Promise<unknown> => {
    if (seen.has(ref)) return seen.get(ref);
    const node = await graph.get(ref);
    if (node.kind === "alias") return read(node.target!, seen);
    if (node.kind === "date") return new Date(node.value!);
    if (node.kind === "binary") {let value = ""; for await (const chunk of graph.text.chunks(node.text!)) value += chunk; return Uint8Array.from(value, char => char.charCodeAt(0));}
    if (node.kind === "undefined") return undefined;
    if (node.kind === "null") return null;
    if (node.kind === "number") return node.value;
    if (node.kind === "boolean") return !!node.value;
    if (node.kind === "string") {let value = ""; for await (const chunk of graph.text.chunks(node.text!)) value += chunk; return value;}
    if (node.kind === "omap") {
      const value = new Map(); seen.set(ref, value);
      for await (const pair of graph.entries(node)) value.set(await read(pair.key!, seen), pair.value ? await read(pair.value, seen) : null); return value;
    }
    if (node.kind === "set") {
      const value = new Set(); seen.set(ref, value);
      for await (const pair of graph.entries(node)) value.add(await read(pair.key!, seen)); return value;
    }
    if (node.kind === "seq") {
      const value: unknown[] = []; seen.set(ref, value);
      for await (const pair of graph.entries(node)) value.push(await read(pair.value!, seen)); return value;
    }
    const value: Record<string, unknown> = {}; seen.set(ref, value);
    for await (const pair of graph.entries(node)) Object.defineProperty(value, String(await read(pair.key!, seen) ?? ""), {value: pair.value ? await read(pair.value, seen) : null, enumerable: true, configurable: true, writable: true});
    return value;
  };
  try {
    const native = parseDocument(text); native.options.logLevel = "silent"; let expected: unknown, failed = native.errors.length > 0;
    try {expected = structuredClone(native.toJS({maxAliasCount: 32}));} catch {failed = true;}
    const action = graph.compose(source, {start: prefix.length, end: prefix.length + text.length}).then(root => graph.convert(root, async () => {if (renderedKey === undefined) throw new Error("Unexpected collection key"); return graph.text.from([renderedKey]);}));
    if (failed) await expect(action).rejects.toThrow();
    else {const actual = await read(await action); expect(actual).toEqual(expected); return actual;}
  } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]); expect(maximum).toBeLessThanOrEqual(8208);}
}
it.each([
  "base: &base {x: first, y: old}\nvalue: { !!merge <<: *base, y: new }\n",
  "base: &base {x: first, y: old}\nvalue: { y: new, !!merge <<: *base }\n",
  "value: { !!merge <<: [{x: first}, {x: second, y: last}] }\n",
  "value: { !!merge <<: {x: first}, normal: yes }\n",
  "value: { !!merge <<: [] }\n", "value: { !!merge <<: 12 }\n", "value: { !!merge <<: [null] }\n",
  "value: &self { !!merge <<: *self }\n", "value: { <<: normal }\n",
  "name: &x [one, two]\nmap: {? *x : value}\n",
  "name: &x !!timestamp 2001-12-15\nmap: {? *x : value}\n",
  "map: {? !!timestamp 2001-12-15 : value}\n",
  "name: &x !!binary YWJj\nmap: {? *x : value}\n",
  "base: &base {key: &x []}\nvalue: !!omap [{? *x : first}, {? { !!merge <<: *base } : middle}, {? *x : second}]\n",
  "a: &x {key: value}\nb: { !!merge <<: [" + "*x, ".repeat(40) + "] }\n",
  "a: &x value\nb: &base {key: *x}\nc: { !!merge <<: [" + "*base, ".repeat(40) + "] }\n",
  "base: &base {a: &x value, b: *x}\nc: { !!merge <<: [" + "*base, ".repeat(40) + "] }\n",
  "base: &base {__proto__: value, constructor: yes}\nc: { !!merge <<: *base }\n",
  "a: !!set {x, y}\n", "a: !!set {x: null, y: ~}\n", "a: !!set {x: !!null null}\n", "a: !!set {x: value}\n",
  "a: !!omap [x: one, y: two]\n", "a: !!omap [x: one, x: two]\n", "a: !!omap [.nan: one, .NaN: two]\n",
  "a: !!omap [one, two]\n", "a: !!pairs [one, {x: y}, {}]\n", "a: !!pairs [{x: y, z: w}]\n",
  "a: !!pairs [ &x {key: value}, *x ]\n", "a: !!omap [ &x one, *x ]\n",
  "a: !!binary YWJjZA==\n", "a: !!timestamp 2001-12-15\n", "a: !!timestamp not-a-date\n", "", "title: hello\n", "a: [one, 2, true, null]\n", "a: {x: 1, y: 2}\n", "? a\n? b\n",
  "a: |+\n  text\n\n", "a: >-\n  one\n  two\n", "a: !!str 12\nb: !!float \"1.0\"\n",
  "a: !!int \"oops\"\n", "a: !local true\n", "a: !<> true\n",
  "a: &x [1, 2]\nb: *x\n", "a: &x {self: *x}\n", "a: *missing\n",
  "a: &x one\nb: &x two\nc: *x\n", "a: &x one\nb: &y *x\n",
  "a: 1\na: 2\n", "true: 1\nTrue: 2\n", "1: a\n1.0: b\n", ".nan: a\n.NaN: b\n",
  "a: [x: y, ? z, : value]\n", "a: &x\n - one\n - *x\n",
  "a: &x - one\n", "a: & value\n", "a: *\n", "a: !!str [1, 2]\n",
  "a: &x value\nb: [" + "*x, ".repeat(31) + "]\n",
  "a: &x value\nb: [" + "*x, ".repeat(32) + "]\n",
  "a: &x [one]\nb: &y [*x, *x]\nc: [" + "*y, ".repeat(12) + "]\n"
]) ("composes backed core YAML values and aliases: %j", async text => {await compare(text);});
it("preserves nested anchor order and nonzero input spans", async () => {
  for (const text of [
    "a: &x [one]\nb: &y [*x]\nc: &x two\nd: *y\n",
    "a: &x [one, &x two, *x]\nb: *x\n",
    "a: &x {nested: &y [*x, *x]}\nb: *y\n",
    "a: &x []\nb: [" + "*x, ".repeat(100) + "]\n",
    "a: {0: first, -0: second}\n", "a: {true: yes, \"true\": no}\n",
    "a: {null: first, ~: second}\n", "a: [\"x\"#bad\n]\n",
    "a: 1\n---\nb: 2\n", "a: !!str\nb: null\n"
  ]) await compare(text, "ignored\n");
});
it("composes broad collections with fixed-size record transfers", async () => {
  await compare("a: [" + "longvalue_longvalue_longvalue, ".repeat(512) + "]\n");
});
it("propagates caller storage and cancellation errors unchanged", async () => {
  for (const cancel of [false, true]) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
    const failure = new Error(cancel ? "cancelled" : "storage unavailable");
    await source.append(["a: [one, two]\n"]);
    const graph = new RetainedYamlValues(storage, async () => {if (cancel) throw failure;});
    if (!cancel) storage.read = async () => {throw failure;};
    try {await expect(graph.compose(source, {start: 0, end: source.length})).rejects.toBe(failure);}
    finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});

it("matches mixed generated core-schema documents", async () => {
  const values = ["word", "null", "true", "1.25", "-0", ".inf", "'quoted'", "[one, 2]", "{x: yes}", "!!str 12"];
  for (const value of values) for (const ending of ["\n", " # comment\n", "\r\n"]) {
    await compare(`a:\n  key: ${value}${ending}  next: end\n`);
    await compare(`a:\n  - ${value}${ending}  - end\n`);
    await compare(`a: [${value}, ${value}]\n`);
  }
});

it("uses JavaScript key coercion for merges and preserves Set iteration", async () => {
  for (const text of [
    "value: { !!merge <<: !!set {abc, xy, ''} }\n",
    "value: { !!merge <<: !!set {123} }\n",
    "value: { !!merge <<: !!set {? [one, two]} }\n",
    "value: { !!merge <<: !!set {? !!set {one, two}} }\n",
    "value: { !!merge <<: !!set {? !!omap [one: two, three: four]} }\n",
    "value: { !!merge <<: {null: empty, true: yes, 12: number} }\n",
    "value: { !!merge <<: !!omap [] }\n", "value: { !!merge <<: !!omap [one: two] }\n"
  ]) await compare(text);
  await compare("base: &base {? [one, two]: value}\nmerged: { !!merge <<: *base }\n", "", "[ one, two ]");
  await compare("base: &base {? [[one, two], null, []]: value}\nmerged: { !!merge <<: *base }\n", "", "[ [ one, two ], null, [] ]");
});

it("coerces cyclic merge keys without recursively expanding them", async () => {
  await compare("base: &base {? &arr [*arr]: value}\nmerged: { !!merge <<: *base }\n", "", "[ *arr ]");
});
it("preserves shared and cyclic identities after conversion", async () => {
  const result = await compare("a: &x {self: *x}\nb: *x\n") as {a: {self: unknown}; b: unknown};
  expect(result.a).toBe(result.b); expect(result.a.self).toBe(result.a);
});
it("propagates conversion failures without turning them into YAML errors", async () => {
  for (const failureAt of ["read", "cooperate", "render"] as const) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
    const failure = new Error(failureAt); let armed = false;
    await source.append(["a: {? [one, two]: value}\n"]);
    const graph = new RetainedYamlValues(storage, async () => {if (armed && failureAt === "cooperate") throw failure;});
    try {
      const root = await graph.compose(source, {start: 0, end: source.length}); armed = true;
      if (failureAt === "read") storage.read = async () => {throw failure;};
      await expect(graph.convert(root, async () => {throw failure;})).rejects.toBe(failure);
    } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});

it.each([0, 1, 2, 15, 30, 31, 32, 33])("matches alias visit accounting across %i repeated merge sources", async count => {
  for (const body of ["{key: value}", "{key: *x}", "{key: &local [], again: *local}", "{ !!merge <<: {key: *x} }"]) {
    await compare(`anchor: &x value\nbase: &base ${body}\nmerged: { !!merge <<: [${"*base, ".repeat(count)}] }\n`);
  }
});
