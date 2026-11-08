import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {BackedJson} from "./backed-json.js";
import {parseBackedJson} from "./backed-json-parser.js";
import {validateBackedPandoc} from "./backed-pandoc.js";

async function validate(value: unknown): Promise<void> {
  const fs = new MemoryFileSystem(), signal = new AbortController().signal;
  const context = new ExecutionContext("convert", {signal});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal}, 1);
  const scratch = new PagedStorage({fs, cwd: "/", env: {}, signal}, 1);
  const tree = new BackedJson(storage, units => context.cooperate(units));
  try {
    const json = JSON.stringify(value);
    await parseBackedJson((async function* () {for (let i = 0; i < json.length; i += 4096) yield json.slice(i, i + 4096);})(), tree, scratch, units => context.cooperate(units), (_offset, message) => {throw new Error(message);});
    await validateBackedPandoc(tree, scratch, context);
  } finally {await storage.close(); await scratch.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}
const root = (blocks: unknown[], meta: unknown = {}) => ({"pandoc-api-version": [1,23,1,2], meta, blocks});
const attr = ["", [], []];
const inline = [{t: "Str", c: "text"}];
it("validates recursive wire constructors and metadata through retained cursors", async () => {
  await validate(root([
    {t: "Para", c: [{t: "Quoted", c: [{t: "DoubleQuote"}, inline]}, {t: "Note", c: [{t: "Para", c: inline}]}]},
    {t: "OrderedList", c: [[1, {t: "Decimal"}, {t: "Period"}], [[{t: "CodeBlock", c: [attr, "x".repeat(50000)]}]]]},
    {t: "Figure", c: [attr, [null, []], [{t: "HorizontalRule"}]]}
  ], {title: {t: "MetaString", c: "title"}, deep: {t: "MetaMap", c: {flag: {t: "MetaBool", c: true}}}}));
});
it.each([
  root([{t: "Unknown"}]), root([{t: "HorizontalRule", c: []}]), root([{t: "Para", c: [{t: "Str", c: 1}]}]),
  root([{t: "Header", c: [0, attr, inline]}]), root([{t: "Para", c: [{t: "Quoted", c: ["DoubleQuote", inline]}]}]),
  root([], {bad: {t: "MetaBool", c: 1}}), root([], {bad: {t: "MetaString", c: "\ud800"}}),
  {...root([]), extra: 1}, {...root([]), "pandoc-api-version": [1,22,1,2]},
  root([], {constructor: {t: "MetaString", c: "forbidden"}})
])("rejects invalid wire documents", async value => {await expect(validate(value)).rejects.toMatchObject({code: "E_AST"});});
it("validates table span geometry with caller-backed occupancy state", async () => {
  const cell = (row: number, column: number) => [attr, {t: "AlignDefault"}, row, column, []];
  const table = (rows: unknown[]) => root([{t: "Table", c: [attr, [null, []], [[{t: "AlignDefault"}, {t: "ColWidthDefault"}], [{t: "AlignDefault"}, {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], rows]], [attr, []]]}]);
  await validate(table([[attr, [cell(2, 1), cell(1, 1)]], [attr, [cell(1, 1)]]]));
  await expect(validate(table([[attr, [cell(2, 1)]]]))).rejects.toMatchObject({code: "E_AST"});
  await expect(validate(table([[attr, [cell(1, 1)]]]))).rejects.toMatchObject({code: "E_AST"});
});
