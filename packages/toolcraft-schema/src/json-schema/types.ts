import type { ValidationIssue, ValidationResult } from "../validate.js";

export type JsonSchemaRegistry = Record<string, unknown>;

export interface CompileJsonSchemaOptions {
  registry?: JsonSchemaRegistry;
}

export interface CompiledJsonSchema {
  validate(value: unknown): ValidationResult<unknown>;
}

export type Dialect = "draft7" | "draft2020-12";

export type SchemaObject = Record<string, unknown>;
export type JsonSchema = boolean | SchemaObject;

export interface SchemaNode {
  schema: JsonSchema;
  documentId: string;
  dialect: Dialect;
  baseUri: string;
  resourceUri: string;
  resourceRoot: SchemaNode;
  pointer: string;
  validationVocabulary: boolean;
  children: Map<string, SchemaNode>;
}

export interface EvaluationResult {
  valid: boolean;
  issues: ValidationIssue[];
  evaluatedProperties: Set<string>;
  evaluatedItems: Set<number>;
}

export interface EvaluationContext {
  instancePath: readonly string[];
  dynamicScope: readonly SchemaNode[];
  activePairs: Map<SchemaNode, Set<unknown>>;
}
