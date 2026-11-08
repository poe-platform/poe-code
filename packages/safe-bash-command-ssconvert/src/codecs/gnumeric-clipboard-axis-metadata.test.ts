import { expect, it } from "vitest";
import { parseXmlSteps } from "@poe-code/safe-fs/xml";
import type { CapabilityContext } from "../contracts.js";
import { writeClipboardGnumeric } from "./gnumeric.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {},
  environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 100000, outputBytes: 100000, cells: 100, sheets: 4, operations: 1000 } };
it.each([0, 1, 7])("preserves clipboard collapsed flags and outline depth %s", outlineLevel => {
  const axes = [{ index: 1, sizePoints: 30, collapsed: true, outlineLevel }, { index: 2, sizePoints: 20 }];
  const sheet = { id: "s", name: "S", cells: [], rows: axes, columns: axes };
  const bytes = writeClipboardGnumeric({ sheets: [sheet] }, sheet,
    { sheet: "s", startRow: 0, startColumn: 0, endRow: 2, endColumn: 2 }, context);
  const parser = parseXmlSteps(new TextDecoder().decode(bytes)); let step = parser.next(); while (!step.done) step = parser.next();
  const groups = step.value.children.filter(node => ["Rows", "Cols"].includes(node.localName));
  expect(groups).toHaveLength(2);
  for (const group of groups) {
    const attributes = group.children.map(node => Object.fromEntries(node.attributes.map(attr => [attr.localName, attr.value])));
    expect(attributes).toEqual([{ No: "1", Unit: "30", Collapsed: "1", ...(outlineLevel ? { OutlineLevel: String(outlineLevel) } : {}) }, { No: "2", Unit: "20" }]);
  }
});
