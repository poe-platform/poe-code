import { expect, it } from "vitest";
import type { CapabilityContext } from "@poe-code/spreadsheet-engine/contracts";
import { createXlsxXml, metadataNode } from "@poe-code/spreadsheet-engine/codecs/xlsx-write-support";
import { createXlsxStyles } from "./xlsx-write-styles.js";
import { gnode } from "./xlsx-metadata.js";
const context: CapabilityContext = { signal: new AbortController().signal, own() {}, environment: { env: {}, locale: "C", timezone: "UTC" },
  limits: { inputBytes: 1000000, outputBytes: 1000000, cells: 100, sheets: 4, operations: 10000 } };
for (const [attributes, expected] of [
  [{ Shade: 1, Back: "FFFF:FFFF:0", PatternColor: "FFFF:0:0" }, '<patternFill patternType="solid"><fgColor rgb="FFFF0000"/><bgColor rgb="FFFFFF00"/></patternFill>'],
  [{ Shade: 24, Back: "FFFF:FFFF:0", PatternColor: "FFFF:0:0" }, '<patternFill patternType="solid"><fgColor rgb="FFFFFF00"/><bgColor rgb="FFFF0000"/></patternFill>'],
  [{ PatternColor: "FFFF:0:0" }, '<patternFill><bgColor rgb="FFFF0000"/></patternFill>'],
  [{ Back: "FFFF:FFFF:0" }, '<patternFill><fgColor rgb="FFFFFF00"/></patternFill>'],
  [{ Shade: 1 }, '<patternFill patternType="solid"/>'],
  [{ Shade: 0, PatternColor: "FFFF:0:0" }, '<patternFill patternType="none"><bgColor rgb="FFFF0000"/></patternFill>']
] as const) it(`preserves sparse differential fill ${JSON.stringify(attributes)}`, () => {
  const xml = createXlsxXml(context), styles = createXlsxStyles(xml.element, "2008", "http://schemas.openxmlformats.org/spreadsheetml/2006/main", xml.charge);
  styles.differential(metadataNode(gnode("Style", attributes))!);
  expect(styles.serialize()).toContain(`<dxf><fill>${expected}</fill></dxf>`);
});
