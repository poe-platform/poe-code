import {expect, it} from "vitest";
import {Parser} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlCst} from "./retained-yaml-cst.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {RetainedYamlParser} from "./retained-yaml-parser.js";

async function compare(text: string, prefix = 0) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1);
  const source = new RetainedSourceText(input, async () => {}), tree = new RetainedYamlCst(storage, async () => {});
  await source.append(["x".repeat(prefix), text, "outside"]);
  const selected = {start: prefix, end: prefix + text.length};
  const read = async (position: number): Promise<unknown> => {
    const node = await tree.get(position), result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === "source") {
        if (typeof node.source === "string") result[key] = node.source;
        else {let text = ""; for await (const chunk of source.chunks(node.source!)) text += chunk; result[key] = text;}
      } else if (["start", "end", "items", "props", "sep"].includes(key)) {
        if (key === "start" && node.type === "flow-collection") result[key] = await read(value as number);
        else {const children: unknown[] = []; for await (const child of tree.values(value as number)) children.push(await read(child)); result[key] = children;}
      } else if (key === "key" || key === "value") result[key] = value === -1 ? null : await read(value as number);
      else result[key] = value;
    }
    return result;
  };
  try {
    const expected = [...new Parser().parse(text)];
    const shift = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      if ("offset" in value && typeof value.offset === "number") value.offset += prefix;
      for (const child of Object.values(value)) shift(child);
    };
    if (prefix) shift(expected);
    const hasError = (value: unknown): boolean => !!value && typeof value === "object" && ("type" in value && value.type === "error" || Object.values(value).some(hasError));
    if (hasError(expected)) {
      await expect((async () => {for await (const ref of new RetainedYamlParser(source, selected, tree, async () => {}).parse()) void ref;})()).rejects.toBeInstanceOf(RetainedYamlSyntaxError);
      return;
    }
    const actual: unknown[] = [];
    for await (const position of new RetainedYamlParser(source, selected, tree, async () => {}).parse()) actual.push(await read(position));
    expect(actual, text).toEqual(expected);
  } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
}
const cases = [
  "", "title: hello\n", "a: [one, {two: 2}, true, null]\n", "a: &anchor [*anchor]\nb: *anchor\n",
  "a: !!str 12\nb: !<tag:example.com,2026:value> yes\n", "a: !local%20tag value\n",
  "a: |\n  hello\n  world\nb: yes\n", "a: >2- # comment\n  hello\n\n  world\nb: yes\n",
  "a: [\n  value\n]\n", "a: 'one''two'\nb: \"one\\\"two\"\n", "a: \"one\n  two\"\n",
  "? [a, b]\n: {c: d}\n", "a:\n - one\n - two\n", "a: x # comment\n",
  "# comment\n\n---\na: 1\n...\n", "%YAML 1.2 # comment\n---\na: 1\n",
  "\uFEFFa: 1\n", "a: |+\n  x\n\n\n", "a: plain\n  continuation\n\n  last\n",
  "a: x\r\nb: y\r\n", "a: [\"x\":y, a:b, x: null, ?key]\n", "a: !foo!bar &x value\n",
  "a:\n  ? key\n  : value\n  next: yes\n", "a:\n  - key: value\n    other: [1, 2]\n  - last\n",
  "a: {}\nb: []\n", "a: {x, y: , : z}\n", "a: [foo: bar, ? baz, : value]\n",
  "a:\n\n# comment\nb: two\n", "a:\n  # comment\n  b: 1\n# outer\nc: 2\n",
];
it.each(cases)("retains existing YAML CST for %j", text => compare(text));
it("preserves generated flow and block collection CST", async () => {
  for (const value of ["word", "'quoted'", "[a, b, {c: d}]", "&ref [*ref]", "!!str 12", "|2+\n    a\n\n", ">-\n    a\n      b\n    c\n"]) {
    for (const ending of ["\n", " # comment\n", "\r\n"]) {
      await compare(`outer:\n  key: ${value}${ending}  next: true\nlast: end\n`);
      await compare(`outer:\n  - ${value}${ending}  - next\nlast: end\n`);
    }
  }
});

it("matches generated malformed and nested CST boundaries", async () => {
  let seed = 627;
  const next = (max: number) => {seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % max;};
  const parts = ["[", "]", "{", "}", ",", " ", "\t", "\n  ", "\r\n ", "key: ", "? ", "- ", "plain", "'a''b'", "&a ", "*a ", "!!str ", "# comment\n", "|+\n  x\n"];
  for (let index = 0; index < 600; index++) {
    let text = "key: "; for (let count = next(12); count >= 0; count--) text += parts[next(parts.length)];
    await compare(text + "\n");
  }
});
it("preserves comment and empty-node ownership across block collections", async () => {
  for (const property of ["", "&anchor ", "!!str ", "? "]) for (const gap of ["\n", "\n\n", "\n # low\n", "\n    # high\n", "\n\n    # high\n\n", " # inline\n"]) {
    await compare(`a:\n  ${property}key:${gap}  next: value\nlast: yes\n`);
    await compare(`a:\n  - ${property}value${gap}  - next\nlast: yes\n`);
  }
});
it("backs growing collections and construction depth with fixed-size transfers", async () => {
  for (const text of ["key: [" + "word, ".repeat(2000) + "]\n", "key: " + "[".repeat(300) + "value" + "]".repeat(300) + "\n", "key: |+\n  value\n" + "  \n".repeat(2000)]) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1);
    const source = new RetainedSourceText(input, async () => {}), tree = new RetainedYamlCst(storage, async () => {});
    await source.append([text]);
    const read = storage.read.bind(storage), write = storage.write.bind(storage); let maximum = 0;
    storage.read = async (position, length) => {maximum = Math.max(maximum, length); return read(position, length);};
    storage.write = async (position, bytes) => {maximum = Math.max(maximum, bytes.length); return write(position, bytes);};
    try {
      let documents = 0;
      for await (const ref of new RetainedYamlParser(source, {start: 0, end: source.length}, tree, async () => {}).parse()) if ((await tree.get(ref)).type === "document") documents++;
      expect(documents).toBe(1); expect(maximum).toBeLessThanOrEqual(104);
    } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
it("propagates cancellation and backing errors through collection retirement", async () => {
  for (const mode of ["cancel", "read", "write"]) {
    const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
    const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
    await source.append(["key: [" + "value, ".repeat(100) + "]\n"]);
    const reason = new Error(mode); let count = 0;
    const cooperate = async () => {if (mode === "cancel" && ++count === 100) throw reason;};
    if (mode === "read") {const read = storage.read.bind(storage); storage.read = async (position, length) => {if (++count === 100) throw reason; return read(position, length);};}
    if (mode === "write") {const write = storage.write.bind(storage); storage.write = async (position, bytes) => {if (++count === 100) throw reason; return write(position, bytes);};}
    try {
      const tree = new RetainedYamlCst(storage, cooperate);
      await expect((async () => {for await (const ref of new RetainedYamlParser(source, {start: 0, end: source.length}, tree, cooperate).parse()) void ref;})()).rejects.toBe(reason);
    } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
  }
});
it("moves a long property prefix without quadratic list traversal", async () => {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {});
  const text = "key: " + "&a ".repeat(1000) + "value: yes\n"; await source.append([text]);
  const read = storage.read.bind(storage); let reads = 0;
  storage.read = async (position, length) => {reads++; return read(position, length);};
  try {
    const tree = new RetainedYamlCst(storage, async () => {});
    for await (const ref of new RetainedYamlParser(source, {start: 0, end: source.length}, tree, async () => {}).parse()) void ref;
    expect(reads).toBeLessThan(text.length * 30);
  } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
});

it("honors nonzero frontmatter spans without reading adjacent document text", async () => {
  await compare("title: value\nmap: {a: [b, c]}\nblock: |\n  content\n", 17);
});
it.each(["a: 1", "a: [b, c]", "---\na: 1\n...\n---\nb: 2\n", "a: 'unterminated", "a: [\nvalue\n]\n"])("preserves document boundaries for %j", text => compare(text));
