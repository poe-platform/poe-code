import { expect, it } from "vitest";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
const parse = (...args: string[]) => parseDocxArguments(["images", "set", "input.docx", "--image", "1", "--dry-run", ...args].map(value => new TextEncoder().encode(value)));

it("admits only the exact finite native polygon shape without imposing outline geometry", () => {
  const polygon = { start: { x: 0, y: 0 }, lineTo: [{ x: 0, y: 0 }, { x: 0, y: 0 }] };
  expect(parse("--wrap", "tight", "--wrap-text", "bothSides", "--wrap-polygon-json", JSON.stringify(polygon)).options.wrapPolygon).toEqual(polygon);
  for (const invalid of [{ ...polygon, edited: true }, { ...polygon, lineTo: [polygon.start] }, { ...polygon, start: { x: 27273042316901, y: 0 } }, { ...polygon, start: { x: 0.5, y: 0 } }, { ...polygon, start: { x: 0, y: 0, z: 1 } }]) expect(() => validateDocxInvocation({ operation: "images.set", inputs: ["input.docx"], options: { image: 1, dryRun: true, wrap: "tight", wrapText: "bothSides", wrapPolygon: invalid } })).toThrow();
});
it("qualifies only direct native metadata edits and exposes set receipts", () => {
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "images.set" } })!.data as DocxSchemaData;
  expect(schema.operations[0]).toMatchObject({ support: "edit", featureIds: ["F33"] });
  const item = schema.operations[0]!.result.oneOf?.[0]?.properties?.data?.properties?.changes?.items;
  expect(item && item.properties?.kind).toEqual({ const: "set" });
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.set" } })!.human;
  for (const word of ["stored", "anchor", "polygon", "batch", "unsupported"]) expect(help).toContain(word);
});
it("describes stored wrapping, effective distances and coherent aspect locks in image reads", () => {
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "images.get" } })!.data as DocxSchemaData;
  const fields = schema.operations[0]!.result.oneOf?.[0]?.properties?.data?.properties?.item?.properties?.details?.properties;
  for (const key of ["wrapText", "wrapPolygon", "distances", "allowOverlap", "behindText", "lockAspect"]) expect(fields?.[key], key).toBeDefined();
});
