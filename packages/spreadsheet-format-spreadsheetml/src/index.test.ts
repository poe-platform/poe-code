import { expect, it } from "vitest";
import { createEngine } from "@poe-code/spreadsheet-engine";
import { spreadsheetmlFormat } from "./index.js";

it("reads Excel 2003 XML with only the selected read-only format", async () => {
  const engine = createEngine({ formats: [spreadsheetmlFormat] });
  const source = new TextEncoder().encode(`<?xml version="1.0"?>
    <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
      xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
      <Worksheet ss:Name="Sales"><Table><Row>
        <Cell><Data ss:Type="String">Coffee &amp; tea</Data></Cell>
        <Cell><Data ss:Type="Number">42.5</Data></Cell>
        <Cell><Data ss:Type="Boolean">1</Data></Cell>
      </Row></Table></Worksheet>
    </Workbook>`);
  try {
    expect(engine.listServices("read").map(service => service.id)).toEqual(["Gnumeric_Excel:excel_xml"]);
    expect(engine.listServices("write")).toEqual([]);
    const workbook = await engine.readWorkbook({ kind: "stream", filename: "sales.xml", source: [source] }, {},
      { signal: new AbortController().signal });
    expect(workbook.sheets).toHaveLength(1);
    expect(workbook.sheets[0]!.name).toBe("Sales");
    expect(workbook.sheets[0]!.cells.map(cell => cell.value)).toEqual([
      { kind: "string", value: "Coffee & tea" },
      { kind: "number", value: 42.5 },
      // Preserve the reader's captured Gnumeric numeric Boolean representation.
      { kind: "number", value: 1 }
    ]);
  } finally { await engine.dispose(); }
});
