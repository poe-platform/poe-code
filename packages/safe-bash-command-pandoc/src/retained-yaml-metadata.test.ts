import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {BackedJson} from "./backed-json.js";
import {parseCommonMarkMetadata} from "./commonmark.js";
import {normalizeDocumentCooperatively, AstError} from "./ast.js";
import {readRetainedYamlMetadata} from "./retained-yaml-metadata.js";

async function compare(yaml: string) {
  const metadata = {}, expectedParsed = parseCommonMarkMetadata(yaml, metadata);
  let expectedError: AstError | undefined;
  try {await normalizeDocumentCooperatively({blocks: [], metadata, resources: []}, {}, async () => {});} catch (error) {if (!(error instanceof AstError)) throw error; expectedError = error;}
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), scratch = new PagedStorage(owner, 1), wire = new PagedStorage(owner, 1);
  let maximum = 0;
  for (const store of [scratch, wire]) {
    const read = store.read.bind(store), write = store.write.bind(store);
    store.read = async (offset, length) => {maximum = Math.max(maximum, length); return read(offset, length);};
    store.write = async (offset, bytes) => {maximum = Math.max(maximum, bytes.length); return write(offset, bytes);};
  }
  const source = new RetainedSourceText(input, async () => {});
  try {
    await source.append(["excluded", yaml, "excluded"]);
    const result = await readRetainedYamlMetadata(source, {start: 8, end: 8 + yaml.length}, scratch, wire, async () => {});
    expect(result.parsed).toBe(expectedParsed);
    let serialized = ""; for await (const bytes of result.tree.chunks()) serialized += new TextDecoder().decode(bytes);
    expect(serialized).toBe(JSON.stringify(metadata));
    if (expectedError) await expect(result.validate()).rejects.toMatchObject({code: expectedError.code, path: expectedError.path, message: expectedError.message});
    else await result.validate();
    const copy = new BackedJson(wire, async () => {}); await result.write(copy);
    let copied = ""; for await (const bytes of copy.chunks()) copied += new TextDecoder().decode(bytes); expect(copied).toBe(serialized);
  } finally {await input.close(); await scratch.close(); await wire.close(); expect(await fs.readdir("/")).toEqual([]); expect(maximum).toBeLessThanOrEqual(8208);}
}
it.each([
  "", "null", "scalar", "[one, two]", "{}", "title: hello\nflag: true\nnumber: 12\n",
  "values: [one, null, 2, false, !!merge '<<']\n", "value: {a: null, b: [null], c: {d: yes}}\n",
  "value: [0, -0, .nan, .inf, -.inf]\n", "value: !!binary YWJj\n", "!!binary YWJj",
  "value: !!timestamp 2001-12-15\n", "value: !!set {one, two}\n", "value: !!omap [one: two]\n",
  "value: !!pairs [one, two: three]\n", "first: &a {x: one}\nsecond: *a\n",
  "title: kept\nloop: &loop [*loop]\nlast: dropped\n", "loop: &loop {self: *loop}\ntitle: dropped\n",
  "name: kept\n2: before\n1: &a [*a]\n", "2: second\n1: first\n01: leading\n4294967295: last\n0: zero\n",
  "__proto__: {key: value}\n", "value: {__proto__: {key: value}}\n", "__proto__: null\n",
  "__proto__: {constructor: bad}\n", "__proto__: value\nconstructor: bad\n",
  "value: {__proto__: {bad: value}, constructor: bad}\n", "constructor: null\nprototype: null\n",
  "constructor: value\n", "value: {prototype: value}\n", 'value: "\\uD800"\n', '"\\uD800": value\n',
  'value: {"\\uD800": text}\n', 'value: {__proto__: "\\uD800"}\n',
  "? [one, # moved\n two]\n: value\n", "base: &base {x: one}\nvalue: {!!merge <<: *base, x: two}\n",
  "title: kept\ninvalid: [\n", "duplicate: one\nduplicate: two\n"
])("converts typed YAML metadata with native semantics: %j", async yaml => {await compare(yaml);});
it("converts broad metadata and long scalar values", async () => {
  await compare("value: '" + "x".repeat(65536) + "'\n");
  await compare("value: {" + Array.from({length: 128}, (_, index) => `${127 - index}: value`).join(", ") + "}\n");
});

it("propagates parser, output and validation failures with exact identity", async () => {
  for (const at of ["scratch", "output", "source", "cancel", "validate"]) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), scratch = new PagedStorage(owner, 1), output = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
    const failure = new Error(at); let armed = at === "cancel";
    const cooperate = async () => {if (armed) throw failure;};
    try {
      await source.append(["value: [one, two]\n"]);
      if (at === "scratch") scratch.write = async () => {throw failure;};
      if (at === "output") output.write = async () => {throw failure;};
      if (at === "source") source.unit = async () => {throw failure;};
      const action = readRetainedYamlMetadata(source, {start: 0, end: source.length}, scratch, output, cooperate);
      if (at === "validate") {const result = await action; armed = true; await expect(result.validate()).rejects.toBe(failure);}
      else await expect(action).rejects.toBe(failure);
    } finally {await input.close(); await scratch.close(); await output.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
