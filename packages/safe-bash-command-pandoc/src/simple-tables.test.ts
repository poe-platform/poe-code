import {expect, it} from "vitest";
import {convert, readDocument, inspectFormats} from "./index.js";

const fixture = "Header  Right\n------  -----\nabc     xyz\ndef     uvw\n";
const read = async (text: string, from = "markdown") => (await readDocument({bytes: new TextEncoder().encode(text)}, {from}, {})).blocks;

it("reads the native Pandoc simple-table fixture with both body rows", async () => {
  const [table] = await read(fixture);
  expect(table?.t).toBe("Table");
  if (table?.t !== "Table") throw new Error("Expected Table");
  expect(table.c[2]).toEqual([["AlignDefault", {t: "ColWidthDefault"}], ["AlignDefault", {t: "ColWidthDefault"}]]);
  const cell = (text: string) => [["", [], []], "AlignDefault", 1, 1, [{t: "Plain", c: [{t: "Str", c: text}]}]];
  expect(table.c[3]).toEqual([["", [], []], [[["", [], []], [cell("Header"), cell("Right")]]]]);
  expect(table.c[4]).toEqual([[["", [], []], 0, [], [
    [["", [], []], [cell("abc"), cell("xyz")]],
    [["", [], []], [cell("def"), cell("uvw")]]
  ]]]);
  for (const to of ["html", "json"]) {
    const result = await convert([{bytes: new TextEncoder().encode(fixture)}], {from: "markdown", to}, {});
    expect(result.kind).toBe("text");
    if (result.kind !== "text") throw new Error("Expected text");
    if (to === "json") expect(JSON.parse(result.text).blocks[0].t).toBe("Table");
    else {
      expect(result.text).toContain("<table>");
      for (const text of ["Header", "Right", "abc", "xyz", "def", "uvw"]) expect(result.text).toContain(`>${text}</`);
      expect(result.text).not.toContain("<hr");
    }
  }
});

it("enables simple tables for Markdown and honors the extension switch", async () => {
  expect(inspectFormats(["--list-extensions=markdown"])).toContain("+simple_tables");
  for (const from of ["md", "gfm+simple_tables", "markdown-simple_tables+simple_tables"]) expect((await read(fixture, from))[0]?.t).toBe("Table");
  for (const from of ["gfm", "commonmark", "markdown-simple_tables"]) expect((await read(fixture, from)).some(block => block.t === "Table")).toBe(false);
});

it("uses dash-column widths, header alignment, inline markup and a closing separator", async () => {
  const blocks = await read("Left     Right   Center\n-------  ------  -------\n**a**    b       c\nx        y       z\n-------  ------  -------\n\nAfter");
  expect(blocks.map(block => block.t)).toEqual(["Table", "Para"]);
  const table = blocks[0]!;
  if (table.t !== "Table") throw new Error("Expected Table");
  expect(table.c[2].map(column => column[0])).toEqual(["AlignLeft", "AlignLeft", "AlignLeft"]);
  expect(table.c[4][0]![3]).toHaveLength(2);
  expect(table.c[4][0]![3][0]![1][0]![4]).toEqual([{t: "Plain", c: [{t: "Strong", c: [{t: "Str", c: "a"}]}]}]);
});

it("preserves code blocks and rejects malformed separators", async () => {
  for (const source of ["```\n" + fixture + "```", "Header  Right\n------  --x--\nabc     xyz", "Header  Right\n______  _____\nabc     xyz"]) {
    expect((await read(source)).some(block => block.t === "Table")).toBe(false);
  }
});

it("charges every header and body cell against the table budget", async () => {
  await expect(readDocument({bytes: new TextEncoder().encode(fixture)}, {from: "markdown"}, {limits: {tableCells: 5}})).rejects.toMatchObject({code: "E_LIMIT"});
});

it("keeps a header and separator without body rows as paragraph text", async () => {
  for (const text of ["Header  Right\n------  -----\n", "Header  Right\n------  -----\n\nAfter"]) {
    const blocks = await read(text);
    expect(blocks.every(block => block.t === "Para")).toBe(true);
  }
});
