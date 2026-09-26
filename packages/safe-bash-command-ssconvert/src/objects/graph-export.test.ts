import { expect, it } from "vitest";
import { hasGraphObjects } from "../rendering.js";
import type { CapabilityContext } from "../contracts.js";
import type { Workbook, ImportedValue } from "../workbook.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 10000, outputBytes: 10000, cells: 10, sheets: 1, operations: 100 } };
const namespace = "http://www.gnumeric.org/v10.dtd";
function book(children: readonly ImportedValue[]): Workbook {
  return { sheets: [{ id: "S", name: "S", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: { name: "Objects", namespace, text: "", attributes: [], children } }] }], properties: {} };
}
it("does not request graph rendering for a foreign graph lookalike, images, or nested graphs", () => {
  expect(hasGraphObjects(book([
    { name: "SheetObjectGraph", namespace: "urn:foreign" },
    { name: "SheetObjectImage", namespace, children: [{ name: "GogObject", namespace: "", attributes: [{ name: "type", namespace: "", value: "GogGraph" }] }] },
    { name: "SheetObjectFilled", namespace, children: [{ name: "SheetObjectGraph", namespace }] }
  ]), context)).toBe(false);
});
it.each(["SheetObjectGraph", "GnmGraph"])("requests rendering for admitted graph class %s only", name => {
  expect(hasGraphObjects(book([{ name, namespace }]), context)).toBe(true);
});
