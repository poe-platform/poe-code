import { expect, it } from "vitest";
import { getDocxDiscovery, type DocxSchemaData } from "./discovery.js";
import { getDocxOperationSchema } from "./operation-json-schema.js";
import { validateDocxInvocation } from "./command.js";

function schema(operation: string) {
  return (getDocxDiscovery({ operation: "schema", inputs: [], options: { operation } })!.data as DocxSchemaData).operations[0]!;
}
it("advertises only bounded image utility reads after product qualification", () => {
  for (const [operation, featureIds] of [["images.list", ["F31", "F34", "F35"]], ["images.get", ["F31", "F33"]], ["images.extract", ["F31", "F34"]]] as const) expect(schema(operation)).toMatchObject({ support: "read", featureIds });
  const capabilities = getDocxDiscovery({ operation: "capabilities", inputs: [], options: {} })!.data;
  expect(capabilities).toMatchObject({ features: expect.arrayContaining([expect.objectContaining({ id: "F31", level: "read", detected: null, subsets: expect.arrayContaining([expect.objectContaining({ name: "image-inventory-extraction", level: "read" })]) })]) });
  expect(getDocxDiscovery({ operation: "schema", inputs: [], options: {} })!.data).toMatchObject({ operations: expect.arrayContaining([expect.objectContaining({ id: "images.list", support: "read" }), expect.objectContaining({ id: "images.get", support: "read" }), expect.objectContaining({ id: "images.extract", support: "read" })]) });
  expect(schema("images.add")).toMatchObject({ support: "edit", featureIds: expect.arrayContaining(["F32"]) });
  expect(schema("images.set").support).toBe("reject");
});
it("declares closed image occurrence records with nullable stored metadata", () => {
  for (const operation of ["images.list", "images.get"]) {
    const data = schema(operation).result.oneOf?.[0]?.properties?.data;
    const item = operation === "images.list" ? data?.properties?.items?.items : data?.properties?.item;
    if (!item || typeof item !== "object") throw new Error("Expected an image record schema.");
    expect(item.additionalProperties).toBe(false);
    expect(item.required).toEqual(["kind", "location", "properties", "references", "support", "details"]);
    expect(item.properties?.kind).toEqual({ const: "images" });
    const details = item.properties?.details;
    expect(details?.additionalProperties).toBe(false);
    expect(details?.required).toEqual(["kind", "part", "mime", "declaredMime", "bytes", "sha256", "pixelWidth", "pixelHeight", "widthEmu", "heightEmu", "placement", "crop", "rotation", "flipHorizontal", "flipVertical", "wrap", "zOrder", "horizontalPosition", "verticalPosition", "alt", "decorative", "owners", "fallbackPart", "alternateParts", "linked"]);
    for (const name of ["part", "mime", "bytes", "widthEmu", "crop", "rotation", "placement", "flipHorizontal", "wrap", "horizontalPosition", "alt", "decorative"]) expect(details?.properties?.[name]?.oneOf).toEqual(expect.arrayContaining([{ type: "null" }]));
  }
});
it("declares absolute publication receipts separately from the image manifest", () => {
  const data = schema("images.extract").result.oneOf?.[0]?.properties?.data;
  expect(data?.required).toEqual(["complete", "inventory", "manifest", "entries"]);
  expect(data?.additionalProperties).toBe(false);
  expect(data?.properties?.inventory).toEqual({ type: "null" });
  expect(data?.properties?.manifest?.oneOf?.[0]).toMatchObject({ required: ["path", "bytes", "sha256", "published"], additionalProperties: false });
  expect(data?.properties?.entries?.items).toMatchObject({ required: ["path", "part", "bytes", "sha256", "locations", "published"], additionalProperties: false });
});
it("admits extraction failure receipts only after a complete false image plan", () => {
  const failure = schema("images.extract").result.oneOf?.[1];
  expect(failure?.properties?.data?.oneOf).toHaveLength(2);
  expect(failure?.properties?.data?.oneOf?.[0]).toEqual({ type: "null" });
  const partial = failure?.properties?.data?.oneOf?.[1];
  expect(partial).toMatchObject({ required: ["complete", "inventory", "manifest", "entries"], additionalProperties: false, properties: { complete: { const: false }, inventory: { type: "null" } } });
  expect(partial?.properties?.entries?.items).toMatchObject({ required: ["path", "part", "bytes", "sha256", "locations", "published"], additionalProperties: false });
  expect(failure?.properties?.locations?.items).toMatchObject({ required: ["kind", "token", "value", "positions"] });
  for (const operation of ["images.list", "images.get"]) expect(schema(operation).result.oneOf?.[1]?.properties?.data).toEqual({ type: "null" });
});
it("explains selected owners, inert bytes and manifest publication in image help", () => {
  const list = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.list" } })!.human;
  for (const word of ["selected owners", "first selected", "null", "external", "render"]) expect(list).toContain(word);
  const extract = getDocxDiscovery({ operation: "help", inputs: [], options: { operation: "images.extract" } })!.human;
  for (const word of ["manifest.json", "allow-partial-output", "two outputs", "exact", ".bin"]) expect(extract).toContain(word);
});
it("retains identical strict CLI and SDK image options without extraction dry run", () => {
  for (const operation of ["images.list", "images.get", "images.extract"]) {
    const cli = getDocxOperationSchema(operation, "cli"), sdk = getDocxOperationSchema(operation, "sdk");
    expect(Object.keys(cli.properties ?? {})).toEqual(Object.keys(sdk.properties ?? {}));
    expect(cli.additionalProperties).toBe(false);
    expect(sdk.additionalProperties).toBe(false);
    if (operation === "images.extract") {
      expect(cli.properties?.dryRun).toBeUndefined();
      expect(() => validateDocxInvocation({ operation, inputs: ["input"], options: {} })).toThrow("Extraction requires an output directory.");
    }
  }
});
