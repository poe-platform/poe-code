import {createRequire} from "node:module";
import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlValues} from "./retained-yaml-value.js";
import {renderRetainedYamlKey} from "./retained-yaml-render.js";

const require = createRequire(import.meta.url);
const {createStringifyContext} = require(require.resolve("yaml/package.json").slice(0, -"package.json".length) + "dist/stringify/stringify.js");
async function compare(text: string) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
  const graph = new RetainedYamlValues(storage, async () => {});
  let maximum = 0;
  const read = storage.read.bind(storage), write = storage.write.bind(storage);
  storage.read = async (offset, length) => {maximum = Math.max(maximum, length); return read(offset, length);};
  storage.write = async (offset, bytes) => {maximum = Math.max(maximum, bytes.length); return write(offset, bytes);};
  try {
    const native = parseDocument(text, {logLevel: "silent"}); expect(native.errors).toEqual([]);
    const context = createStringifyContext(native, {}); context.inFlow = true; context.inStringifyKey = true; context.options.verifyAliasOrder = false;
    const expected = native.contents!.toString(context);
    await source.append(["excluded", text, "excluded"]);
    const root = await graph.compose(source, {start: 8, end: 8 + text.length});
    const rendered = await renderRetainedYamlKey(graph, source, root, storage, async () => {});
    let actual = ""; for await (const chunk of graph.text.chunks(rendered)) actual += chunk;
    expect(actual).toBe(expected);
  } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]); expect(maximum).toBeLessThanOrEqual(8208);}
}
it.each([
  "[]", "{}", "[one, two]", "{a: one, b: two}", "{one, two}", "{one: null, two:}",
  "[one: two, ? three]", "!!pairs [one: two, {}, three]", "!!omap [one: two, three: four]", "!!set {one: null, two}",
  "[true, True, FALSE, null, NULL, ~, 0, -0, 0xff, 0o17, 1.200, 1e2, .inf, -.Inf, .NaN]",
  "[!!str 12, !!int '0xff', !!float 1.200, !local true, !<tag:example.com,test> text]",
  "[!!binary YWJjZA==, !!timestamp 2001-12-15, !!merge '<<']",
  "[ &name one, *name, {*name : value} ]", "&root [! [one], ! {one: two}, ! scalar]",
  "? [one, two]\n: value\n", "{ ? [one, two]: value }", "[ {one: two}, [three, four] ]",
  "[one, # previous\n two,\n # before\n three]", "[{a: one} # own\n , # moved\n two]",
  "{one: # before empty\n two, three: four}", "{? one # key\n : two # value\n}",
  "[\n\n # before\n one,\n # tail\n]", "value: |- # block\n  text\n", "value: >-\n  text\n",
  "? |\n  block\n: value\n", "[\"a\\nb\", 'a: b', 'it''s', \"\\0\"]",
  "[!!pairs [{a: one} # outer\n], !!set {x, y}]"
])("renders collection keys like native YAML: %j", async text => {await compare(text);});
it("folds wide nested collections and strings", async () => {
  for (const text of ["[" + "longword, ".repeat(20) + "]", "{longkey: '" + "a word ".repeat(30) + "'}", "[\"" + "escaped\\tword ".repeat(30) + "\"]"]) await compare(text);
});

it("matches generated nested collection keys", async () => {
  let seed = 1772;
  const random = (max: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max;};
  const scalars = ["plain", "true", "0o123", "0xff", "-0.000", "1.2300", "12e-2", "'true'", '"quoted"', "!!str false", "!!float 1", "!local word", "!!binary YWJjZA==", "!!timestamp 2001-12-15", "~"];
  const node = (depth: number): string => {
    if (!depth || random(3) === 0) return scalars[random(scalars.length)]!;
    const map = random(2) === 0, count = random(4), items = [];
    for (let index = 0; index < count; index++) items.push(map ? (random(3) ? "key" + index : "? [key" + index + "]") + ": " + node(depth - 1) : node(depth - 1));
    return (map ? "{" : "[") + items.join(random(2) ? ", " : ", # moved\r\n  ") + (map ? "}" : "]");
  };
  for (let sample = 0; sample < 180; sample++) await compare("[" + node(3) + ", " + node(2) + "]");
});
it("retains wide binary, fraction and tag formatting", async () => {
  for (const value of ["!!binary " + "YWJj".repeat(50), "!!binary '" + "YWJj".repeat(50) + "'", '!!binary "' + "YWJj".repeat(50) + '"', "1." + "0".repeat(8192), "!!unknown%F0%9F%98%80%21 word", "!<tag:yaml.org,2002:unknown!> word", "!!unknown%0Aname [one, two]"]) await compare("{value: " + value + "}");
});

it("renders large and deeply nested keys through bounded backing transfers", async () => {
  await compare('["' + "a".repeat(65536) + '"]');
  await compare("[".repeat(48) + "value" + "]".repeat(48));
  await compare("[one, #" + "x".repeat(65536) + "\n two]");
});
it("propagates cancellation, source and output errors without losing identity", async () => {
  for (const at of ["cancel", "read", "write", "source-read", "source-append"]) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
    const graph = new RetainedYamlValues(storage, async () => {}), failure = new Error(at);
    try {
      await source.append(["[one, two]"]);
      const root = await graph.compose(source, {start: 0, end: source.length});
      if (at === "read") storage.read = async () => {throw failure;};
      if (at === "write") storage.write = async () => {throw failure;};
      if (at === "source-read") source.unit = async () => {throw failure;};
      if (at === "source-append") source.append = async () => {throw failure;};
      await expect(renderRetainedYamlKey(graph, source, root, storage, async () => {if (at === "cancel") throw failure;})).rejects.toBe(failure);
    } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
