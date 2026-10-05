import {expect, it} from "vitest";
import {parseDocument} from "yaml";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {RetainedSourceText} from "./retained-source-text.js";
import {RetainedYamlCst} from "./retained-yaml-cst.js";
import {RetainedYamlParser} from "./retained-yaml-parser.js";
import {RetainedYamlSyntaxError} from "./retained-yaml-scalar.js";
import {resolveRetainedYamlProps, resolveRetainedYamlEnd} from "./retained-yaml-props.js";

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
    else await expect(action).resolves.toBe(text.length);
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
