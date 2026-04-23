import { UserError } from "toolcraft";
import {
  METHOD_DEFAULTS,
  deriveNoun,
  deriveVerb,
  isIdentifierName,
  normalizeParamName,
  toCamelCase,
  toPascalCase,
  type HttpMethod
} from "./naming.js";
import { groupByNoun } from "./group-by-noun.js";
import { renderPreflightBlock, renderRequestShape } from "./interpreter.js";

const HTTP_METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;
const UNSUPPORTED_HTTP_METHODS = ["head", "options", "trace"] as const;
const METHODS_WITHOUT_REQUEST_BODY = new Set<HttpMethod>(["get"]);
type OpenApiOperation = OpenApiOperationObject | OpenApiReferenceObject;
type OpenApiOperationMap = Partial<Record<HttpMethod, OpenApiOperation>>;
type OpenApiParameterLocation = "path" | "query" | "header" | "cookie";
type SupportedOpenApiParameterLocation = "path" | "query";
type ParamKind = "string" | "number" | "boolean" | "enum" | "array";
type OpenApiScalarType = "string" | "number" | "integer" | "boolean";
export type GeneratedRequestLocation = Exclude<GeneratedParam["location"], "transport">;
type FieldSchemaKind = "array" | "object" | "scalar";
type NullHelperShape = "scalar" | "array";

const SCHEMA_TYPE_TO_KIND: Record<
  OpenApiScalarType,
  { kind: GeneratedScalarParamDefinition["kind"]; jsonType?: "integer" }
> = {
  boolean: { kind: "boolean" },
  integer: { kind: "number", jsonType: "integer" },
  number: { kind: "number" },
  string: { kind: "string" }
};

const NULL_HELPER_SUPPORT = {
  body: { array: true, scalar: true },
  path: { array: false, scalar: false },
  // Query null already serializes as the existing empty-string wire encoding, so v1
  // keeps null-helper flags body-only until a real query-null convention lands.
  query: { array: false, scalar: false }
} as const satisfies Record<GeneratedRequestLocation, Record<NullHelperShape, boolean>>;

const TRANSPORT_PARAMS = [
  {
    paramName: "dryRun",
    sourceName: "dryRun",
    location: "transport",
    description: "Print the HTTP request and exit without sending it.",
    scope: ["cli", "sdk"],
    optional: true,
    definition: { kind: "boolean" }
  },
  {
    paramName: "verbose",
    sourceName: "verbose",
    location: "transport",
    description: "Log the request line to stderr.",
    shortFlag: "v",
    scope: ["cli", "sdk"],
    optional: true,
    definition: { kind: "boolean" }
  }
] as const satisfies ReadonlyArray<GeneratedParam>;

export interface OpenApiDocument {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
  };
  security?: OpenApiSecurityRequirementObject[];
  paths?: Record<string, OpenApiPathItemObject | undefined>;
  components?: {
    securitySchemes?: Record<string, unknown>;
    parameters?: Record<string, OpenApiParameterObject | OpenApiReferenceObject>;
    requestBodies?: Record<string, OpenApiRequestBodyObject | OpenApiReferenceObject>;
    responses?: Record<string, OpenApiResponseObject | OpenApiReferenceObject>;
    schemas?: Record<string, OpenApiSchemaObject | OpenApiReferenceObject>;
  };
}

export interface OpenApiPathItemObject extends OpenApiOperationMap {
  parameters?: OpenApiParameter[];
}

export interface OpenApiOperationObject {
  tags?: string[];
  summary?: string;
  description?: string;
  operationId?: string;
  security?: OpenApiSecurityRequirementObject[];
  servers?: OpenApiServerObject[];
  parameters?: OpenApiParameter[];
  requestBody?: OpenApiRequestBodyObject | OpenApiReferenceObject;
  responses?: Record<string, OpenApiResponseObject | OpenApiReferenceObject>;
}

export type OpenApiParameter = OpenApiParameterObject | OpenApiReferenceObject;

export interface OpenApiParameterObject {
  name: string;
  in: OpenApiParameterLocation;
  required?: boolean;
  description?: string;
  content?: Record<string, OpenApiMediaTypeObject | undefined>;
  explode?: boolean;
  schema?: OpenApiSchemaObject | OpenApiReferenceObject;
  style?: string;
}

type SupportedOpenApiParameterObject = Omit<OpenApiParameterObject, "in"> & {
  in: SupportedOpenApiParameterLocation;
};

export interface OpenApiRequestBodyObject {
  description?: string;
  required?: boolean;
  content?: Record<string, OpenApiMediaTypeObject | undefined>;
}

export interface OpenApiResponseObject {
  description?: string;
  content?: Record<string, OpenApiMediaTypeObject | undefined>;
}

export interface OpenApiMediaTypeObject {
  schema?: OpenApiSchemaObject | OpenApiReferenceObject;
}

export interface OpenApiSchemaObject {
  type?: "string" | "number" | "integer" | "boolean" | "object" | "array";
  additionalProperties?: boolean | OpenApiSchemaObject | OpenApiReferenceObject;
  allOf?: Array<OpenApiSchemaObject | OpenApiReferenceObject>;
  anyOf?: Array<OpenApiSchemaObject | OpenApiReferenceObject>;
  description?: string;
  default?: unknown;
  enum?: unknown[];
  format?: string;
  items?: OpenApiSchemaObject | OpenApiReferenceObject;
  maxItems?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  minimum?: number;
  minLength?: number;
  nullable?: boolean;
  oneOf?: Array<OpenApiSchemaObject | OpenApiReferenceObject>;
  pattern?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchemaObject | OpenApiReferenceObject>;
  readOnly?: boolean;
  writeOnly?: boolean;
}

export interface OpenApiReferenceObject {
  $ref: string;
}

interface OpenApiServerObject {
  url: string;
  description?: string;
}

type OpenApiSecurityRequirementObject = Record<string, string[]>;

export interface GenerateOptions {
  specSha: string;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

export interface GeneratedCommand {
  noun: string;
  verb: string;
  exportName: string;
  filePath: string;
  operationId: string;
  description?: string;
  method: string;
  path: string;
  auth: "required" | "none";
  confirm: boolean;
  params: GeneratedParam[];
  paramsSchemaOptions?: GeneratedObjectSchemaOptions;
  preflightBlocks: GeneratedPreflightBlock[];
  requestFields: GeneratedRequestField[];
  sectionRenders: GeneratedRequestSectionRenders;
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
}

export interface GeneratedParam {
  paramName: string;
  sourceName: string;
  location: "path" | "query" | "body" | "transport";
  description?: string;
  shortFlag?: string;
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]];
  optional: boolean;
  definition: GeneratedParamDefinition;
}

interface GeneratedParamDefinitionMetadata {
  defaultValue?: unknown;
  format?: string;
  jsonType?: "integer";
  maxItems?: number;
  maximum?: number;
  maxLength?: number;
  minItems?: number;
  minimum?: number;
  minLength?: number;
  nullable?: boolean;
  pattern?: string;
  requiredScopes?: readonly [GeneratedParamScope, ...GeneratedParamScope[]];
}

interface GeneratedScalarParamDefinition extends GeneratedParamDefinitionMetadata {
  kind: "string" | "number" | "boolean";
}

interface GeneratedEnumParamDefinition extends GeneratedParamDefinitionMetadata {
  kind: "enum";
  enumValues: readonly [GeneratedEnumValue, ...GeneratedEnumValue[]];
}

interface GeneratedArrayParamDefinition extends GeneratedParamDefinitionMetadata {
  kind: "array";
  itemDefinition: GeneratedParamDefinition;
}

export type GeneratedParamDefinition =
  | GeneratedScalarParamDefinition
  | GeneratedEnumParamDefinition
  | GeneratedArrayParamDefinition;

type GeneratedParamScope = "cli" | "mcp" | "sdk";
type GeneratedEnumValue = string | number | boolean;
export type GeneratedValueReference =
  | { kind: "param"; paramName: string }
  | { kind: "resolved"; resolvedName: string };
export type GeneratedValueExpression =
  | { kind: "reference"; reference: GeneratedValueReference }
  | {
      kind: "queryArray";
      reference: GeneratedValueReference;
      serialization: QueryArraySerialization;
    };

export interface GeneratedRequestField {
  location: Exclude<GeneratedParam["location"], "transport">;
  omitWhenUndefinedReference: GeneratedValueReference;
  wireName: string;
  value: GeneratedValueExpression;
}

export type GeneratedRequestSectionRender = "inline" | "wrapped";

export type GeneratedRequestSectionRenders = Partial<{
  [K in GeneratedRequestLocation]: K extends "body" ? GeneratedRequestSectionRender : "wrapped";
}>;

export interface GeneratedObjectSchemaOptions {
  additionalProperties?: boolean;
}

interface CollectedCommandParams {
  params: GeneratedParam[];
  paramsSchemaOptions?: GeneratedObjectSchemaOptions;
  preflightBlocks: GeneratedPreflightBlock[];
  requestFields: GeneratedRequestField[];
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
  sectionRenders: GeneratedRequestSectionRenders;
  requestBodyDescription?: string;
}

interface GeneratedParameterAssembly {
  params: GeneratedParam[];
  preflightBlocks: GeneratedPreflightBlock[];
  requestField: GeneratedRequestField;
}

interface RenderSchemaOptionsInput {
  definition: GeneratedParamDefinition;
  description?: string;
  shortFlag?: string;
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]];
}

export type GeneratedPreflightBlock =
  | {
      kind: "scalar-null";
      paramName: string;
      nullParamName: string;
      resolvedName: string;
      required: boolean;
    }
  | {
      kind: "array";
      paramName: string;
      jsonParamName: string;
      nullParamName?: string;
      resolvedName: string;
      required: boolean;
    };

interface SchemaOptionEntry {
  key: string;
  value: unknown;
}

const SCHEMA_OPTION_SOURCES = [
  {
    key: "description",
    get: (param: RenderSchemaOptionsInput) => param.description
  },
  {
    key: "default",
    get: (param: RenderSchemaOptionsInput) => param.definition.defaultValue
  },
  {
    key: "short",
    get: (param: RenderSchemaOptionsInput) => param.shortFlag
  },
  {
    key: "scope",
    get: (param: RenderSchemaOptionsInput) => param.scope
  },
  {
    key: "minimum",
    get: (param: RenderSchemaOptionsInput) => param.definition.minimum
  },
  {
    key: "maximum",
    get: (param: RenderSchemaOptionsInput) => param.definition.maximum
  },
  {
    key: "minLength",
    get: (param: RenderSchemaOptionsInput) => param.definition.minLength
  },
  {
    key: "maxLength",
    get: (param: RenderSchemaOptionsInput) => param.definition.maxLength
  },
  {
    key: "minItems",
    get: (param: RenderSchemaOptionsInput) => param.definition.minItems
  },
  {
    key: "maxItems",
    get: (param: RenderSchemaOptionsInput) => param.definition.maxItems
  },
  {
    key: "pattern",
    get: (param: RenderSchemaOptionsInput) => param.definition.pattern
  },
  {
    key: "format",
    get: (param: RenderSchemaOptionsInput) => param.definition.format
  },
  {
    key: "jsonType",
    get: (param: RenderSchemaOptionsInput) => param.definition.jsonType
  },
  {
    key: "nullable",
    get: (param: RenderSchemaOptionsInput) =>
      param.definition.nullable === true ? true : undefined
  },
  {
    key: "requiredScopes",
    get: (param: RenderSchemaOptionsInput) => param.definition.requiredScopes
  }
] as const satisfies ReadonlyArray<{
  key: string;
  get: (param: RenderSchemaOptionsInput) => unknown;
}>;

interface CreateArrayParamOptions {
  document: OpenApiDocument;
  name: string;
  description?: string;
  schema: OpenApiSchemaObject;
  optional: boolean;
  operationId: string;
  context: string;
  location: "query" | "body";
  querySerialization?: QueryArraySerialization;
}

interface CreateScalarParamOptions {
  document: OpenApiDocument;
  name: string;
  description?: string;
  schema: OpenApiSchemaObject;
  optional: boolean;
  operationId: string;
  context: string;
  location: GeneratedRequestLocation;
}

interface CreateFieldOptions extends CreateScalarParamOptions {
  querySerialization?: QueryArraySerialization;
}

type QueryArraySerialization = "repeat" | "comma" | "pipe";

interface OperationEntry {
  method: HttpMethod;
  path: string;
  operation: OpenApiOperation;
  pathItem: OpenApiPathItemObject;
}

export function generate(document: OpenApiDocument, options: GenerateOptions): GeneratedFile[] {
  const commands = collectGeneratedCommands(document);

  return [
    ...commands.map((command) => ({
      path: command.filePath,
      contents: createCommandFile({
        specSha: options.specSha,
        ...command
      })
    })),
    createIndexFile(commands)
  ];
}

export function collectGeneratedCommands(document: OpenApiDocument): GeneratedCommand[] {
  const paths = document.paths;

  if (paths === undefined) {
    throw new UserError('OpenAPI document must define a top-level "paths" object.');
  }

  const commands = collectOperations(paths).map((entry) => createGeneratedCommand(document, entry));

  assertUniqueCommandPaths(commands);

  return commands.slice().sort((left, right) => compareGeneratedCommandPaths(left, right));
}

function collectOperations(
  paths: Record<string, OpenApiPathItemObject | undefined>
): OperationEntry[] {
  return Object.entries(paths)
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([path, pathItem]) => {
      if (pathItem === undefined) {
        return [];
      }

      assertSupportedHttpMethods(path, pathItem);

      return HTTP_METHOD_ORDER.flatMap((method) => {
        const operation = pathItem[method];
        if (operation === undefined) {
          return [];
        }

        return [{ method, path, operation, pathItem } satisfies OperationEntry];
      });
    });
}

function createGeneratedCommand(
  document: OpenApiDocument,
  entry: OperationEntry
): GeneratedCommand {
  const operation = expectOperation(document, entry.operation, entry.method, entry.path);
  const operationId = operation.operationId ?? `${entry.method.toUpperCase()} ${entry.path}`;
  assertSupportedOperationMetadata(operation, operationId);
  assertSupportedSuccessResponses(document, operation, operationId);
  const noun = deriveNoun(operation, entry.path, operationId);
  assertValidGeneratedNoun(operationId, noun);
  const verb = deriveVerb(entry.method, entry.path, operation, operationId, noun);
  const collected = collectParams(document, entry, operation, operationId);
  const methodDefaults = METHOD_DEFAULTS[entry.method];
  const exportName = `${toCamelCase(noun)}${toPascalCase(verb)}Command`;
  const filePath = `${noun}/${verb}.ts`;

  return {
    noun,
    verb,
    exportName,
    filePath,
    operationId,
    description: mergeCommandDescriptions(
      operation.description ?? operation.summary,
      collected.requestBodyDescription
    ),
    method: entry.method.toUpperCase(),
    path: entry.path,
    auth: getOperationAuthMode(document, operation, operationId),
    confirm: methodDefaults?.confirm === true,
    params: collected.params,
    paramsSchemaOptions: collected.paramsSchemaOptions,
    preflightBlocks: collected.preflightBlocks,
    requestFields: collected.requestFields,
    sectionRenders: collected.sectionRenders,
    optionalSections: collected.optionalSections
  };
}

function assertSupportedOperationMetadata(
  operation: OpenApiOperationObject,
  operationId: string
): void {
  if (operation.servers !== undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported per-operation servers. Configure the client baseUrl instead.`
    );
  }
}

function collectParams(
  document: OpenApiDocument,
  entry: OperationEntry,
  operation: OpenApiOperationObject,
  operationId: string
): CollectedCommandParams {
  const operationParams = collectOperationParameters(
    document,
    entry.path,
    entry.pathItem.parameters ?? [],
    operation.parameters ?? [],
    operationId
  );
  const requestBodyParams = collectRequestBodyParams(
    document,
    operation,
    operationId,
    entry.method
  );
  const params = [...operationParams.params, ...requestBodyParams.params, ...TRANSPORT_PARAMS];
  const deduped = new Map<string, GeneratedParam>();

  for (const param of params) {
    const existing = deduped.get(param.paramName);

    if (existing !== undefined) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} maps both ${JSON.stringify(existing.sourceName)} and ${JSON.stringify(param.sourceName)} to flag ${JSON.stringify(param.paramName)}.`
      );
    }

    deduped.set(param.paramName, param);
  }

  return {
    params: [...deduped.values()],
    paramsSchemaOptions: requestBodyParams.paramsSchemaOptions,
    preflightBlocks: [...operationParams.preflightBlocks, ...requestBodyParams.preflightBlocks],
    requestFields: [...operationParams.requestFields, ...requestBodyParams.requestFields],
    sectionRenders: { ...operationParams.sectionRenders, ...requestBodyParams.sectionRenders },
    optionalSections: new Set([
      ...operationParams.optionalSections,
      ...requestBodyParams.optionalSections
    ]),
    requestBodyDescription: requestBodyParams.requestBodyDescription
  };
}

function collectOperationParameters(
  document: OpenApiDocument,
  path: string,
  pathItemParameters: OpenApiParameter[],
  operationParameters: OpenApiParameter[],
  operationId: string
): CollectedCommandParams {
  const merged = new Map<string, SupportedOpenApiParameterObject>();

  for (const parameter of pathItemParameters) {
    const resolved = expectParameter(document, parameter, operationId);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }

  for (const parameter of operationParameters) {
    const resolved = expectParameter(document, parameter, operationId);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }

  assertPathTemplateParameters(path, merged, operationId);

  const params: GeneratedParam[] = [];
  const preflightBlocks: GeneratedPreflightBlock[] = [];
  const requestFields: GeneratedRequestField[] = [];

  for (const parameter of merged.values()) {
    const generated = createGeneratedParameter(document, parameter, operationId);
    params.push(...generated.params);
    preflightBlocks.push(...generated.preflightBlocks);
    requestFields.push(generated.requestField);
  }

  return {
    params,
    paramsSchemaOptions: undefined,
    preflightBlocks,
    requestFields,
    sectionRenders: { path: "wrapped", query: "wrapped" },
    optionalSections: new Set(),
    requestBodyDescription: undefined
  };
}

function collectRequestBodyParams(
  document: OpenApiDocument,
  operation: OpenApiOperationObject,
  operationId: string,
  method: HttpMethod
): CollectedCommandParams {
  if (operation.requestBody === undefined) {
    return {
      params: [],
      paramsSchemaOptions: undefined,
      preflightBlocks: [],
      requestFields: [],
      sectionRenders: {},
      optionalSections: new Set(),
      requestBodyDescription: undefined
    };
  }

  if (METHODS_WITHOUT_REQUEST_BODY.has(method)) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported requestBody on ${method.toUpperCase()}. Request bodies are not supported on GET in v1.`
    );
  }

  const requestBody = expectRequestBody(
    document,
    operation.requestBody,
    operationId,
    "requestBody"
  );
  const content = Object.entries(requestBody.content ?? {}).find(
    ([mediaType, mediaTypeObject]) => mediaTypeObject !== undefined && isJsonMediaType(mediaType)
  )?.[1];

  if (content === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define a JSON request body media type in v1.`
    );
  }

  const schema = expectSchema(document, content.schema, operationId, "requestBody");
  const bodyOptional = requestBody.required !== true;

  if (schema.type !== "object") {
    const bodySchema =
      schema.description === undefined && requestBody.description !== undefined
        ? { ...schema, description: requestBody.description }
        : schema;

    return createCollectedRequestBodyParams(
      [createBodyField(document, "body", bodySchema, bodyOptional, operationId)],
      bodyOptional,
      schema.description === undefined ? undefined : requestBody.description,
      "inline",
      undefined
    );
  }

  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported requestBody. Object request bodies with additionalProperties are not supported in v1.`
    );
  }

  if (schema.properties === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define an object-shaped JSON request body.`
    );
  }

  const required = new Set(schema.required ?? []);
  const assemblies: GeneratedParameterAssembly[] = [];
  const declaredPropertyCount = Object.keys(schema.properties).length;

  for (const [name, property] of Object.entries(schema.properties)) {
    const propertySchema = expectSchema(
      document,
      property,
      operationId,
      `requestBody.properties.${name}`
    );

    if (propertySchema.readOnly === true) {
      continue;
    }

    const generated = createBodyField(
      document,
      name,
      propertySchema,
      bodyOptional || !required.has(name),
      operationId
    );
    assemblies.push(generated);
  }

  if (!bodyOptional && assemblies.length === 0) {
    const reason =
      declaredPropertyCount === 0
        ? "does not define any writable fields"
        : "all declared fields are readOnly";
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} requestBody is required but ${reason}.`
    );
  }

  return createCollectedRequestBodyParams(
    assemblies,
    bodyOptional,
    requestBody.description,
    "wrapped",
    schema.additionalProperties === false ? { additionalProperties: false } : undefined
  );
}

function assertSupportedSuccessResponses(
  document: OpenApiDocument,
  operation: OpenApiOperationObject,
  operationId: string
): void {
  for (const [statusCode, response] of Object.entries(operation.responses ?? {})) {
    if (!isSuccessStatusCode(statusCode)) {
      continue;
    }

    const resolvedResponse = expectResponse(document, response, operationId, statusCode);

    const declaredMediaTypes = Object.entries(resolvedResponse.content ?? {})
      .filter(([, mediaType]) => mediaType !== undefined)
      .map(([mediaType]) => mediaType);

    if (
      declaredMediaTypes.length === 0 ||
      declaredMediaTypes.every((mediaType) => isJsonMediaType(mediaType))
    ) {
      for (const [mediaType, mediaTypeObject] of Object.entries(resolvedResponse.content ?? {})) {
        if (
          mediaTypeObject === undefined ||
          mediaTypeObject.schema === undefined ||
          !isJsonMediaType(mediaType)
        ) {
          continue;
        }

        assertSupportedSuccessResponseSchema(
          document,
          mediaTypeObject.schema,
          operationId,
          `success response schema for status ${JSON.stringify(statusCode)}`
        );
      }

      continue;
    }

    throw new UserError(
      `Operation ${JSON.stringify(operationId)} declares unsupported success response content type(s) for status ${JSON.stringify(statusCode)}: ${declaredMediaTypes
        .map((mediaType) => JSON.stringify(mediaType))
        .join(
          ", "
        )}. Only application/json responses (or empty success responses) are supported in v1.`
    );
  }
}

function assertSupportedSuccessResponseSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject | OpenApiReferenceObject,
  operationId: string,
  context: string
): void {
  const resolvedSchema = expectSupportedSuccessResponseSchema(
    document,
    schema,
    operationId,
    context
  );

  if (
    resolvedSchema.additionalProperties !== undefined &&
    resolvedSchema.additionalProperties !== false
  ) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Object response schemas with additionalProperties are not supported in v1.`
    );
  }

  for (const [propertyName, propertySchema] of Object.entries(resolvedSchema.properties ?? {})) {
    assertSupportedSuccessResponseSchema(
      document,
      propertySchema,
      operationId,
      `${context} property ${JSON.stringify(propertyName)}`
    );
  }

  if (resolvedSchema.items !== undefined) {
    assertSupportedSuccessResponseSchema(
      document,
      resolvedSchema.items,
      operationId,
      `${context} items`
    );
  }
}

function expectSupportedSuccessResponseSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined,
  operationId: string,
  context: string
): OpenApiSchemaObject {
  const resolvedSchema = resolveSchema(document, schema, operationId, context);
  const compositionKeyword = getCompositionKeyword(resolvedSchema);

  if (compositionKeyword === undefined) {
    return resolvedSchema;
  }

  const nullableAnyOfSchema =
    compositionKeyword === "anyOf"
      ? resolveNullableAnyOfSchema(document, resolvedSchema, operationId, context)
      : undefined;

  if (nullableAnyOfSchema !== undefined) {
    return nullableAnyOfSchema;
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. JSON Schema composition keyword ${JSON.stringify(compositionKeyword)} is not supported in v1.`
  );
}

function createGeneratedParameter(
  document: OpenApiDocument,
  parameter: SupportedOpenApiParameterObject,
  operationId: string
): GeneratedParameterAssembly {
  const schema = expectSchema(
    document,
    parameter.schema,
    operationId,
    `parameter ${JSON.stringify(parameter.name)}`
  );

  if (parameter.in === "path") {
    if (parameter.required !== true) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(parameter.name)} must set required: true.`
      );
    }

    if (schema.nullable === true) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(parameter.name)} uses unsupported nullable schema. Path parameters cannot be nullable in v1.`
      );
    }

    assertSupportedPathParameterSerialization(parameter, operationId);
  }

  return createField({
    document,
    name: parameter.name,
    description: parameter.description ?? schema.description,
    schema,
    optional: parameter.required !== true,
    operationId,
    context: `parameter ${JSON.stringify(parameter.name)}`,
    location: parameter.in,
    querySerialization:
      parameter.in === "query" && schema.type === "array"
        ? resolveQueryArraySerialization(parameter, operationId)
        : undefined
  });
}

function assertSupportedPathParameterSerialization(
  parameter: SupportedOpenApiParameterObject,
  operationId: string
): void {
  const style = parameter.style ?? "simple";
  const explode = parameter.explode ?? false;

  if (style === "simple" && explode === false) {
    return;
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(parameter.name)} uses unsupported serialization. Path parameters must use style "simple" with explode false in v1.`
  );
}

function createBodyField(
  document: OpenApiDocument,
  name: string,
  schema: OpenApiSchemaObject,
  optional: boolean,
  operationId: string
): GeneratedParameterAssembly {
  return createField({
    document,
    name,
    description: schema.description,
    schema,
    optional,
    operationId,
    context: `request body field ${JSON.stringify(name)}`,
    location: "body"
  });
}

function createField(options: CreateFieldOptions): GeneratedParameterAssembly {
  return FIELD_ASSEMBLERS[options.location][getFieldSchemaKind(options.schema)](options);
}

function createScalarParam(options: CreateScalarParamOptions): GeneratedParameterAssembly {
  const { document, name, description, schema, optional, operationId, context, location } = options;
  const paramName = name;
  const definition = createParamDefinition(document, schema, operationId, context);
  const emitsNullHelper = supportsNullHelper(location, "scalar", definition.nullable);
  const params: GeneratedParam[] = [
    {
      paramName,
      sourceName: name,
      location,
      description,
      optional: optional || emitsNullHelper,
      definition: {
        ...definition,
        ...(!optional && emitsNullHelper ? { requiredScopes: ["mcp", "sdk"] as const } : {})
      }
    } satisfies GeneratedParam
  ];
  const preflightBlocks: GeneratedPreflightBlock[] = [];
  const helperBaseName = normalizeParamName(name);
  const resolvedName = `resolved${toPascalCase(helperBaseName)}`;

  if (emitsNullHelper) {
    params.push({
      paramName: `${helperBaseName}Null`,
      sourceName: name,
      location: "transport",
      description: `Send null for ${name}.`,
      optional: true,
      scope: ["cli"],
      definition: { kind: "boolean" }
    });
    preflightBlocks.push({
      kind: "scalar-null",
      paramName,
      nullParamName: `${helperBaseName}Null`,
      resolvedName,
      required: !optional
    });
  }

  return {
    params,
    preflightBlocks,
    requestField: {
      location,
      wireName: name,
      value: emitsNullHelper
        ? { kind: "reference", reference: { kind: "resolved", resolvedName } }
        : { kind: "reference", reference: { kind: "param", paramName } },
      omitWhenUndefinedReference: emitsNullHelper
        ? { kind: "resolved", resolvedName }
        : { kind: "param", paramName }
    }
  };
}

function getFieldSchemaKind(schema: OpenApiSchemaObject): FieldSchemaKind {
  return schema.type === "array" ? "array" : schema.type === "object" ? "object" : "scalar";
}

function createPathScalarOnlyError(name: string, operationId: string): never {
  throw new UserError(
    `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(name)} must use a scalar schema (string, number, integer, or boolean).`
  );
}

function createUnsupportedNestedBodyFieldError(name: string, operationId: string): never {
  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported request body field ${JSON.stringify(name)}. Nested object body fields are not supported in v1.`
  );
}

function createArrayParam(options: CreateArrayParamOptions): GeneratedParameterAssembly {
  const { document, name, description, schema, optional, operationId, context, location } = options;
  const paramName = name;
  const helperBaseName = normalizeParamName(name);
  const directDefinition = createParamDefinition(
    document,
    location === "query" ? stripNullable(schema) : schema,
    operationId,
    context
  );
  const jsonParamName = `${helperBaseName}Json`;
  const nullParamName = `${helperBaseName}Null`;
  const resolvedName = `resolved${toPascalCase(helperBaseName)}`;
  const reference = { kind: "resolved", resolvedName } as const;
  const emitsNullHelper = supportsNullHelper(location, "array", directDefinition.nullable);
  const directParamOptional = true;
  const params: GeneratedParam[] = [
    {
      paramName,
      sourceName: name,
      location,
      description,
      optional: directParamOptional,
      definition: {
        ...directDefinition,
        ...(optional ? {} : { requiredScopes: ["mcp", "sdk"] as const })
      }
    } satisfies GeneratedParam,
    {
      paramName: jsonParamName,
      sourceName: name,
      location: "transport",
      description: `JSON-encoded value for ${name}.`,
      optional: true,
      scope: ["cli"],
      definition: { kind: "string" }
    } satisfies GeneratedParam
  ];

  if (emitsNullHelper) {
    params.push({
      paramName: nullParamName,
      sourceName: name,
      location: "transport",
      description: `Send null for ${name}.`,
      optional: true,
      scope: ["cli"],
      definition: { kind: "boolean" }
    });
  }

  return {
    params,
    preflightBlocks: [
      {
        kind: "array",
        paramName,
        jsonParamName,
        ...(emitsNullHelper ? { nullParamName } : {}),
        resolvedName,
        required: !optional
      }
    ],
    requestField: {
      location,
      wireName: name,
      value: ARRAY_VALUE_EXPRESSIONS[location](reference, options.querySerialization),
      omitWhenUndefinedReference: reference
    }
  };
}

const ARRAY_VALUE_EXPRESSIONS = {
  body: (reference: GeneratedValueReference) => ({ kind: "reference", reference }),
  query: (
    reference: GeneratedValueReference,
    querySerialization: QueryArraySerialization | undefined
  ) => ({
    kind: "queryArray",
    reference,
    serialization: expectQueryArraySerialization(querySerialization)
  })
} as const satisfies Record<
  CreateArrayParamOptions["location"],
  (
    reference: GeneratedValueReference,
    querySerialization?: QueryArraySerialization
  ) => GeneratedValueExpression
>;

const FIELD_ASSEMBLERS = {
  body: {
    array: (options: CreateFieldOptions) =>
      createArrayParam({
        ...options,
        location: "body"
      }),
    object: (options: CreateFieldOptions) =>
      createUnsupportedNestedBodyFieldError(options.name, options.operationId),
    scalar: (options: CreateFieldOptions) =>
      createScalarParam({
        ...options,
        location: "body"
      })
  },
  path: {
    array: (options: CreateFieldOptions) =>
      createPathScalarOnlyError(options.name, options.operationId),
    object: (options: CreateFieldOptions) =>
      createPathScalarOnlyError(options.name, options.operationId),
    scalar: (options: CreateFieldOptions) =>
      createScalarParam({
        ...options,
        location: "path"
      })
  },
  query: {
    array: (options: CreateFieldOptions) =>
      createArrayParam({
        ...options,
        location: "query"
      }),
    object: (options: CreateFieldOptions) =>
      createScalarParam({
        ...options,
        location: "query"
      }),
    scalar: (options: CreateFieldOptions) =>
      createScalarParam({
        ...options,
        location: "query"
      })
  }
} as const satisfies Record<
  GeneratedRequestLocation,
  Record<FieldSchemaKind, (options: CreateFieldOptions) => GeneratedParameterAssembly>
>;

function expectQueryArraySerialization(
  querySerialization: QueryArraySerialization | undefined
): QueryArraySerialization {
  if (querySerialization === undefined) {
    throw new Error("Missing query array serialization for generated query array field.");
  }

  return querySerialization;
}

function supportsNullHelper(
  location: GeneratedRequestLocation,
  shape: NullHelperShape,
  nullable: boolean | undefined
): boolean {
  return nullable === true && NULL_HELPER_SUPPORT[location][shape];
}

function createCollectedRequestBodyParams(
  assemblies: ReadonlyArray<GeneratedParameterAssembly>,
  bodyOptional: boolean,
  requestBodyDescription: string | undefined,
  bodyRender: GeneratedRequestSectionRenders["body"],
  paramsSchemaOptions: GeneratedObjectSchemaOptions | undefined
): CollectedCommandParams {
  return {
    params: assemblies.flatMap((assembly) => assembly.params),
    paramsSchemaOptions,
    preflightBlocks: assemblies.flatMap((assembly) => assembly.preflightBlocks),
    requestFields: assemblies.map((assembly) => assembly.requestField),
    sectionRenders: { body: bodyRender },
    optionalSections: bodyOptional
      ? new Set<Exclude<GeneratedParam["location"], "transport">>(["body"])
      : new Set(),
    requestBodyDescription
  };
}

function createParamDefinition(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): GeneratedParamDefinition {
  if (schema.type === "array") {
    const itemSchema = expectArrayItemsSchema(document, schema, operationId, context);

    return {
      kind: "array",
      itemDefinition: createParamDefinition(document, itemSchema, operationId, `${context} items`),
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
      ...(schema.minItems === undefined ? {} : { minItems: schema.minItems }),
      ...(schema.maxItems === undefined ? {} : { maxItems: schema.maxItems }),
      ...(schema.nullable === true ? { nullable: true } : {})
    };
  }

  const scalarDefinition =
    schema.type === undefined || !(schema.type in SCHEMA_TYPE_TO_KIND)
      ? undefined
      : SCHEMA_TYPE_TO_KIND[schema.type as OpenApiScalarType];
  const enumValues = normalizeEnumValues(
    schema.enum,
    operationId,
    context,
    schema.nullable === true,
    schema.type
  );

  if (enumValues !== undefined) {
    return {
      kind: "enum",
      enumValues,
      ...(scalarDefinition?.jsonType === undefined ? {} : { jsonType: scalarDefinition.jsonType }),
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
      ...(schema.nullable === true || schema.enum?.includes(null) === true
        ? { nullable: true }
        : {})
    };
  }

  if (scalarDefinition !== undefined) {
    return {
      kind: scalarDefinition.kind,
      ...(scalarDefinition.jsonType === undefined ? {} : { jsonType: scalarDefinition.jsonType }),
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
      ...(schema.minimum === undefined ? {} : { minimum: schema.minimum }),
      ...(schema.maximum === undefined ? {} : { maximum: schema.maximum }),
      ...(schema.minLength === undefined ? {} : { minLength: schema.minLength }),
      ...(schema.maxLength === undefined ? {} : { maxLength: schema.maxLength }),
      ...(schema.pattern === undefined ? {} : { pattern: schema.pattern }),
      ...(schema.format === undefined ? {} : { format: schema.format }),
      ...(schema.nullable === true ? { nullable: true } : {})
    };
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Supported shapes in this milestone are string, number, integer, boolean, enum, and arrays of those values.`
  );
}

function assertPathTemplateParameters(
  path: string,
  parameters: ReadonlyMap<string, OpenApiParameterObject>,
  operationId: string
): void {
  const placeholders = new Set(collectPathPlaceholders(path));

  for (const placeholder of placeholders) {
    if (!parameters.has(`path:${placeholder}`)) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} path ${JSON.stringify(path)} references ${JSON.stringify(`{${placeholder}}`)} but does not define a matching path parameter.`
      );
    }
  }

  for (const parameter of parameters.values()) {
    if (parameter.in !== "path") {
      continue;
    }

    if (!placeholders.has(parameter.name)) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} path ${JSON.stringify(path)} declares path parameter ${JSON.stringify(parameter.name)} but the path template does not include ${JSON.stringify(`{${parameter.name}}`)}.`
      );
    }
  }
}

function collectPathPlaceholders(path: string): string[] {
  const placeholders: string[] = [];
  let searchFrom = 0;

  while (searchFrom < path.length) {
    const start = path.indexOf("{", searchFrom);
    if (start === -1) {
      break;
    }

    const end = path.indexOf("}", start + 1);
    if (end === -1) {
      break;
    }

    placeholders.push(path.slice(start + 1, end));
    searchFrom = end + 1;
  }

  return placeholders;
}

function isSuccessStatusCode(statusCode: string): boolean {
  if (statusCode === "default" || statusCode === "2XX") {
    return true;
  }

  return (
    statusCode.length === 3 &&
    statusCode[0] === "2" &&
    isAsciiDigit(statusCode[1]) &&
    isAsciiDigit(statusCode[2])
  );
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isJsonMediaType(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return normalized.includes("application/json") || normalized.includes("+json");
}

function normalizeEnumValues(
  enumValues: unknown[] | undefined,
  operationId: string,
  context: string,
  nullable: boolean,
  schemaType: OpenApiSchemaObject["type"]
): readonly [GeneratedEnumValue, ...GeneratedEnumValue[]] | undefined {
  if (enumValues === undefined) {
    return undefined;
  }

  const filteredValues = enumValues.filter((value) => value !== null);

  if (enumValues.includes(null) && nullable !== true) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Enums may include null only when the schema is marked nullable.`
    );
  }

  if (filteredValues.length === 0) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Enum values cannot be empty.`
    );
  }

  if (filteredValues.some((value) => !isEnumPrimitiveValue(value))) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. OpenAPI enums must contain only string, number, boolean, or null values.`
    );
  }

  const primitiveTypes = new Set(filteredValues.map((value) => typeof value));

  if (primitiveTypes.size > 1) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Enums must not mix primitive types.`
    );
  }

  if (schemaType !== undefined) {
    const matchesSchemaType = filteredValues.every((value) => {
      if (schemaType === "integer") {
        return typeof value === "number" && Number.isInteger(value);
      }

      if (schemaType === "number") {
        return typeof value === "number";
      }

      if (schemaType === "string" || schemaType === "boolean") {
        return typeof value === schemaType;
      }

      return true;
    });

    if (!matchesSchemaType) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Enum values must match declared schema.type ${JSON.stringify(schemaType)}.`
      );
    }
  }

  return filteredValues.filter(isEnumPrimitiveValue) as unknown as readonly [
    GeneratedEnumValue,
    ...GeneratedEnumValue[]
  ];
}

function resolveLocalReference(
  document: OpenApiDocument,
  ref: string,
  operationId: string,
  context: string
): unknown {
  if (!ref.startsWith("#/")) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported external $ref ${JSON.stringify(ref)} in ${context}.`
    );
  }

  let current: unknown = document;

  for (const segment of ref.slice(2).split("/").map(unescapeJsonPointerSegment)) {
    if (typeof current !== "object" || current === null || !(segment in current)) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} references missing $ref ${JSON.stringify(ref)} in ${context}.`
      );
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function unescapeJsonPointerSegment(segment: string): string {
  return segment.replaceAll("~1", "/").replaceAll("~0", "~");
}

function expectParameter(
  document: OpenApiDocument,
  parameter: OpenApiParameter,
  operationId: string,
  refChain: readonly string[] = []
): SupportedOpenApiParameterObject {
  if (isReferenceObject(parameter)) {
    assertAcyclicRef(parameter.$ref, refChain, operationId, "parameter");
    return expectParameter(
      document,
      resolveLocalReference(document, parameter.$ref, operationId, "parameter") as OpenApiParameter,
      operationId,
      [...refChain, parameter.$ref]
    );
  }

  if (parameter.content !== undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} parameter ${JSON.stringify(parameter.name)} uses unsupported parameter.content. Define path/query parameters with parameter.schema in v1.`
    );
  }

  if (parameter.in !== "path" && parameter.in !== "query") {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported parameter location ${JSON.stringify(parameter.in)}. Only path and query parameters are supported in v1; use auth or handwritten commands for headers/cookies.`
    );
  }

  return parameter as SupportedOpenApiParameterObject;
}

function expectOperation(
  document: OpenApiDocument,
  operation: OpenApiOperation,
  method: HttpMethod,
  path: string,
  refChain: readonly string[] = []
): OpenApiOperationObject {
  if (!isReferenceObject(operation)) {
    return operation;
  }

  const operationId = `${method.toUpperCase()} ${path}`;
  const context = `operation ${method.toUpperCase()} ${path}`;
  assertAcyclicRef(operation.$ref, refChain, operationId, context);

  return expectOperation(
    document,
    resolveLocalReference(document, operation.$ref, operationId, context) as OpenApiOperation,
    method,
    path,
    [...refChain, operation.$ref]
  );
}

function isEnumPrimitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function expectRequestBody(
  document: OpenApiDocument,
  requestBody: OpenApiRequestBodyObject | OpenApiReferenceObject,
  operationId: string,
  context: string,
  refChain: readonly string[] = []
): OpenApiRequestBodyObject {
  if (!isReferenceObject(requestBody)) {
    return requestBody;
  }

  assertAcyclicRef(requestBody.$ref, refChain, operationId, context);
  return expectRequestBody(
    document,
    resolveLocalReference(document, requestBody.$ref, operationId, context) as
      | OpenApiRequestBodyObject
      | OpenApiReferenceObject,
    operationId,
    context,
    [...refChain, requestBody.$ref]
  );
}

function expectResponse(
  document: OpenApiDocument,
  response: OpenApiResponseObject | OpenApiReferenceObject,
  operationId: string,
  statusCode: string,
  refChain: readonly string[] = []
): OpenApiResponseObject {
  if (!isReferenceObject(response)) {
    return response;
  }

  const context = `success response for status ${JSON.stringify(statusCode)}`;
  assertAcyclicRef(response.$ref, refChain, operationId, context);
  return expectResponse(
    document,
    resolveLocalReference(document, response.$ref, operationId, context) as
      | OpenApiResponseObject
      | OpenApiReferenceObject,
    operationId,
    statusCode,
    [...refChain, response.$ref]
  );
}

function expectSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined,
  operationId: string,
  context: string,
  refChain: readonly string[] = []
): OpenApiSchemaObject {
  const resolvedSchema = resolveSchema(document, schema, operationId, context, refChain);
  const compositionKeyword = getCompositionKeyword(resolvedSchema);

  if (compositionKeyword !== undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. JSON Schema composition keyword ${JSON.stringify(compositionKeyword)} is not supported in v1.`
    );
  }

  return resolvedSchema;
}

function resolveSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined,
  operationId: string,
  context: string,
  refChain: readonly string[] = []
): OpenApiSchemaObject {
  if (schema === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} is missing a schema for ${context}.`
    );
  }

  if (isReferenceObject(schema)) {
    assertAcyclicRef(schema.$ref, refChain, operationId, context);
    return resolveSchema(
      document,
      resolveLocalReference(document, schema.$ref, operationId, context) as
        | OpenApiSchemaObject
        | OpenApiReferenceObject,
      operationId,
      context,
      [...refChain, schema.$ref]
    );
  }

  return schema;
}

function getCompositionKeyword(
  schema: OpenApiSchemaObject
): "allOf" | "anyOf" | "oneOf" | undefined {
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    if (schema[keyword] !== undefined) {
      return keyword;
    }
  }

  return undefined;
}

function resolveNullableAnyOfSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): OpenApiSchemaObject | undefined {
  const variants = schema.anyOf;

  if (variants === undefined || variants.length !== 2) {
    return undefined;
  }

  const resolvedVariants = variants.map((variant, index) =>
    resolveSchema(document, variant, operationId, `${context} anyOf variant ${index}`)
  );
  const nullVariantIndex = resolvedVariants.findIndex(isExplicitNullSchema);

  if (nullVariantIndex === -1) {
    return undefined;
  }

  const nonNullVariant = resolvedVariants[Number(!nullVariantIndex)];

  if (nonNullVariant === undefined || getCompositionKeyword(nonNullVariant) !== undefined) {
    return undefined;
  }

  return {
    ...nonNullVariant,
    nullable: true
  };
}

function isExplicitNullSchema(schema: OpenApiSchemaObject): boolean {
  return (schema as { type?: unknown }).type === "null";
}

function assertAcyclicRef(
  ref: string,
  refChain: readonly string[],
  operationId: string,
  context: string
): void {
  if (!refChain.includes(ref)) {
    return;
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses circular $ref chain in ${context}: ${[
      ...refChain,
      ref
    ]
      .map((value) => JSON.stringify(value))
      .join(" -> ")}.`
  );
}

function expectArrayItemsSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): OpenApiSchemaObject {
  if (schema.items === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} is missing array items for ${context}.`
    );
  }

  return expectSchema(document, schema.items, operationId, `${context} items`);
}

function assertUniqueCommandPaths(commands: GeneratedCommand[]): void {
  const seen = new Map<string, GeneratedCommand>();

  for (const command of commands) {
    const key = `${command.noun} ${command.verb}`;
    const existing = seen.get(key);

    if (existing !== undefined) {
      throw new UserError(
        `Generated command path ${JSON.stringify(key)} is defined more than once (${JSON.stringify(existing.operationId)} and ${JSON.stringify(command.operationId)}).`
      );
    }

    seen.set(key, command);
  }
}

function createCommandFile(options: {
  specSha: string;
  operationId: string;
  noun: string;
  verb: string;
  exportName: string;
  description?: string;
  method: string;
  path: string;
  auth: "required" | "none";
  params: GeneratedParam[];
  paramsSchemaOptions?: GeneratedObjectSchemaOptions;
  preflightBlocks: GeneratedPreflightBlock[];
  requestFields: GeneratedRequestField[];
  sectionRenders: GeneratedRequestSectionRenders;
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
  confirm: boolean;
}): string {
  const requiresUserError = options.preflightBlocks.length > 0;
  const lines = createGeneratedTypeScriptFileLines([
    `spec-sha: ${options.specSha}`,
    `operation-id: ${options.operationId}`
  ]);
  lines.push(
    requiresUserError
      ? 'import { S, UserError } from "toolcraft";'
      : 'import { S } from "toolcraft";',
    'import { requestJson, defineApiCommand } from "toolcraft-openapi";',
    "",
    `export const ${options.exportName} = defineApiCommand({`,
    `  name: ${JSON.stringify(options.verb)},`
  );

  if (options.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(options.description)},`);
  }

  lines.push('  scope: ["cli", "mcp", "sdk"] as const,');
  if (options.confirm) {
    lines.push("  confirm: true,");
  }
  lines.push("  params: S.Object({");
  lines.push(...renderParamLines(options.params));
  lines.push(
    options.paramsSchemaOptions?.additionalProperties === false
      ? "  }, { additionalProperties: false }),"
      : "  }),"
  );
  lines.push("  handler: async ({ params, baseUrl, tokenSource, fetch }) => {");
  lines.push(...options.preflightBlocks.flatMap((block) => renderPreflightBlock(block)));
  lines.push("    return requestJson({");
  lines.push("      baseUrl,");
  lines.push(`      path: ${JSON.stringify(options.path)},`);
  lines.push(`      method: ${JSON.stringify(options.method)},`);
  lines.push(`      auth: ${JSON.stringify(options.auth)},`);
  lines.push("      tokenSource,");
  lines.push("      fetch,");
  lines.push("      dryRun: params.dryRun,");
  lines.push("      verbose: params.verbose,");
  lines.push(
    ...renderRequestShape(options.requestFields, options.sectionRenders, options.optionalSections)
  );
  lines.push("    });");
  lines.push("  },");
  lines.push("});");
  lines.push("");

  return lines.join("\n");
}

function mergeCommandDescriptions(
  operationDescription: string | undefined,
  requestBodyDescription: string | undefined
): string | undefined {
  const operationText =
    operationDescription === undefined || operationDescription.length === 0
      ? undefined
      : operationDescription;
  const requestBodyText =
    requestBodyDescription === undefined || requestBodyDescription.length === 0
      ? undefined
      : requestBodyDescription;

  if (
    operationText === undefined ||
    requestBodyText === undefined ||
    operationText === requestBodyText
  ) {
    return operationText ?? requestBodyText;
  }

  return `${operationText}\n\nRequest body: ${requestBodyText}`;
}

function getOperationAuthMode(
  document: OpenApiDocument,
  operation: OpenApiOperationObject,
  operationId: string
): "required" | "none" {
  const security = operation.security ?? document.security;
  const securityScope = operation.security === undefined ? "document" : "operation";
  const definedSchemes = document.components?.securitySchemes;

  for (const requirement of security ?? []) {
    for (const schemeName of Object.keys(requirement)) {
      if (definedSchemes !== undefined && schemeName in definedSchemes) {
        continue;
      }

      throw new UserError(
        `Operation ${JSON.stringify(operationId)} references undefined security scheme ${JSON.stringify(schemeName)} in ${securityScope} security. Expected components.securitySchemes to define it.`
      );
    }
  }

  return security === undefined || security.length === 0 ? "none" : "required";
}

function assertSupportedHttpMethods(path: string, pathItem: OpenApiPathItemObject): void {
  const rawPathItem = pathItem as Record<string, unknown>;

  for (const method of UNSUPPORTED_HTTP_METHODS) {
    const operation = rawPathItem[method];

    if (operation === undefined) {
      continue;
    }

    throw new UserError(
      `Operation ${JSON.stringify(getOperationId(path, method, operation))} uses unsupported HTTP method ${JSON.stringify(method.toUpperCase())}. Supported in v1: GET, POST, PUT, PATCH, DELETE.`
    );
  }
}

function getOperationId(path: string, method: string, operation: unknown): string {
  if (
    operation !== null &&
    typeof operation === "object" &&
    "operationId" in operation &&
    typeof operation.operationId === "string" &&
    operation.operationId.length > 0
  ) {
    return operation.operationId;
  }

  return `${method.toUpperCase()} ${path}`;
}

function stripNullable(schema: OpenApiSchemaObject): OpenApiSchemaObject {
  if (schema.nullable !== true) {
    return schema;
  }

  return { ...schema, nullable: undefined };
}

function renderParamLines(params: GeneratedParam[]): string[] {
  return params.map(
    (param) => `    ${renderObjectKey(param.paramName)}: ${renderParamSchema(param)},`
  );
}

function renderParamSchema(param: GeneratedParam): string {
  const schema = renderDefinition(
    param.definition,
    param.description,
    param.shortFlag,
    param.scope
  );
  return param.optional ? `S.Optional(${schema})` : schema;
}

function renderDefinition(
  definition: GeneratedParamDefinition,
  description?: string,
  shortFlag?: string,
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]]
): string {
  const options = renderSchemaOptions({
    definition,
    description,
    shortFlag,
    scope
  });
  const renderer = DEFINITION_RENDERERS[definition.kind] as (
    definition: GeneratedParamDefinition,
    options?: string
  ) => string;
  return renderer(definition, options);
}

const DEFINITION_RENDERERS = {
  array: (definition: GeneratedArrayParamDefinition, options?: string) =>
    renderSchemaCall(
      "S.Array",
      renderDefinition(definition.itemDefinition, undefined, undefined, undefined),
      options
    ),
  boolean: (_definition: GeneratedScalarParamDefinition, options?: string) =>
    renderSchemaCall("S.Boolean", options),
  enum: (definition: GeneratedEnumParamDefinition, options?: string) =>
    renderSchemaCall("S.Enum", renderConstArray(definition.enumValues), options),
  number: (_definition: GeneratedScalarParamDefinition, options?: string) =>
    renderSchemaCall("S.Number", options),
  string: (_definition: GeneratedScalarParamDefinition, options?: string) =>
    renderSchemaCall("S.String", options)
} as const satisfies {
  [K in GeneratedParamDefinition["kind"]]: (
    definition: Extract<GeneratedParamDefinition, { kind: K }>,
    options?: string
  ) => string;
};

function renderSchemaCall(builder: string, ...args: Array<string | undefined>): string {
  return `${builder}(${args.filter((arg): arg is string => arg !== undefined).join(", ")})`;
}

function renderSchemaOptions(param: RenderSchemaOptionsInput): string | undefined {
  const entries = collectSchemaOptionEntries(param).map(
    ({ key, value }) => `${key}: ${renderSchemaOptionValue(value)}`
  );
  return entries.length === 0 ? undefined : `{ ${entries.join(", ")} }`;
}

function renderConstArray(values: ReadonlyArray<string | number | boolean>): string {
  return `${JSON.stringify(values)} as const`;
}

function renderObjectKey(name: string): string {
  if (name === normalizeParamName(name) && isIdentifierName(name)) {
    return name;
  }

  return JSON.stringify(name);
}

function assertValidGeneratedNoun(operationId: string, noun: string): void {
  const identifier = toCamelCase(noun);

  if (isTypeScriptIdentifier(identifier)) {
    return;
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} derives command noun ${JSON.stringify(noun)}, which maps to invalid TypeScript identifier ${JSON.stringify(identifier)}.`
  );
}

export function collectSchemaOptionEntries(param: RenderSchemaOptionsInput): SchemaOptionEntry[] {
  return SCHEMA_OPTION_SOURCES.flatMap(({ key, get }) => {
    const value = get(param);
    return value === undefined ? [] : [{ key, value }];
  });
}

function renderSchemaOptionValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => renderSchemaOptionValue(entry)).join(", ")}]`;
  }

  return JSON.stringify(value);
}

const RESERVED_TYPESCRIPT_IDENTIFIERS = new Set<string>([
  "abstract",
  "any",
  "as",
  "asserts",
  "async",
  "await",
  "bigint",
  "boolean",
  "break",
  "case",
  "catch",
  "class",
  "const",
  "continue",
  "debugger",
  "declare",
  "default",
  "delete",
  "do",
  "else",
  "enum",
  "export",
  "extends",
  "false",
  "finally",
  "for",
  "function",
  "get",
  "if",
  "implements",
  "import",
  "in",
  "infer",
  "instanceof",
  "interface",
  "is",
  "keyof",
  "let",
  "module",
  "namespace",
  "never",
  "new",
  "null",
  "number",
  "object",
  "package",
  "private",
  "protected",
  "public",
  "readonly",
  "return",
  "satisfies",
  "set",
  "static",
  "string",
  "super",
  "switch",
  "symbol",
  "this",
  "throw",
  "true",
  "try",
  "type",
  "typeof",
  "undefined",
  "unique",
  "unknown",
  "var",
  "void",
  "while",
  "with",
  "yield"
] as const);

function isTypeScriptIdentifier(value: string): boolean {
  return isIdentifierName(value) && !RESERVED_TYPESCRIPT_IDENTIFIERS.has(value);
}

function resolveQueryArraySerialization(
  parameter: SupportedOpenApiParameterObject,
  operationId: string
): QueryArraySerialization {
  const style = parameter.style ?? "form";
  const explode = parameter.explode ?? style === "form";

  if (style === "form") {
    return explode ? "repeat" : "comma";
  }

  if (style === "pipeDelimited" && explode === false) {
    return "pipe";
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported query-array serialization for parameter ${JSON.stringify(parameter.name)}. Supported in v1: form (explode true/false) and pipeDelimited.`
  );
}

function createIndexFile(commands: GeneratedCommand[]): GeneratedFile {
  const groups = groupByNoun(commands);

  if (groups.length === 0) {
    return {
      path: "index.ts",
      contents: createGeneratedTypeScriptFile(["export {};", ""])
    };
  }

  const lines = createGeneratedTypeScriptFileLines();
  lines.push('import { defineGroup } from "toolcraft";');

  for (const { commands: nounCommands } of groups) {
    for (const command of nounCommands) {
      lines.push(
        `import { ${command.exportName} } from ${JSON.stringify(`./${command.filePath.replace(/\.ts$/, ".js")}`)};`
      );
    }
  }

  if (lines.length > 1) {
    lines.push("");
  }

  for (const { noun, commands: nounCommands } of groups) {
    lines.push(`export const ${toCamelCase(noun)} = defineGroup({`);
    lines.push(`  name: ${JSON.stringify(noun)},`);
    lines.push(`  children: [${nounCommands.map((command) => command.exportName).join(", ")}],`);
    lines.push("});");
    lines.push("");
  }

  return {
    path: "index.ts",
    contents: lines.join("\n")
  };
}

function createGeneratedTypeScriptFile(bodyLines: string[], metadataLines: string[] = []): string {
  return [...createGeneratedTypeScriptFileLines(metadataLines), ...bodyLines].join("\n");
}

function createGeneratedTypeScriptFileLines(metadataLines: string[] = []): string[] {
  return [
    "/**",
    " * Generated by toolcraft-openapi.",
    ...metadataLines.map((line) => ` * ${line}`),
    " */"
  ];
}

function compareGeneratedCommandPaths(left: GeneratedCommand, right: GeneratedCommand): number {
  const nounCompare = left.noun.localeCompare(right.noun);
  if (nounCompare !== 0) {
    return nounCompare;
  }

  return left.verb.localeCompare(right.verb);
}

function isReferenceObject(value: unknown): value is OpenApiReferenceObject {
  return typeof value === "object" && value !== null && "$ref" in value;
}
