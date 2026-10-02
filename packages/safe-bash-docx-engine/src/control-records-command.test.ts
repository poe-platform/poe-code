import { expect, it } from "vitest";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { encodeLocation } from "./location-token.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";

const args = (...values: string[]) => parseDocxArguments(values.map(value => new TextEncoder().encode(value)));
it("declares native repeat owners as non-scalar snapshot kinds", () => {
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "controls.list" } })!.data as DocxSchemaData;
  const items = schema.operations[0]!.result.oneOf![0]!.properties!.data!.properties!.items!.items;
  expect(items).toMatchObject({ properties: { kind: { enum: expect.arrayContaining(["repeating-section", "repeating-item"]) } } });
});
it("admits explicit all for record expansion and binding synchronization", () => {
  expect(() => args("controls", "repeat", "input", "--all", "--data-json", "[]", "--dry-run")).not.toThrow();
  for (const value of ["false", "0", '""']) expect(args("controls", "bind", "input", "--all", "--binding", "bay", "--value-json", value, "--dry-run").options.valueJson).toEqual(JSON.parse(value));
});
it("declares the actual required repeat array profile on deferred file input", () => {
  expect(args("controls", "repeat", "input", "--control", "1", "--data-file", "records.json", "--dry-run").sources).toEqual([{ argument: "data", path: "records.json", format: "json", type: "ReadonlyArray<DeclaredControlRecord>" }]);
});
it("requires exactly one CLI array source while SDK data is required", () => {
  expect(() => args("controls", "repeat", "input", "--control", "1", "--dry-run")).toThrow();
  expect(() => args("controls", "repeat", "input", "--control", "1", "--data-file", "a", "--data-json", "[]", "--dry-run")).toThrow();
  expect(() => validateDocxInvocation({ operation: "controls.repeat", inputs: ["input"], options: { control: 1, data: [], dryRun: true } })).not.toThrow();
  for (const data of [{ values: [] }, [{ values: [{ binding: "bay", value: null }] }], [{ values: [{ binding: "bay", value: "a" }, { binding: "bay", value: "b" }] }]]) expect(() => validateDocxInvocation({ operation: "controls.repeat", inputs: ["input"], options: { control: 1, data, dryRun: true } })).toThrow();
  expect(getDocxOperationSchema("controls.repeat", "cli").allOf).toContainEqual({ oneOf: [{ required: ["dataFile"] }, { required: ["dataJson"] }] });
});
it("rejects text ranges for all control operation routes", () => {
  const select = encodeLocation({ version: 1, sourceSha256: "d".repeat(64), generation: 0, part: "/word/document.xml", story: "body", path: [0, 0], range: { start: 0, end: 1 } });
  for (const [operation, options] of [["controls.repeat", { data: [] }], ["controls.bind", { binding: "bay", valueJson: "new" }]] as const) expect(() => validateDocxInvocation({ operation, inputs: ["input"], options: { ...options, select, dryRun: true } })).toThrow();
});
