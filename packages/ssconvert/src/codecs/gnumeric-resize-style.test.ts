import { expect, it } from "vitest";
import { readGnumeric, writeGnumeric } from "./gnumeric.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook } from "../workbook.js";

const context = (): CapabilityContext => ({ limits: { sheets: 8, cells: 100, inputBytes: 100000, outputBytes: 100000, operations: 100 },
  signal: new AbortController().signal, environment: { env: {}, locale: "C", timezone: "UTC" }, own() {} });

it("emits inherited native style wrappers with generic resize patches on replay", async () => {
  const ns = "http://www.gnumeric.org/v10.dtd";
  const input: Workbook = { sheets: [{ id: "s", name: "Small", cells: [{ row: 129, column: 0, value: { kind: "number", value: 1 } }],
    size: { rows: 256, columns: 128 }, unsupportedRecords: [{ source: "ssconvert-resize", kind: "StyleRange", disposition: "retained",
      data: { startRow: 128, endRow: 255, startColumn: 0, endColumn: 127, format: "0%", style: { bold: true, gnumeric:
        { name: "Style", namespace: ns, text: "", attributes: [{ name: "Format", namespace: "", value: "0.00" }, { name: "Back", namespace: "", value: "FFFF:0:0" }],
          children: [{ name: "Font", namespace: ns, text: "Serif", attributes: [{ name: "Unit", namespace: "", value: "12" }, { name: "Italic", namespace: "", value: "1" }], children: [] }] } } } }] }] };
  const output = await writeGnumeric(input, [], context());
  const text = new TextDecoder().decode(output);
  expect(text).toContain('Back="FFFF:0:0"'); expect(text).toContain('Format="0%"');
  expect(text).toContain('Italic="1"'); expect(text).toContain('Bold="1"'); expect(text).toContain(">Serif</gnm:Font>");
  const replay = await readGnumeric(output, context());
  expect(replay.sheets[0]!.cells[0]!.format).toBe("0%");
});
