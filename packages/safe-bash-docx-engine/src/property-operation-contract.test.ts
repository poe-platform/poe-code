import { expect, expectTypeOf, it } from "vitest";
import { parseDocxArguments, validateDocxInvocation } from "./command.js";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import type { DocxOperationArgumentMap } from "./operation-types.js";

const operations = ["properties.list", "properties.get", "properties.set", "properties.remove"] as const;
function schema(operation: typeof operations[number]) {
  return (getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData).operations[0]!;
}
it("advertises only the admitted F30 typed utility property operations", () => {
  for (const operation of operations) expect(schema(operation)).toMatchObject({ featureIds: ["F30"], support: ["properties.list", "properties.get"].includes(operation) ? "read" : "edit", result: { oneOf: [{ properties: { ok: { const: true } } }, {}] } });
});
it("declares closed property records without guessed opaque types or content dumps", () => {
  for (const operation of ["properties.list", "properties.get"] as const) {
    const data = schema(operation).result.oneOf?.[0]?.properties?.data;
    const item = operation === "properties.list" ? data?.properties?.items?.items : data?.properties?.item;
    if (!item || typeof item !== "object") throw new Error("Expected a property record schema.");
    expect(item.required).toEqual(["kind", "location", "properties", "references", "support", "details"]);
    expect(item.additionalProperties).toBe(false);
    expect(Object.keys(item.properties ?? {})).toEqual(["kind", "location", "name", "properties", "references", "support", "details"]);
    expect(item.properties).toMatchObject({ kind: { const: "property" }, location: { properties: { kind: { const: "part" } } }, properties: { type: "array", maxItems: 1, items: { required: ["name", "type", "value", "writable", "cached"], additionalProperties: false } }, support: { enum: ["edit", "read", "preserve"] }, details: { required: ["kind", "group", "storedType", "id"], additionalProperties: false, properties: { kind: { const: "property" }, group: { enum: ["core", "extended", "custom"] }, id: { oneOf: [{ type: "string" }, { type: "null" }] }, storedType: { oneOf: [{ required: ["namespace", "localName"], additionalProperties: false }, { type: "null" }] } } } });
  }
});
it("reports F30 bounded typing and exact preservation without live model claims", () => {
  const data = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data;
  expect(data).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F30", level: "edit", detected: null, subsets: expect.arrayContaining([expect.objectContaining({ name: "typed-document-properties", level: "edit" })]) })]) });
});
it("declares inert property help with explicit qualification and UTC utility dates", () => {
  const help = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "properties.set" } })!.human;
  for (const text of ["core:", "extended:", "custom:", "UTC", "cached", "type"]) expect(help).toContain(text);
});
it("keeps global argument keys and publication behavior identical for CLI and SDK", () => {
  for (const operation of operations) for (const transport of ["cli", "sdk"] as const) {
    const keys = Object.keys(getDocxOperationSchema(operation, transport).properties ?? {});
    expect(keys).toEqual(operation === "properties.list" ? ["json", "limit"] : operation === "properties.get" ? ["json", "limit", "name"] : operation === "properties.set" ? ["json", "limit", "output", "inPlace", "force", "dryRun", "allowEmpty", "name", "value", "type"] : ["json", "limit", "output", "inPlace", "force", "dryRun", "allowEmpty", "name"]);
    expect(getDocxOperationSchema(operation, transport).additionalProperties).toBe(false);
  }
});
it("rejects every story selector and arbitrary all-selection on named properties", () => {
  for (const operation of operations) {
    const words = operation.split("."), args = operation === "properties.list" ? [] : operation === "properties.set" ? ["--name", "title", "--value", "Sample"] : ["--name", "title"];
    for (const flag of [["--paragraph", "1"], ["--scope", "body"], ["--select", "token"], ["--all"]]) expect(() => parseDocxArguments([...words, "input", ...args, ...flag].map(word => new TextEncoder().encode(word)))).toThrow();
  }
});
it("keeps utility SDK scalar inputs strict without adopting live Date objects", () => {
  expectTypeOf<DocxOperationArgumentMap["properties.set"]["value"]>().toEqualTypeOf<string | boolean | number>();
  for (const value of [false, 0, ""]) expect(() => validateDocxInvocation({ operation: "properties.set", inputs: ["input"], options: { output: "-", name: "custom:Answer", type: typeof value === "boolean" ? "boolean" : typeof value === "number" ? "integer" : "string", value } })).not.toThrow();
  for (const value of [null, new Date("2024-01-01T00:00:00Z"), NaN, Infinity, {}, []]) expect(() => validateDocxInvocation({ operation: "properties.set", inputs: ["input"], options: { output: "-", name: "custom:Answer", value } })).toThrow();
});
