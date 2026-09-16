import { expect, expectTypeOf, it } from "vitest";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { docxOperationSchemas } from "./operation-schema.js";
import type { DocxOperationArgumentMap, DocxBatchArgumentMap } from "./operation-types.js";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import type { PackageResourceRecord } from "./index.js";

const operations = ["custom-xml.list", "glossary.list"] as const;
it("identifies the shared package inspection census as an F41 inventory", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "inspect" } })!.data as DocxSchemaData;
  expect(data.operations[0]!.featureIds).toContain("F41");
});
it("declares successful inventory result schemas with exact inert resource details", () => {
  for (const operation of operations) {
    const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData;
    expect(data.operations).toMatchObject([{ support: "read", featureIds: ["F41"], result: { oneOf: [{ properties: { affected: { const: 0 }, data: { properties: { items: { items: { required: ["kind", "location", "name", "properties", "references", "support", "details"], additionalProperties: false, properties: { kind: { const: operation.split(".")[0] }, location: { properties: { kind: { const: "part" } } }, support: { const: "preserve" }, details: { additionalProperties: false, properties: operation === "custom-xml.list" ? { kind: { const: "custom-xml" }, root: {}, storeItemId: {}, propertiesParts: { type: "array", items: { type: "string" } }, namespaces: { type: "array", items: { required: ["prefix", "uri"], additionalProperties: false } }, schemaReferences: { type: "array", items: { type: "string" } }, parts: { type: "array" } } : { kind: { const: "glossary" }, buildingBlocks: { type: "array", items: { required: ["path", "name", "guid", "category", "gallery", "types", "behaviors"], additionalProperties: false } }, parts: { type: "array" } } } } } } } } } }, {}] } }]);
    const item = data.operations[0]!.result.oneOf?.[0]?.properties?.data?.properties?.items?.items;
    expect(item).toBeTypeOf("object");
    if (!item || typeof item !== "object") throw new Error("Expected a resource schema.");
    expect(Object.keys(item.properties ?? {})).toEqual(["kind", "location", "name", "properties", "references", "support", "details"]);
  }
});
it("advertises F41 inventory and preservation without semantic editing or schema activation", () => {
  const data = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data;
  expect(data).toMatchObject({ features: expect.arrayContaining([{ id: "F41", level: "preserve", detected: null, subsets: expect.arrayContaining([expect.objectContaining({ name: "package-resource-inventories", level: "read" }), expect.objectContaining({ name: "opaque-package-retention", level: "preserve" })]) }]) });
});
it("admits preservation levels in the declared capabilities result", () => {
  const data = getDocxDiscovery({ operation: "schema", inputs: [], options: { operation: "capabilities" } })!.data as DocxSchemaData;
  const feature = data.operations[0]!.result.oneOf?.[0]?.properties?.data?.properties?.features?.items;
  if (!feature || typeof feature !== "object") throw new Error("Expected a capability feature schema.");
  expect(feature.properties?.level?.enum).toContain("preserve");
  const subset = feature.properties?.subsets?.items;
  if (!subset || typeof subset !== "object") throw new Error("Expected a capability subset schema.");
  expect(subset.properties?.level?.enum).toContain("preserve");
});
it("declares package-global read profiles with only JSON and invocation limits", () => {
  for (const operation of operations) {
    expect(docxOperationSchemas[operation]).toMatchObject({ profile: "read", commonOptions: ["json", "limit"], fields: {}, sdkFields: {}, batchFields: {}, inputArity: 1, mutates: false, valueType: "ResourceListData" });
  }
});
it("publishes exact global CLI, SDK and batch argument schemas", () => {
  for (const operation of operations) for (const transport of ["cli", "sdk", "batch"] as const) {
    const schema = getDocxOperationSchema(operation, transport);
    expect(Object.keys(schema.properties ?? {})).toEqual(transport === "batch" ? [] : ["json", "limit"]);
    expect(schema.additionalProperties).toBe(false);
  }
});
it("rejects all story and publication flags without concealing package owners", () => {
  for (const operation of operations) {
    const words = operation.split(".");
    for (const extra of [["--paragraph", "1"], ["--scope", "body"], ["--select", "token"], ["--output", "-"], ["--all"]]) expect(() => parseDocxArguments([...words, "input", ...extra].map(word => new TextEncoder().encode(word)))).toThrow();
    expect(() => parseDocxArguments([...words, "input", "--json", "--limit", "zipEntries=20"].map(word => new TextEncoder().encode(word)))).not.toThrow();
    expect(() => validateDocxInvocation({ operation, inputs: ["input"], options: { paragraph: 1 } })).toThrow();
  }
});
it("keeps global SDK and batch argument interfaces aligned", () => {
  expectTypeOf<keyof DocxOperationArgumentMap["custom-xml.list"]>().toEqualTypeOf<"json" | "limit">();
  expectTypeOf<keyof DocxOperationArgumentMap["glossary.list"]>().toEqualTypeOf<"json" | "limit">();
  expectTypeOf<DocxBatchArgumentMap["custom-xml.list"]>().toEqualTypeOf<Readonly<Record<string, never>>>();
  expectTypeOf<DocxBatchArgumentMap["glossary.list"]>().toEqualTypeOf<Readonly<Record<string, never>>>();
  expectTypeOf<DocxBatchArgumentMap["custom-xml.list"]["scope"]>().toEqualTypeOf<never>();
  expectTypeOf<DocxBatchArgumentMap["glossary.list"]["select"]>().toEqualTypeOf<never>();
});
it("publishes inventory records without a content-dump field", () => {
  expectTypeOf<keyof PackageResourceRecord>().toEqualTypeOf<"kind" | "location" | "name" | "properties" | "references" | "support" | "details">();
});
