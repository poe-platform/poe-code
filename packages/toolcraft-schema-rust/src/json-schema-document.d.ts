import type { JsonSchema } from "./index.js";
export interface JsonSchemaDocumentOptions {
  id?: string;
  title?: string;
  description?: string;
  schema?: string;
}
export type JsonSchemaDocument = JsonSchema & {
  $schema: string;
  $id?: string;
  title?: string;
  description?: string;
};
export declare function createJsonSchemaDocument(
  jsonSchema: JsonSchema,
  options?: JsonSchemaDocumentOptions
): JsonSchemaDocument;
