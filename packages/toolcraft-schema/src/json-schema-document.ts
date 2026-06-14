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

export function createJsonSchemaDocument(
  jsonSchema: JsonSchema,
  options: JsonSchemaDocumentOptions = {}
): JsonSchemaDocument {
  const {
    id,
    schema: schemaUri = "https://json-schema.org/draft/2020-12/schema",
    ...metadata
  } = options;
  const document: JsonSchemaDocument = {
    $schema: schemaUri,
    ...jsonSchema
  };

  if (id !== undefined) {
    document.$id = id;
  }

  if (metadata.title !== undefined) {
    document.title = metadata.title;
  }

  if (metadata.description !== undefined) {
    document.description = metadata.description;
  }

  return document;
}
