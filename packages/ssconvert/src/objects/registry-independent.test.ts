import { expect, it } from "vitest";
import { chartDataTypes } from "./data.js";
import { chartPlugins, objectKinds, sheetObjectTypes } from "./registry.js";
import { hasGraphObjects } from "../rendering.js";
import type { CapabilityContext } from "../contracts.js";
import type { ImportedValue, Workbook } from "../workbook.js";

const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" }, limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
const node = (name: string, namespace: string, children: ImportedValue[] = []): ImportedValue => ({ name, namespace, attributes: [], text: "", children });
const namespace = "http://www.gnumeric.org/v10.dtd";
const book = (children: ImportedValue[]): Workbook => ({ sheets: [{ id: "s", name: "S", cells: [], unsupportedRecords: [{ source: "Gnumeric_XmlIO:sax", kind: "Objects", disposition: "retained", data: node("Objects", namespace, children) }] }] });

it("keeps runtime chart data grammar descriptors immutable", () => {
  for (const descriptor of Object.values(chartDataTypes)) {
    expect(Object.isFrozen(descriptor)).toBe(true);
    expect(Reflect.set(descriptor, "storage", "unknown")).toBe(false);
  }
});

it("keeps source classification and plugin census containers immutable", () => {
  expect(Object.isFrozen(objectKinds)).toBe(true);
  for (const type of Object.values(sheetObjectTypes)) {
    expect(Object.isFrozen(type)).toBe(true);
    expect(Object.isFrozen(type.aliases)).toBe(true);
    expect(Reflect.set(type.aliases, "0", "InjectedGraph")).toBe(false);
  }
  for (const types of Object.values(chartPlugins)) expect(Object.isFrozen(types)).toBe(true);
});

it.each(["SheetObjectImage", "SheetObjectComponent", "GnmCellComment", "GnmSOFilled", "SheetWidgetButton", "constructor", "toString"])("does not admit non-graph %s for graph export", type => {
  expect(hasGraphObjects(book([node(type, namespace, [node("SheetObjectGraph", namespace)])]), context)).toBe(false);
});

it("admits both direct graph spellings while rejecting namespace and nesting lookalikes", () => {
  for (const type of ["SheetObjectGraph", "GnmGraph"]) {
    expect(hasGraphObjects(book([node(type, namespace)]), context)).toBe(true);
    expect(hasGraphObjects(book([node(type, "urn:foreign")]), context)).toBe(false);
    expect(hasGraphObjects(book([node("metadata", namespace, [node(type, namespace)])]), context)).toBe(false);
  }
});

it("checks cancellation before returning graph evidence and limits scans", () => {
  const controller = new AbortController(), reason = { abort: true }; controller.abort(reason);
  try { hasGraphObjects(book([node("SheetObjectGraph", namespace)]), { ...context, signal: controller.signal }); throw new Error("missed abort"); }
  catch (error) { expect(error).toBe(reason); }
  expect(() => hasGraphObjects(book([node("SheetObjectImage", namespace), node("SheetObjectGraph", namespace)]), { ...context, limits: { ...context.limits, workbookWork: 3 } })).toThrow("work limit");
});
