import {createRequire} from "node:module";
import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlCst} from "./retained-yaml-cst.js";
import {RetainedYamlParser} from "./retained-yaml-parser.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {resolveRetainedYamlProps, resolveRetainedYamlEnd, retainedYamlCommentChunks} from "./retained-yaml-props.js";

async function fixture(text: string, run: (source: RetainedSourceText, tree: RetainedYamlCst, document: number) => Promise<void>) {
  const fs = new MemoryFileSystem(), owner = {fs, cwd: "/", env: {}, signal: new AbortController().signal};
  const input = new PagedStorage(owner, 1), storage = new PagedStorage(owner, 1), source = new RetainedSourceText(input, async () => {}), tree = new RetainedYamlCst(storage, async () => {});
  await source.append([text]);
  try {
    for await (const ref of new RetainedYamlParser(source, {start: 0, end: source.length}, tree, async () => {}).parse()) if ((await tree.get(ref)).type === "document") {await run(source, tree, ref); return;}
    throw new Error("Document required");
  } finally {await input.close(); await storage.close(); expect(await fs.readdir("/")).toEqual([]);}
}
it.each(["&a value", "!tag value", "&a !tag value", "&a\nvalue", "\tvalue", "\t[one, two]", "&a &b value", "!a !b value", '&a"value"', '!tag"value"', "\tkey: value", "&a ---\nvalue", "--- &a\nvalue"])("validates root properties like the existing composer: %j", async text => {
  const native = parseDocument(text);
  await fixture(text, async (source, tree, ref) => {
    const doc = await tree.get(ref);
    const action = resolveRetainedYamlProps(source, tree, doc.start, {indicator: "doc-start", next: doc.value, offset: doc.offset!, parentIndent: 0, startOnNewline: true});
    if (native.errors.length) await expect(action).rejects.toBeInstanceOf(RetainedYamlSyntaxError);
    else await expect(action).resolves.toMatchObject({start: expect.any(Number), end: expect.any(Number)});
  });
});
it.each(['"value" # comment\n', '"value"#comment\n', '"value"\n', '"value" trailing\n', "*a # comment\n", "*a#comment\n"])("validates node endings: %j", async text => {
  const native = parseDocument(text);
  await fixture(text, async (source, tree, ref) => {
    const doc = await tree.get(ref), value = await tree.get(doc.value!);
    const range = value.source!; if (typeof range === "string") throw new Error("Source span required");
    const action = resolveRetainedYamlEnd(tree, value.end, range.end, true);
    if (native.errors.length) await expect(action).rejects.toBeInstanceOf(RetainedYamlSyntaxError);
    else await expect(action).resolves.toMatchObject({offset: text.length});
    void source;
  });
});
it("retains property references and newline positions without collecting comments", async () => {
  const text = "&name !tag #" + "x".repeat(65536) + "\nvalue";
  await fixture(text, async (source, tree, ref) => {
    source.chunks = () => {throw new Error("Properties must not collect text");};
    const doc = await tree.get(ref), props = await resolveRetainedYamlProps(source, tree, doc.start, {indicator: "doc-start", next: doc.value, offset: doc.offset!, parentIndent: 0, startOnNewline: true});
    expect((await tree.get(props.anchor!)).type).toBe("anchor"); expect((await tree.get(props.tag!)).type).toBe("tag");
    expect((await tree.get(props.newlineAfterProp!)).offset).toBe(text.indexOf("\n"));
    expect(props.hasNewline).toBe(true); expect(props.comment).toBe(true); expect(props.start).toBe(0); expect(props.end).toBe(text.indexOf("value"));
  });
});

const require = createRequire(import.meta.url);
const yamlRoot = require.resolve("yaml/package.json").slice(0, -"package.json".length);
const {resolveProps} = require(yamlRoot + "dist/compose/resolve-props.js");
const {resolveEnd} = require(yamlRoot + "dist/compose/resolve-end.js");

it("preserves comment separators and blank lines like the native property resolver", async () => {
  const pieces = [" ", "#", "# hello", "\n", "\r\n"];
  let seed = 1772;
  for (let sample = 0; sample < 180; sample++) {
    const tokens: {type: string; source: string; offset: number; indent: number}[] = [];
    let raw = "";
    for (let i = 0; i < 16; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      const piece = pieces[seed % pieces.length]!;
      if (piece[0] === "#") {tokens.push({type: "space", source: " ", offset: raw.length, indent: 0}); raw += " ";}
      tokens.push({type: piece[0] === "#" ? "comment" : piece === " " ? "space" : piece[0] === "&" ? "anchor" : piece === "!" ? "tag" : "newline", source: piece, offset: raw.length, indent: 0}); raw += piece;
    }
    await fixture("value", async (source, tree) => {
      const base = source.length; await source.append([raw]);
      const list = await tree.list();
      for (const token of tokens) await tree.push(list, await tree.create({type: token.type as "comment", offset: base + token.offset, indent: 0, source: {start: base + token.offset, end: base + token.offset + token.source.length}}));
      const options = {indicator: "doc-start" as const, offset: base, parentIndent: 0, startOnNewline: true};
      const errors: unknown[] = [];
      const expected = resolveProps(tokens, {...options, onError: (...args: unknown[]) => errors.push(args)});
      if (errors.length) {await expect(resolveRetainedYamlProps(source, tree, list, options)).rejects.toBeInstanceOf(RetainedYamlSyntaxError); return;}
      const actual = await resolveRetainedYamlProps(source, tree, list, options);
      let comment = ""; for await (const part of retainedYamlCommentChunks(source, tree, actual.commentTokens)) comment += part;
      expect(comment).toBe(expected.comment); expect(actual.spaceBefore).toBe(expected.spaceBefore);
    });
  }
});
it.each([" # first\n # second\n\n", " #\r\n # next\r\n", " # first\n\n # last", "\n\n", " #" + "x".repeat(65536) + "\n"])("retains exact trailing comments: %j", async suffix => {
  await fixture('"value"' + suffix, async (source, tree, ref) => {
    const node = await tree.get((await tree.get(ref)).value!);
    const tokens = [];
    for await (const item of tree.values(node.end!)) {
      const token = await tree.get(item); let text = "";
      if (typeof token.source !== "string") for await (const part of source.chunks(token.source!)) text += part;
      tokens.push({...token, source: text});
    }
    const expected = resolveEnd(tokens, 7, true, () => {throw new Error("Unexpected syntax error");});
    const actual = await resolveRetainedYamlEnd(tree, node.end, 7, true);
    let comment = ""; for await (const part of retainedYamlCommentChunks(source, tree, actual.commentTokens)) {expect(part.length).toBeLessThanOrEqual(8192); comment += part;}
    expect(comment).toBe(expected.comment); expect(actual.offset).toBe(expected.offset);
  });
});

it("propagates comment backing and source failures without changing their identity", async () => {
  await fixture('"value" # comment\n', async (source, tree, ref) => {
    const node = await tree.get((await tree.get(ref)).value!), failure = new Error("injected comment write failure");
    const push = tree.push.bind(tree); tree.push = async () => {throw failure;};
    await expect(resolveRetainedYamlEnd(tree, node.end, 7, true)).rejects.toBe(failure);
    tree.push = push;
    const ending = await resolveRetainedYamlEnd(tree, node.end, 7, true);
    source.chunks = () => {throw failure;};
    await expect(retainedYamlCommentChunks(source, tree, ending.commentTokens).next()).rejects.toBe(failure);
  });
});
it("preserves blank-line suppression after a sequence indicator and skips closing delimiters", async () => {
  await fixture("-\n\n  value\n", async (source, tree, ref) => {
    const sequence = await tree.get((await tree.get(ref)).value!), item = await tree.get((await tree.at(sequence.items!, 0))!);
    const props = await resolveRetainedYamlProps(source, tree, item.start, {indicator: "seq-item-ind", next: item.value, offset: 0, parentIndent: 0, startOnNewline: true});
    expect(props.spaceBefore).toBe(false);
  });
  await fixture("[value] # tail\n", async (source, tree, ref) => {
    const collection = await tree.get((await tree.get(ref)).value!);
    const end = await resolveRetainedYamlEnd(tree, collection.end, 7, true, 1);
    let comment = ""; for await (const part of retainedYamlCommentChunks(source, tree, end.commentTokens)) comment += part;
    expect(comment).toBe(" tail"); expect(end.offset).toBe(source.length);
  });
});
