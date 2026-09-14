import { describe, expect, it } from "vitest";
import { docxCommonOptions, docxOperationSchemas } from "./operation-schema.js";
import { docxValueSchema, getDocxOperationSchema } from "./operation-json-schema.js";

describe("machine readable operation schemas", () => {
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
