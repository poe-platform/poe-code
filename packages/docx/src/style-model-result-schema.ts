import { docxOperationSchemas, splitDocxType } from "./operation-schema.js";
import { docxValueSchema, type DocxJsonSchema } from "./operation-json-schema.js";
import { styleModelBatchOperations } from "./style-model-batch-operations.js";
const object = (properties: Record<string, DocxJsonSchema>): DocxJsonSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const string: DocxJsonSchema = { type: "string" };
const integer: DocxJsonSchema = { type: "integer", minimum: 0 };
function value(type: string): DocxJsonSchema {
  if (type.startsWith("Promise<") && type.endsWith(">")) return value(type.slice(8, -1));
  if (type === "readonly [Length, Length]") return { type: "array", items: docxValueSchema("Length"), minItems: 2, maxItems: 2 };
  if (type === "Uint8Array") return object({ kind: { const: "bytes" }, base64: string });
  if (type === "Image") return object({ id: string, type: { const: "Image" }, owner: { const: "batch" }, revision: { const: 0 } });
  const variants = splitDocxType(type);
  if (variants.length > 1) return { anyOf: variants.map(value) };
  if (type.startsWith("ReadonlyMap<string, ") && type.endsWith(">")) return { type: "array", items: object({ key: string, value: value(type.slice("ReadonlyMap<string, ".length, -1)) }) };
  if (["Length", "Emu", "Inches", "Cm", "Mm", "Pt", "Twips"].includes(type)) return docxValueSchema("Length");
  if (type === "void") return { type: "null" };
  if (["string", "number", "boolean", "null", "Length"].includes(type) || type.startsWith("WD_") || type.startsWith("MSO_")) return docxValueSchema(type);
  if ((type.startsWith("IterableIterator<") || type.startsWith("ReadonlyArray<")) && type.endsWith(">")) return { type: "array", items: value(type.slice(type.indexOf("<") + 1, -1)) };
  const styleTypes = ["BaseStyle", "CharacterStyle", "ParagraphStyle", "_TableStyle", "_NumberingStyle"];
  return object({ id: string, type: styleTypes.includes(type) ? { enum: styleTypes } : { const: type }, owner: { const: "document" }, revision: { const: 0 } });
}
export function styleModelOperationResultSchema(id: string): DocxJsonSchema {
  return object({ operation: { const: id }, value: value(docxOperationSchemas[id]!.valueType) });
}
export function styleModelBatchResultSchema(): DocxJsonSchema {
  const empty: DocxJsonSchema = { type: "array", maxItems: 0 };
  return { oneOf: [object({ version: { const: 1 }, operation: { const: "batch" }, ok: { const: true },
    data: object({ results: { type: "array", items: { oneOf: styleModelBatchOperations.filter(id => docxOperationSchemas[id]).map(styleModelOperationResultSchema) } }, dryRun: { type: "boolean" }, output: { type: "array", items: object({ path: string, bytes: integer }) } }),
    warnings: { type: "array", items: object({ code: string, message: string }) }, errors: empty, affected: integer, locations: empty }), object({ version: { const: 1 }, operation: { const: "batch" }, ok: { const: false }, data: { type: "null" }, warnings: empty,
    errors: { type: "array", minItems: 1, items: object({ code: string, message: string }) }, affected: { const: 0 }, locations: empty })] };
}
