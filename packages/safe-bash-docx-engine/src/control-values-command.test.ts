import { expect, expectTypeOf, it } from "vitest";
import { validateDocxInvocation } from "./command.js";
import { encodeLocation } from "./location-token.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { getDocxDiscovery, type DocxSchemaData, type DocxCapabilitiesData } from "./discovery.js";
import type { DocxOperationArgumentMap, DocxBatchArgumentMap } from "./operation-types.js";

const fill = (options: Record<string, unknown>) => validateDocxInvocation({ operation: "controls.set", inputs: ["input"], options: { control: 1, dryRun: true, ...options } });
it("admits exactly one explicit typed control value", () => {
  for (const value of [{ text: "" }, { checked: false }, { choice: "stored" }, { date: "2024-02-29" }, { file: { kind: "bytes", base64: "AA==" } }]) expect(() => fill(value)).not.toThrow();
  for (const value of [{}, { text: "", checked: false }, { checked: null }, { date: "2025-02-29" }, { choice: 1 }, { text: "new", author: "A" }]) expect(() => fill(value)).toThrow();
});
it("requires an explicit whole control or scoped all selection", () => {
  expect(() => fill({ control: undefined, text: "new" })).toThrow();
  expect(() => fill({ all: true, text: "new" })).toThrow();
  expect(() => fill({ control: undefined, all: true, scope: "body", text: "new" })).not.toThrow();
  const select = encodeLocation({ version: 1, sourceSha256: "c".repeat(64), generation: 0, part: "/word/document.xml", story: "body", path: [0, 0], range: { start: 0, end: 1 } });
  expect(() => fill({ control: undefined, select, text: "new" })).toThrow();
});
it("requires exactly one value in public types", () => {
  // @ts-expect-error Control filling cannot omit its typed value.
  const absent: DocxOperationArgumentMap["controls.set"] = { control: 1 };
  // @ts-expect-error A control cannot receive two competing value kinds.
  const mixed: DocxBatchArgumentMap["controls.set"] = { control: 1, text: "new", checked: false };
  expectTypeOf(absent).toMatchTypeOf<DocxOperationArgumentMap["controls.set"]>();
  expectTypeOf(mixed).toMatchTypeOf<DocxBatchArgumentMap["controls.set"]>();
});
it("encodes exact typed value alternatives in all input schemas", () => {
  for (const transport of ["cli", "sdk", "batch"] as const) expect(getDocxOperationSchema("controls.set", transport).allOf).toContainEqual({ oneOf: ["text", "checked", "choice", "date", "file"].map(name => ({ required: [name] })) });
});
it("advertises bounded inspection, scalar filling and the separate binding synchronization profile", () => {
  for (const operation of ["controls.list", "controls.set"]) {
    const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData;
    expect(schema.operations).toMatchObject([{ id: operation, support: operation.endsWith("set") ? "edit" : "read", featureIds: operation === "controls.list" ? ["F28", "F29"] : ["F28"] }]);
  }
  const binding = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "controls.bind" } })!.data as DocxSchemaData;
  expect(binding.operations).toMatchObject([{ support: "edit", featureIds: ["F29"] }]);
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data as DocxCapabilitiesData;
  expect(capabilities.features.find(item => item.id === "F28")).toMatchObject({ level: "edit", subsets: expect.arrayContaining([expect.objectContaining({ name: "control-values", level: "edit" })]) });
});


it("declares the bounded typed control snapshot utility profile", () => {
  expect(docxOperationSchemas["controls.list"]!.valueType).toBe("ControlReadData");
});


it("describes exact snapshot fields in successful control inspection results", () => {
  const schema = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "controls.list" } })!.data as DocxSchemaData;
  const item = schema.operations[0]!.result.oneOf?.[0]?.properties?.data?.properties?.items?.items;
  expect(item).toMatchObject({ type: "object", additionalProperties: false,
    required: ["location", "kind", "id", "tag", "alias", "lock", "placeholder", "binding", "value", "choices", "support", "reason"],
    properties: {
      kind: { enum: ["plain-text", "rich-text", "checkbox", "dropdown", "combo-box", "date", "picture", "repeating-section", "repeating-item", "unsupported"] },
      support: { enum: ["supported", "unsupported"] },
      binding: { anyOf: [{ properties: { storeItemId: { oneOf: [{ type: "string" }, { type: "null" }] }, xpath: { oneOf: [{ type: "string" }, { type: "null" }] }, prefixMappings: { oneOf: [{ type: "string" }, { type: "null" }] } } }, { type: "null" }] },
    },
  });
});
