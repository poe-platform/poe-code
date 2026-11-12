import "safe-bash-docx-engine";
import {expect, it} from "vitest";
import {Document} from "safe-bash-docx-engine/pandoc-adapter";
import type {Block, Row} from "./ast-types.js";
import {convert, readDocument, writeDocument} from "./engine.js";

it.each([
  "- one\n- two\n",
  "3. one\n4. two\n",
  "- outer\n  - inner\n- sibling\n",
  "- outer\n  1. inner\n  2. next\n- sibling\n",
  "- one\n\n- two\n",
  "- one\n\nEnd.\n\n3. two\n",
])("recovers DOCX list structure: %s", async markdown => {
  const input = [{bytes: new TextEncoder().encode(markdown)}];
  const docx = await convert(input, {from: "markdown", to: "docx"}, {});
  if (docx.kind !== "binary") throw new Error("Expected DOCX");
  for (const to of ["json", "html"] as const) {
    const expected = await convert(input, {from: "markdown", to}, {});
    const actual = await convert([{bytes: docx.bytes}], {from: "docx", to}, {});
    expect(actual).toEqual(expected);
  }
});

it("honors instance start overrides", async () => {
  const output = await convert([{bytes: new TextEncoder().encode("1. one\n2. two\n")}], {from: "markdown", to: "docx"}, {});
  if (output.kind !== "binary") throw new Error("Expected DOCX");
  const model = await Document(output.bytes);
  const edge = [...model.part.rels.values()].find(edge => edge.reltype.endsWith("/numbering"))!;
  const part = edge.target_part.partname.toString();
  model.store.change(part, xml => {
    const num = xml.root.children.find(child => child.localName === "num")!;
    xml.insertChildren(num, `<w:lvlOverride xmlns:w="${xml.root.namespace}" w:ilvl="0"><w:startOverride w:val="7"/></w:lvlOverride>`);
  });
  const chunks: Uint8Array[] = [];
  await model.save({async write(bytes) {chunks.push(bytes.slice());}});
  const document = await readDocument({bytes: Buffer.concat(chunks)}, {from: "docx"}, {});
  expect(document.blocks[0]).toMatchObject({t: "OrderedList", c: [[7, "Decimal", "Period"], expect.any(Array)]});
});

it("keeps list numbering independent across table cells and body paragraphs", async () => {
  const attr = ["", [], []] as const;
  const list: Block = {t: "OrderedList", c: [[3, "UpperRoman", "TwoParens"], [[{t: "Plain", c: [{t: "Str", c: "item"}]}]]]};
  const row: Row = [attr, [
    [attr, "AlignDefault", 1, 1, [list]],
    [attr, "AlignDefault", 1, 1, [list]]
  ]];
  const table: Block = {t: "Table", c: [attr, [null, []], [["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]], [attr, []], [[attr, 0, [], [row]]], [attr, []]]};
  const blocks = [list, table, list];
  const output = await writeDocument({blocks, metadata: {}, resources: []}, {to: "docx"}, {});
  if (output.kind !== "binary") throw new Error("Expected DOCX");
  const expectedTable: Block = {...table, c: [table.c[0], table.c[1], [["AlignDefault", {t: "ColWidth", c: 0.4235294117647059}], ["AlignDefault", {t: "ColWidth", c: 0.4235294117647059}]], table.c[3], table.c[4], table.c[5]]};
  expect((await readDocument({bytes: output.bytes}, {from: "docx"}, {})).blocks).toEqual([list, expectedTable, list]);
});
