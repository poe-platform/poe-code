import {expect, it} from "vitest";
import {convert, inspectFormats} from "./index.js";

const source = "-------  -------\nHeader   Right\n-------  -------\nabc      xyz\n\ndef      uvw\n-------  -------\n";
const attr = ["", [], []];
const row = (...cells: string[]) => [attr, cells.map(c => [attr, {t: "AlignDefault"}, 1, 1, [{t: "Plain", c: [{t: "Str", c}]}]])];
// pandoc 3.8.3 -f markdown -t json
const expected = {t: "Table", c: [attr, [null, []], [
  [{t: "AlignLeft"}, {t: "ColWidth", c: 0.125}], [{t: "AlignLeft"}, {t: "ColWidth", c: 0.125}]
], [attr, [row("Header", "Right")]], [[attr, 0, [], [row("abc", "xyz"), row("def", "uvw")]]], [attr, []]]};
async function output(text = source, from = "markdown", to = "json", fileScope = false) {
  const result = await convert([{bytes: new TextEncoder().encode(text)}], {from, to, fileScope}, {});
  if (result.kind !== "text") throw new Error("Expected text output");
  return to === "json" ? JSON.parse(result.text).blocks : result.text;
}
it.each([false, true])("matches native multiline table JSON (fileScope=%s)", async fileScope => {
  expect(await output(source, "markdown", "json", fileScope)).toEqual([expected]);
});
it("preserves native HTML rows, widths and alignment", async () => {
  const html = await output(source, "markdown", "html");
  expect(html).toContain('<table style="width:25%;">');
  expect(html).toContain('<col style="width: 12%" />');
  expect(html).toContain('style="text-align: left;"');
  for (const text of ["Header", "Right", "abc", "xyz", "def", "uvw"]) expect(html).toContain(`>${text}</`);
  expect(html).not.toContain("<hr");
});
it("honors multiline_tables independently of simple_tables", async () => {
  expect(inspectFormats(["--list-extensions=markdown"])).toContain("+multiline_tables");
  for (const from of ["md", "markdown-simple_tables", "gfm+multiline_tables"]) expect(await output(source, from)).toEqual([expected]);
  const disabled = await output(source, "markdown-multiline_tables");
  expect(disabled.find((block: {t: string}) => block.t === "Table").c[4][0][3]).toHaveLength(1);
  for (const from of ["gfm", "commonmark", "markdown-multiline_tables-simple_tables"]) expect((await output(source, from)).some((b: {t: string}) => b.t === "Table")).toBe(false);
});
it("preserves wrapped cells, following text, quotes and code", async () => {
  const wrapped = await output(source.replace("abc      xyz", "abc      xyz\nmore     text") + "\nAfter");
  expect(wrapped.map((b: {t: string}) => b.t)).toEqual(["Table", "Para"]);
  expect(wrapped[0].c[4][0][3][0][1][0][4][0].c).toEqual([{t: "Str", c: "abc"}, {t: "SoftBreak"}, {t: "Str", c: "more"}]);
  expect(await output(source.trimEnd().split("\n").map(line => "> " + line).join("\n"))).toEqual([{t: "BlockQuote", c: [expected]}]);
  expect((await output("```\n" + source + "```"))[0].t).toBe("CodeBlock");
});
it("charges every cell against the table quota", async () => {
  await expect(convert([{bytes: new TextEncoder().encode(source)}], {from: "markdown", to: "json"}, {limits: {tableCells: 5}})).rejects.toMatchObject({code: "E_LIMIT"});
});

it.each([source, source.replace("Header   Right\n-------  -------\n", ""), source.replace("abc      xyz", "abc      xyz\nmore     text"), source + "\nAfter", source.trimEnd().split("\n").map(line => "> " + line).join("\n")])("matches the retained reader for %j", async text => {
  const {MemoryFileSystem} = await import("@poe-code/safe-fs/fs/memory");
  const {PagedStorage} = await import("safe-bash-io-engine/storage");
  const {ExecutionContext} = await import("./execution.js");
  const {RetainedSourceText} = await import("./retained-source-text.js");
  const {RetainedCommonMarkBlocks} = await import("./retained-commonmark-blocks.js");
  const {RetainedRtfAst} = await import("./retained-rtf-ast.js");
  const {BackedJson} = await import("./backed-json.js");
  const {assembleRetainedCommonMark} = await import("./retained-commonmark-document.js");
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {}), stores: InstanceType<typeof PagedStorage>[] = [];
  const store = () => {const value = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1); stores.push(value); return value;};
  try {
    const input = new RetainedSourceText(store(), units => context.cooperate(units)); await input.append([text]);
    const extensions = {multiline_tables: true};
    const parser = new RetainedCommonMarkBlocks(input, store(), context, "input", extensions); await parser.parse({start: 0, end: text.length});
    const ast = new RetainedRtfAst(store(), units => context.cooperate(units));
    const blocks = await assembleRetainedCommonMark(parser, ast, store(), context, extensions);
    const wire = new BackedJson(store(), units => context.cooperate(units)); await ast.write(blocks, wire);
    let actual = ""; for await (const bytes of wire.chunks()) actual += new TextDecoder().decode(bytes);
    expect(JSON.parse(actual)).toEqual(await output(text));
  } finally {for (const store of stores) await store.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});

it("matches native headerless tables and continuous outer borders", async () => {
  const headless = structuredClone(expected);
  headless.c[3] = [attr, []];
  expect(await output(source.replace("Header   Right\n-------  -------\n", ""))).toEqual([headless]);
  expect(await output(source.replace("-------  -------", "----------------").trimEnd().slice(0, -16) + "----------------\n")).toEqual([expected]);
});
it("leaves incomplete multiline tables to the other Markdown rules", async () => {
  const blocks = await output(source.split("\n").slice(0, -2).join("\n"), "markdown-simple_tables");
  expect(blocks.some((block: {t: string}) => block.t === "Table")).toBe(false);
});
