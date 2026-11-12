import {expect, it} from "vitest";
import {convert, inspectFormats} from "./index.js";

const source = "+--------+-------+\n| Header | Right |\n+========+=======+\n| abc    | xyz   |\n+--------+-------+\n";
const attr = ["", [], []];
const row = (...cells: string[]) => [attr, cells.map(c => [attr, {t: "AlignDefault"}, 1, 1, [{t: "Plain", c: [{t: "Str", c}]}]])];
// Native Pandoc 3.8.3: pandoc -f markdown -t json.
const expected = {t: "Table", c: [attr, [null, []], [
  [{t: "AlignDefault"}, {t: "ColWidth", c: 9 / 72}],
  [{t: "AlignDefault"}, {t: "ColWidth", c: 8 / 72}]
], [attr, [row("Header", "Right")]], [[attr, 0, [], [row("abc", "xyz")]]], [attr, []]]};
async function output(text = source, from = "markdown", to = "json", fileScope = false) {
  const result = await convert([{bytes: new TextEncoder().encode(text)}], {from, to, fileScope}, {});
  if (result.kind !== "text") throw new Error("Expected text output");
  return to === "json" ? JSON.parse(result.text).blocks : result.text;
}
it.each([false, true])("matches native grid-table JSON (fileScope=%s)", async fileScope => {
  expect(await output(source, "markdown", "json", fileScope)).toEqual([expected]);
});
it("preserves native HTML table content and widths with the existing HTML serializer", async () => {
  const html = await output(source, "markdown", "html");
  expect(html).toContain('<table style="width:24%;">');
  expect(html).toContain('<col style="width: 12%" />');
  expect(html).toContain('<col style="width: 11%" />');
  for (const cell of ['<th>Header</th>', '<th>Right</th>', "<td>abc</td>", "<td>xyz</td>"]) expect(html).toContain(cell);
});
it("honors the extension without changing GFM defaults", async () => {
  expect(inspectFormats(["--list-extensions=markdown"])).toContain("+grid_tables");
  expect((await output(source, "markdown-grid_tables"))[0].t).toBe("Para");
  expect((await output(source, "gfm"))[0].t).toBe("Para");
  expect(await output(source, "gfm+grid_tables")).toEqual([expected]);
});
it("leaves malformed grids as text", async () => {
  expect((await output(source.replace("| abc    | xyz   |", "| abc | xyz |")))[0].t).toBe("Para");
});

it("reads headerless grids, multiline cells, block content, and following text", async () => {
  const text = "+----------+-------+\n| first    | - one |\n| second   | - two |\n+----------+-------+\nafter";
  const blocks = await output(text);
  expect(blocks.map((block: {t: string}) => block.t)).toEqual(["Table", "Para"]);
  expect(blocks[0].c[3]).toEqual([attr, []]);
  expect(blocks[0].c[4][0][3][0][1][0][4]).toEqual([{t: "Plain", c: [{t: "Str", c: "first"}, {t: "SoftBreak"}, {t: "Str", c: "second"}]}]);
  expect(blocks[0].c[4][0][3][0][1][1][4][0].t).toBe("BulletList");
});

it("reads grids within block quotes and leaves fenced grids literal", async () => {
  const quote = await output(source.trimEnd().split("\n").map(line => "> " + line).join("\n"));
  expect(quote).toEqual([{t: "BlockQuote", c: [expected]}]);
  expect((await output("```\n" + source + "```"))[0].t).toBe("CodeBlock");
});

it.each([source, source.replace("+========+=======+", "+--------+-------+"), source + "after"])("matches the retained reader for %j", async text => {
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
    const extensions = {grid_tables: true};
    const parser = new RetainedCommonMarkBlocks(input, store(), context, "input", extensions); await parser.parse({start: 0, end: text.length});
    const ast = new RetainedRtfAst(store(), units => context.cooperate(units));
    const blocks = await assembleRetainedCommonMark(parser, ast, store(), context, extensions);
    const wire = new BackedJson(store(), units => context.cooperate(units)); await ast.write(blocks, wire);
    let actual = ""; for await (const bytes of wire.chunks()) actual += new TextDecoder().decode(bytes);
    expect(JSON.parse(actual)).toEqual(await output(text));
  } finally {for (const store of stores) await store.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
});

it("accounts grid cells against the conversion quota", async () => {
  await expect(convert([{bytes: new TextEncoder().encode(source)}], {from: "markdown", to: "json"}, {limits: {tableCells: 3}})).rejects.toMatchObject({code: "E_LIMIT"});
});
