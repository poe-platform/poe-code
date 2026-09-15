import { describe, expect, it } from "vitest";
import { docxCommonOptions, docxOperationSchemas } from "./operation-schema.js";
import { docxValueSchema, getDocxOperationSchema } from "./operation-json-schema.js";

describe("machine readable operation schemas", () => {
  it("publishes closed native layout polygons and unsigned stacking bounds", () => {
    const schema = getDocxOperationSchema("images.set", "cli");
    expect(schema.properties?.zOrder).toMatchObject({ type: "integer", minimum: 0, maximum: 4294967295 });
    const polygon = schema.properties?.wrapPolygonJson;
    expect(polygon?.additionalProperties).toBe(false);
    expect(polygon?.required).toEqual(["start", "lineTo"]);
    expect(polygon?.properties?.lineTo?.minItems).toBe(2);
    expect(polygon?.properties?.start?.properties?.x).toMatchObject({ minimum: -27273042329600, maximum: 27273042316900 });
  });
  it("describes operation-specific converted layout length domains without narrowing other operations", () => {
    const schema = getDocxOperationSchema("images.set");
    for (const axis of ["x", "y"]) expect(schema.properties?.[axis]?.description).toContain("[-2147483648,2147483647]");
    for (const size of ["width", "height"]) expect(schema.properties?.[size]?.description).toContain("[1,2147483647]");
    for (const side of ["distanceTop", "distanceBottom", "distanceLeft", "distanceRight"]) {
      expect(schema.properties?.[side]?.description).toContain("[0,4294967295]");
      expect(schema.properties?.[side]?.properties?.value?.minimum).toBe(0);
    }
    expect(getDocxOperationSchema("images.add").properties?.width).toEqual(docxValueSchema("Length (explicit emu/in/cm/mm/pt)"));
  });
  it("emits exact EMU bounds checked before and after native layout conversion", () => {
    const schema = getDocxOperationSchema("images.set");
    const emu = (field: string) => schema.properties?.[field]?.allOf?.[0]?.oneOf?.find(branch => branch.properties?.unit?.const === "emu")?.properties?.value;
    expect(emu("x")).toEqual({ type: "number", minimum: -2147483648, maximum: 2147483647 });
    expect(emu("width")).toEqual({ type: "number", minimum: 0.5, maximum: 2147483647 });
    expect(emu("distanceLeft")).toEqual({ type: "number", minimum: 0, maximum: 4294967295 });
  });
  it("describes closed operation fields with required values and explicit null unions", () => {
    const replacement = getDocxOperationSchema("text.replace");
    expect(replacement.additionalProperties).toBe(false);
    expect(replacement.required).toContain("find");
    expect(replacement.properties?.with).toEqual({ type: "string" });
    const bold = getDocxOperationSchema("model.text.run.Run.bold.set", "batch");
    expect(bold.properties?.value).toEqual({ anyOf: [{ type: "boolean" }, { type: "null" }] });
    expect(() => getDocxOperationSchema("script.eval")).toThrow();
  });
  it("describes enum symbols and recursive content with closed records", () => {
    const alignment = docxValueSchema("WD_PARAGRAPH_ALIGNMENT");
    expect(alignment.properties?.enum).toEqual({ const: "WD_PARAGRAPH_ALIGNMENT" });
    expect(alignment.properties?.name?.enum).toContain("CENTER");
    const content = docxValueSchema("OriginalDocumentContentV1");
    expect(content.$defs?.Block).toBeDefined();
    expect(content.$defs?.RunInput?.additionalProperties).toBe(false);
    expect(content.properties?.version).toEqual({ const: 1 });
  });
  it("publishes a closed batch discriminator without nested batches or discovery", () => {
    const schema = docxValueSchema("BatchV1");
    expect(schema.properties?.version).toEqual({ const: 1 });
    const item = schema.properties?.operations?.items;
    expect(item && item.oneOf?.some(operation => operation.properties?.operation?.const === "model.table._Cell.text.set")).toBe(true);
    expect(item && item.oneOf?.some(operation => operation.properties?.operation?.const === "batch")).toBe(false);
  });

  it("resolves every published field type to a transport schema", () => {
    const types = new Set(Object.values(docxCommonOptions).map(field => field.type));
    for (const declaration of Object.values(docxOperationSchemas)) {
      for (const fields of [declaration.fields, declaration.sdkFields, declaration.batchFields ?? {}]) {
        for (const field of Object.values(fields)) types.add(field.type);
      }
    }
    for (const type of types) expect(JSON.stringify(docxValueSchema(type)), type).not.toContain("No transport value is declared");
  });

});
