import {expect, it, vi} from "vitest";
import {SaxesParser} from "saxes";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {convert, writeDocument} from "./engine.js";
import type {Attr, Block, Cell, Row} from "./ast-types.js";

vi.mock("../../office-package/src/runtime.js", async original => {
  const runtime = await original<typeof import("../../office-package/src/runtime.js")>();
  return {...runtime, yieldEventLoop: async () => {}, defaultRuntime: {...runtime.defaultRuntime, async yieldTurn(signal: AbortSignal) {signal.throwIfAborted();}}};
});
const context = {yield: async () => {}};
const attr: Attr = ["", [], []];
const cell = (text: string, attributes: Attr = attr): Cell => [attributes, "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Str", c: text}]}]];
const row = (...cells: Cell[]): Row => [attr, cells];

function cells(bytes: Uint8Array) {
  const xml = new TextDecoder().decode(readZipArchiveEntries(bytes).get("ppt/slides/slide1.xml"));
  const result: {text: string; bold: boolean}[][] = [];
  let current: {text: string; bold: boolean}[] | undefined, bold = false, inText = false;
  const parser = new SaxesParser({xmlns: true});
  parser.on("opentag", tag => {
    if (tag.local === "tc") {current = []; result.push(current);}
    if (tag.local === "r") bold = false;
    if (tag.local === "rPr") bold = Object.values(tag.attributes).some(a => a.local === "b" && a.value === "1");
    if (tag.local === "t") inText = true;
  });
  parser.on("text", text => {if (current && inText) current.push({text, bold});});
  parser.on("closetag", tag => {if (tag.local === "t") inText = false; if (tag.local === "tc") current = undefined;});
  parser.write(xml).close();
  return result;
}

it.each([
  ["row headers", "<table><tbody><tr><th>Fruit</th><td>Apple</td></tr><tr><th>Color</th><td>Red</td></tr></tbody></table>", [true, false, true, false]],
  ["body section headers", "<table><tbody><tr><th>Section</th><th>Details</th></tr><tr><td>Fruit</td><td>Apple</td></tr></tbody></table>", [true, true, false, false]],
  ["nonleading headers", "<table><tbody><tr><td>Apple</td><th>Fruit</th></tr><tr><th>Color</th><td>Red</td></tr></tbody></table>", [false, true, true, false]],
  ["explicit header scopes", '<table><tbody><tr><td>Apple</td><th scope=" COL ">Fruit</th></tr><tr><th scope="row">Color</th><td>Red</td></tr></tbody></table>', [false, true, true, false]],
] as const)("preserves HTML %s as emphasized PPTX cells", async (_name, html, bold) => {
  const result = await convert([{bytes: new TextEncoder().encode(html)}], {from: "html", to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  const actual = cells(result.bytes);
  expect(actual.map(runs => runs[0]!.bold)).toEqual(bold);
  expect(actual.flatMap(runs => runs.map(run => run.text)).join(" ")).toBe(html.replace(/<[^>]+>/g, " ").trim().replace(/\s+/g, " "));
});

it("keeps header emphasis local to each body and preserves rich cell runs", async () => {
  const linked: Cell = [attr, "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Emph", c: [{t: "Link", c: [attr, [{t: "Str", c: "Linked"}], ["https://example.com", ""]]}]}]}]];
  const table: Block = {t: "Table", c: [attr, [null, []], Array.from({length: 3}, () => ["AlignDefault", {t: "ColWidthDefault"}] as const),
    [attr, [row(cell("Top"), cell("Heading"), cell("Names"))]],
    [[attr, 2, [row(cell("Section"), cell("Local"), cell("Heads"))], [row(linked, cell("Row"), cell("Value"))]],
      [attr, 0, [], [row(cell("Regular"), cell("Scoped", ["", [], [["scope", "rowgroup"]]]), cell("Role", ["", [], [["role", "columnheader"]]]))]]], [attr, []]]};
  const result = await writeDocument({blocks: [table], metadata: {}, resources: []}, {to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  expect(cells(result.bytes).map(runs => runs[0])).toEqual([
    ...["Top", "Heading", "Names", "Section", "Local", "Heads", "Linked", "Row"].map(text => ({text, bold: true})),
    {text: "Value", bold: false}, {text: "Regular", bold: false}, {text: "Scoped", bold: true}, {text: "Role", bold: true},
  ]);
  const parts = readZipArchiveEntries(result.bytes);
  const xml = new TextDecoder().decode(parts.get("ppt/slides/slide1.xml"));
  expect(xml).toContain('i="1"');
  expect(xml).toContain("hlinkClick");
  expect(new TextDecoder().decode(parts.get("ppt/slides/_rels/slide1.xml.rels"))).toContain("https://example.com");
});

it("does not treat unrelated cell attributes as header hints", async () => {
  const table: Block = {t: "Table", c: [attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, []],
    [[attr, 0, [], [row(cell("Regular", ["", [], [["role", "cell"], ["scope", "unrecognized"]]]))]]], [attr, []]]};
  const result = await writeDocument({blocks: [table], metadata: {}, resources: []}, {to: "pptx"}, context);
  if (result.kind !== "binary") throw new Error("Expected PPTX");
  expect(cells(result.bytes)).toEqual([[{text: "Regular", bold: false}]]);
});
