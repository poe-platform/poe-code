import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {convert, convertToOutput, readDocument, writeDocument} from "./engine.js";
import {ExecutionContext} from "./execution.js";
import type {Attr, Block, Cell, Row} from "./ast-types.js";

const a: Attr = ["", [], []];
const p = (c: string): Block => ({t: "Para", c: [{t: "Str", c}]});
const cell = (text: string, attr = a): Cell => [attr, "AlignDefault", 1, 1, [p(text)]];
const row = (...cells: Cell[]): Row => [a, cells];
const table = (rows: Row[], heads = 0, head: Row[] = [], bodyHead: Row[] = [], foot: Row[] = []): Block => ({t: "Table", c: [a, [null, []],
  [["AlignLeft", {t: "ColWidthDefault"}], ["AlignRight", {t: "ColWidthDefault"}]], [a, head], [[a, heads, bodyHead, rows]], [a, foot]]});

async function output(input: string | Block[], retained: boolean): Promise<string> {
  if (retained && typeof input === "string") input = [...(await readDocument({bytes: new TextEncoder().encode(input)}, {from: "html"}, {})).blocks];
  const wire = typeof input === "string" ? input : await writeDocument({blocks: input, metadata: {}, resources: []}, {to: "json"}, {}).then(result => {
    if (result.kind !== "text") throw new Error("Expected JSON text");
    return result.text;
  });
  const source = {bytes: new TextEncoder().encode(wire)}, options = {from: typeof input === "string" ? "html" : "json", to: "rtf"};
  if (!retained) {
    const result = await convert([source], options, {});
    if (result.kind !== "text") throw new Error("Expected RTF text");
    return result.text;
  }
  const fs = new MemoryFileSystem(); let text = "";
  const acquire = vi.spyOn(ExecutionContext.prototype, "acquire").mockRejectedValue(new Error("Collector forbidden"));
  try {
    await convertToOutput([source], options, {workingFiles: {fs, directory: "/", cacheBytes: 16384}, output: {
      async write(bytes) {text += new TextDecoder().decode(bytes);}, async close() {}, async abort() {}
    }});
    return text;
  } finally {
    const calls = acquire.mock.calls.length; acquire.mockRestore(); expect(calls).toBe(0);
    expect(await fs.readdir("/")).toEqual([]);
  }
}
async function boldText(rtf: string): Promise<Map<string, boolean>> {
  const document = await readDocument({bytes: new TextEncoder().encode(rtf)}, {from: "rtf"}, {});
  const result = new Map<string, boolean>();
  function visit(value: unknown, bold = false): void {
    if (!value || typeof value !== "object") return;
    if ("t" in value && value.t === "Str" && "c" in value) result.set(String(value.c), bold);
    else for (const child of Object.values(value)) visit(child, bold || "t" in value && value.t === "Strong");
  }
  visit(document.blocks); return result;
}

for (const retained of [false, true]) {
  const route = retained ? "retained" : "collected";
  it(`${route}: preserves bare HTML row headers without making adjacent data bold`, async () => {
    const result = await boldText(await output("<table><tbody><tr><th>Label</th><td>Value</td></tr></tbody></table>", retained));
    expect(result.get("Label")).toBe(true); expect(result.get("Value")).toBe(false);
  });
  it(`${route}: styles canonical table heads, body heads and row heads through rich blocks`, async () => {
    const rich: Cell = [a, "AlignCenter", 1, 1, [p("First"), p("Second"), {t: "CodeBlock", c: [a, "Code"]},
      {t: "BulletList", c: [[p("Item")]]}, {t: "BlockQuote", c: [p("Quote")]}]];
    const rtf = await output([table([row(rich, cell("Data"))], 1, [row(cell("TopA"), cell("TopB"))],
      [row(cell("SectionA"), cell("SectionB"))], [row(cell("FootA"), cell("FootB"))]), p("After")], retained);
    const result = await boldText(rtf);
    for (const text of ["TopA", "TopB", "SectionA", "SectionB", "First", "Second", "Code", "Item", "Quote"]) expect(result.get(text), text).toBe(true);
    for (const text of ["Data", "FootA", "FootB", "After"]) expect(result.get(text), text).toBe(false);
    expect(rtf).toContain("\\intbl\\qc"); expect(rtf).toContain("\\intbl\\qr Data");
  });
  it(`${route}: recognizes only explicit header hints, including padded scope values`, async () => {
    const hints: Attr[] = [
      ["", [], [["role", "rowheader"]]], ["", [], [["role", " columnheader "]]],
      ...["row", "col", "rowgroup", "colgroup"].map(value => ["", [], [["scope", " ".repeat(20000) + value.toUpperCase() + "\t"]]] as Attr)
    ];
    const rows = hints.map((attr, index) => row(cell("Data" + index), cell("Head" + index, attr)));
    const result = await boldText(await output([table(rows)], retained));
    for (let i = 0; i < hints.length; i++) {expect(result.get("Head" + i)).toBe(true); expect(result.get("Data" + i)).toBe(false);}
  });
  it(`${route}: keeps unrelated attributes, spans and nested tables unsupported`, async () => {
    const attrs: Attr[] = [["id", [], []], ["", ["class"], []], ["", [], [["title", "label"]]],
      ["", [], [["role", "cell"]]], ["", [], [["role", "ROWHEADER"]]], ["", [], [["scope", "row group"]]],
      ["", [], [["scope", "row"], ["custom", "value"]]]];
    for (const attr of attrs) await expect(output([table([row(cell("Header", attr), cell("Data"))])], retained)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
    await expect(output([table([row([a, "AlignDefault", 1, 2, [p("Merged")]])])], retained)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
    await expect(output([table([row([a, "AlignDefault", 1, 1, [table([row(cell("Nested"), cell("Data"))])]], cell("Outer"))])], retained)).rejects.toMatchObject({code: "E_UNSUPPORTED_FEATURE"});
  });
}
it("emits identical collected and retained RTF for mixed HTML header sections", async () => {
  const html = "<table><thead><tr><th>Top</th><th>Second</th></tr></thead><tbody><tr><th>Row</th><td>Data</td></tr></tbody><tbody><tr><th>Section</th><th>Title</th></tr><tr><td>Plain</td><th scope='row'>Last</th></tr></tbody><tfoot><tr><td>Foot</td><td>End</td></tr></tfoot></table>";
  expect(await output(html, true)).toBe(await output(html, false));
});
