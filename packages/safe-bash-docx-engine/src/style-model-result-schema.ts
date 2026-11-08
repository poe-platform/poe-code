import { docxOperationSchemas, splitDocxType } from "./operation-schema.js";
import { docxValueSchema, type DocxJsonSchema } from "./operation-json-schema.js";
import { styleModelBatchOperations as styleOperations } from "./style-model-batch-operations.js";
import { structureModelBatchActions } from "./structure-model-batch-operations.js";
import { inspectionOperationMetadata } from "./discovery-result-schema.js";
const styleModelBatchOperations = [...styleOperations, ...structureModelBatchActions.keys()];
const object = (properties: Record<string, DocxJsonSchema>): DocxJsonSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const string: DocxJsonSchema = { type: "string" };
const integer: DocxJsonSchema = { type: "integer", minimum: 0 };
function value(type: string): DocxJsonSchema {
  if (type.startsWith("Promise<") && type.endsWith(">")) return value(type.slice(8, -1));
  if (type === "readonly [Length, Length]") return { type: "array", items: docxValueSchema("Length"), minItems: 2, maxItems: 2 };
  if (type === "Uint8Array") return object({ kind: { const: "bytes" }, base64: string });
  if (type === "PackURI") return string;
  if (type === "ExpandedName") return docxValueSchema(type);
  if (type === "Date") return docxValueSchema(type);
  if (type === "readonly [string, RelationshipView]") return { type: "array", items: { anyOf: [string, value("RelationshipView")] }, minItems: 2, maxItems: 2 };
  if (type === "Image") return object({ id: string, type: { const: "Image" }, owner: { const: "batch" }, revision: { const: 0 } });
  const variants = splitDocxType(type);
  if (variants.length > 1) return { anyOf: variants.map(value) };
  if (type.startsWith("ReadonlyMap<string, ") && type.endsWith(">")) return { type: "array", items: object({ key: string, value: value(type.slice("ReadonlyMap<string, ".length, -1)) }) };
  if (type === "ReadonlyMap<ExpandedName, string>") return { type: "array", items: object({ key: docxValueSchema("ExpandedName"), value: string }) };
  if (["Length", "Emu", "Inches", "Cm", "Mm", "Pt", "Twips"].includes(type)) return docxValueSchema("Length");
  if (type === "void") return { type: "null" };
  if (["string", "number", "boolean", "null", "Length"].includes(type) || type.startsWith("WD_") || type.startsWith("MSO_")) return docxValueSchema(type);
  if ((type.startsWith("IterableIterator<") || type.startsWith("ReadonlyArray<")) && type.endsWith(">")) return { type: "array", items: value(type.slice(type.indexOf("<") + 1, -1)) };
  const styleTypes = ["BaseStyle", "CharacterStyle", "ParagraphStyle", "_TableStyle", "_NumberingStyle"];
  const partTypes = ["PartView", "XmlPartView", "StylesPart", "DocumentPart", "CorePropertiesPart", "ImagePart"];
  return object({ id: string, type: styleTypes.includes(type) ? { enum: styleTypes } : partTypes.includes(type) ? { enum: [...partTypes, "NumberingPart"] } : { const: type }, owner: { const: "document" }, revision: { const: 0 } });
}
export function styleModelOperationResultSchema(id: string): DocxJsonSchema {
  if (id === "paragraphs.get" || id === "runs.get") return inspectionOperationMetadata[id]!.result.oneOf![0]!;
  const empty: DocxJsonSchema = {type: "array", maxItems: 0};
  return object({version: {const: 1}, operation: { const: id }, ok: {const: true}, data: value(docxOperationSchemas[id]!.valueType),
    warnings: {type: "array", items: object({code: string, message: string})}, errors: empty, affected: integer,
    locations: {type: "array", items: inspectionOperationMetadata["text.replace"]!.result.oneOf![0]!.properties!.locations!.items as DocxJsonSchema}});
}
export function batchPublicationSchema(): DocxJsonSchema {
  const mutation = inspectionOperationMetadata["text.replace"]!.result.oneOf![0]!.properties!.data!;
  const change = (mutation.properties!.changes!.items as DocxJsonSchema).properties!;
  return { ...mutation, properties: { ...mutation.properties, changes: { type: "array", items: object({ kind: { enum: ["add", "set", "remove", "replace"] }, before: { anyOf: [change.before!, { type: "null" }] }, after: { anyOf: [change.after!, { type: "null" }] } }) } } };
}
export function styleModelBatchResultSchema(): DocxJsonSchema {
  const empty: DocxJsonSchema = { type: "array", maxItems: 0 };
  return { oneOf: [object({ version: { const: 1 }, operation: { const: "batch" }, ok: { const: true },
    data: object({ results: { type: "array", items: { oneOf: [...styleModelBatchOperations.filter(id => docxOperationSchemas[id]), "paragraphs.get", "runs.get"].map(styleModelOperationResultSchema) } }, publication: {anyOf: [batchPublicationSchema(), {type: "null"}]} }),
    warnings: { type: "array", items: object({ code: string, message: string }) }, errors: empty, affected: integer, locations: empty }), object({ version: { const: 1 }, operation: { const: "batch" }, ok: { const: false }, data: { type: "null" }, warnings: empty,
    errors: { type: "array", minItems: 1, items: object({ code: string, message: string }) }, affected: { const: 0 }, locations: empty })] };
}
