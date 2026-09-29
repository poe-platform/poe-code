import { expect, it } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { htmlFormat } from "./index.js";

it("reads and writes a table with only the HTML formats selected", async () => {
  const engine = createEngine({ formats: [htmlFormat] });
  const operation = { signal: new AbortController().signal };
  try {
    expect(engine.listServices("read").map(service => service.id)).toEqual(["Gnumeric_html:html"]);
    expect(engine.listServices("write").map(service => service.id).sort()).toEqual([
      "Gnumeric_html:html32", "Gnumeric_html:html40", "Gnumeric_html:html40frag",
      "Gnumeric_html:xhtml", "Gnumeric_html:xhtml_range"
    ]);
    const workbook = await engine.readWorkbook({ kind: "stream", filename: "sales.html", source: [
      new TextEncoder().encode('<table><caption>Sales</caption><tr><td>Tea &amp; coffee</td><td>42.5</td></tr></table>')
    ] }, {}, operation);
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]!.name).toBe("Sales");
    expect(workbook.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "string", value: "Tea & coffee" }, { kind: "number", value: 42.5 }
    ]);
    const chunks: Uint8Array[] = [];
    await engine.writeWorkbook(workbook, { kind: "stream", sink: { async write(bytes) { chunks.push(bytes.slice()); } } },
      { exportType: "Gnumeric_html:html40frag" }, operation);
    expect(chunks.map(bytes => new TextDecoder().decode(bytes)).join("")).toContain("Tea &amp; coffee");
    const roundtrip = await engine.readWorkbook({ kind: "stream", filename: "roundtrip.html", source: chunks }, {}, operation);
    expect(roundtrip.sheets[0]!.cells.map(cell => cell.value)).toEqual(workbook.sheets[0]!.cells.map(cell => cell.value));
  } finally { await engine.dispose(); }
});
