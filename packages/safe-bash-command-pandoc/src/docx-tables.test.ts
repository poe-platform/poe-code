import "safe-bash-docx-engine";
import {expect, it} from "vitest";
import {readZipArchiveEntries} from "@poe-code/office-package/zip-sync";
import {SaxesParser} from "saxes";
import {convert, writeDocument} from "./engine.js";
import type {Block, Row} from "./ast-types.js";

const attr = ["", [], []] as const;
const context = {yield: async () => {}};
function elements(bytes: Uint8Array, name: string) {
  const values: Record<string, string>[] = [];
  const parser = new SaxesParser();
  parser.on("opentag", node => {
    if (node.name === name) values.push(node.attributes as Record<string, string>);
  });
  parser.write(new TextDecoder().decode(readZipArchiveEntries(bytes).get("word/document.xml"))).close();
  return values;
}
it("preserves Markdown numeric column alignment in every DOCX row", async () => {
  const result = await convert([{bytes: new TextEncoder().encode("| Item | Qty |\n|---|---:|\n| Apples | 2 |\n| Pears | 3 |\n")}], {from: "markdown", to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  expect(elements(result.bytes, "w:jc").map(value => value["w:val"])).toEqual(["right", "right", "right"]);
});
it("preserves explicit column widths and cell alignment overrides in headers, bodies and footers", async () => {
  const row: Row = [attr, [
    [attr, "AlignDefault", 1, 1, [{t: "Para", c: [{t: "Str", c: "left"}]}]],
    [attr, "AlignCenter", 1, 1, [{t: "Para", c: [{t: "Str", c: "center"}]}]]
  ]];
  const table: Block = {t: "Table", c: [attr, [null, []], [["AlignLeft", {t: "ColWidth", c: 0.2}], ["AlignRight", {t: "ColWidth", c: 0.6}]], [attr, [row]], [[attr, 0, [], [row]]], [attr, [row]]]};
  const result = await writeDocument({blocks: [table], metadata: {}, resources: []}, {to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  expect(elements(result.bytes, "w:jc").map(value => value["w:val"])).toEqual(["left", "center", "left", "center", "left", "center"]);
  expect(elements(result.bytes, "w:tblW")).toEqual([{"w:w": "4000", "w:type": "pct"}]);
  const grid = elements(result.bytes, "w:gridCol").map(value => Number(value["w:w"]));
  expect(grid[1]! / grid[0]!).toBeCloseTo(3, 2);
  expect(elements(result.bytes, "w:tcW")).toEqual(Array.from({length: 3}, () => [{"w:w": "1250", "w:type": "pct"}, {"w:w": "3750", "w:type": "pct"}]).flat());
});
it("keeps nested table formatting independent and leaves following paragraphs unaligned", async () => {
  const nested: Block = {t: "Table", c: [attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], [[attr, [[attr, "AlignDefault", 1, 1, [{t: "Para", c: [{t: "Str", c: "nested"}]}]]]]]]], [attr, []]]};
  const outer: Block = {t: "Table", c: [attr, [null, []], [["AlignRight", {t: "ColWidth", c: 0.5}]], [attr, []], [[attr, 0, [], [[attr, [[attr, "AlignDefault", 1, 1, [{t: "BulletList", c: [[{t: "Para", c: [{t: "Str", c: "list"}]}]]}, nested]]]]]]], [attr, []]]};
  const result = await writeDocument({blocks: [outer, {t: "Para", c: [{t: "Str", c: "after"}]}], metadata: {}, resources: []}, {to: "docx"}, context);
  if (result.kind !== "binary") throw new Error("Expected DOCX");
  expect(elements(result.bytes, "w:jc").map(value => value["w:val"])).toEqual(["right"]);
  expect(elements(result.bytes, "w:tblW")[0]).toEqual({"w:w": "2500", "w:type": "pct"});
  expect(elements(result.bytes, "w:tblW")[1]!["w:type"]).toBe("dxa");
  expect(new TextDecoder().decode(readZipArchiveEntries(result.bytes).get("word/document.xml"))).toContain(">nested</w:t>");
});
