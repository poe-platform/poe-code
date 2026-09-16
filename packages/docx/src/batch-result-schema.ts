import { documentBatchOperations } from "./batch-operations.js";
import { docxOperationSchemas } from "./operation-schema.js";
import { styleModelBatchResultSchema } from "./style-model-result-schema.js";
import { imageOperationContracts, inspectionOperationMetadata, propertyOperationContracts, rasterInsertionOperationContracts, rasterReplacementOperationContracts, imageLayoutOperationContracts } from "./discovery-result-schema.js";
import type { DocxJsonSchema } from "./operation-json-schema.js";
const object = (properties: Record<string, DocxJsonSchema>): DocxJsonSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const integer: DocxJsonSchema = { type: "integer", minimum: 0 };
const string: DocxJsonSchema = { type: "string" };
export function documentBatchResultSchema(): DocxJsonSchema {
  const original = styleModelBatchResultSchema().oneOf!;
  const results = documentBatchOperations.map(id => {
    const result = inspectionOperationMetadata[id]?.result ?? imageOperationContracts[id]?.result ?? propertyOperationContracts[id]?.result ?? rasterInsertionOperationContracts[id]?.result ?? rasterReplacementOperationContracts[id]?.result ?? imageLayoutOperationContracts[id]?.result ?? docxOperationSchemas[id]!.discovery?.result;
    const success = result?.oneOf?.find(branch => branch.properties?.ok?.const === true);
    if (!success?.properties) throw new Error("Missing utility batch result contract.");
    let data = success.properties.data!;
    if (["fields.add", "fields.set", "toc.add", "toc.set", "captions.add", "captions.set"].includes(id) && data?.properties?.changes) {
      const changes = data.properties.changes;
      const item = changes.items as DocxJsonSchema;
      data = { ...data, properties: { ...data.properties, changes: { ...changes, items: { ...item, properties: { ...item.properties, kind: { enum: ["replace", "insert"] } } } } } };
    }
    return { ...success, properties: { id: { type: "string", minLength: 1, maxLength: 64 }, ...success.properties, affected: docxOperationSchemas[id]!.mutates ? integer : { const: 0 }, data }, required: ["id", ...success.required!] };
  });
  const mutation = inspectionOperationMetadata["text.replace"]!.result.oneOf![0]!.properties!.data!;
  const change = (mutation.properties!.changes!.items as DocxJsonSchema).properties!;
  const publication = { ...mutation, properties: { ...mutation.properties, changes: { type: "array", items: object({ kind: { enum: ["add", "set", "remove", "replace"] }, before: { anyOf: [change.before!, { type: "null" }] }, after: { anyOf: [change.after!, { type: "null" }] } }) } } } as DocxJsonSchema;
  const success = { ...original[0]!, properties: { ...original[0]!.properties, data: object({ results: { type: "array", items: { oneOf: results } }, publication: { anyOf: [publication, { type: "null" }] } }) } };
  const failure = original[1]!;
  const error = failure.properties!.errors!.items as DocxJsonSchema;
  return { oneOf: [original[0]!, success, { ...failure, properties: { ...failure.properties, errors: { ...failure.properties!.errors, items: { ...error, properties: { ...error.properties, operationIndex: integer, operationId: string } } } } }] };
}
