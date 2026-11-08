import { expect, it } from "vitest";
import { parseXmlSteps, type XmlElement } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import { writeClipboardGnumeric, writeGnumeric } from "./gnumeric.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
function descendants(node: XmlElement): XmlElement[] { return [node, ...node.children.flatMap(descendants)]; }
for (const route of ["workbook", "clipboard"] as const) for (const explicit of [true, false]) {
  it.each([[409.55, 409.6], [1638.3500000000001, 1638], [12.3456, 12.35], [0.0123456, 0.01235]])(`${route} (${explicit ? "explicit" : "inherited"}) uses native point precision for %s`, async (size, expected) => {
    const sheet = { id: "s", name: "S", cells: [], view: { defaultRowHeight: size, defaultColumnWidth: size },
      rows: [{ index: 1, ...(explicit ? { sizePoints: size } : {}), hidden: true }], columns: [{ index: 1, ...(explicit ? { sizePoints: size } : {}), hidden: true }] };
    const book = { sheets: [sheet] };
    const bytes = route === "workbook" ? await writeGnumeric(book, [], context) :
      writeClipboardGnumeric(book, sheet, { sheet: "s", startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 }, context);
    const parser = parseXmlSteps(new TextDecoder().decode(bytes)); let step = parser.next(); while (!step.done) step = parser.next();
    const axes = descendants(step.value).filter(node => ["Rows", "Cols", "RowInfo", "ColInfo"].includes(node.localName));
    expect(axes).toHaveLength(4);
    for (const axis of axes) {
      const attribute = axis.attributes.find(a => a.localName === (axis.localName.endsWith("Info") ? "Unit" : "DefaultSizePts"));
      expect(Number(attribute?.value)).toBe(expected);
    }
  });
}
