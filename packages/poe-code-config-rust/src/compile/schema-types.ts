export type JsonValue=null|boolean|number|string|JsonValue[]|{[key:string]:JsonValue};
export type JsonSchemaType="string"|"number"|"integer"|"boolean"|"object"|"array"|"null";
export interface JsonSchema {
  additionalProperties?: boolean | JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  type?: JsonSchemaType | JsonSchemaType[];
  description?: string;
  default?: unknown;
  enum?: ReadonlyArray<JsonValue>;
  const?: JsonValue;
  format?: string;
  items?: JsonSchema;
  maxItems?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  minimum?: number;
  minLength?: number;
  nullable?: boolean;
  not?: JsonSchema;
  oneOf?: JsonSchema[];
  pattern?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
}
export interface JsonSchemaDocumentOptions {id?:string;title?:string;description?:string;schema?:string;}
export type JsonSchemaDocument=JsonSchema & {$schema:string;$id?:string;title?:string;description?:string};
