import { UserError } from "@poe-code/cmdkit";
import {
  METHOD_DEFAULTS,
  deriveNoun,
  deriveVerb,
  normalizeParamName,
  toCamelCase,
  toPascalCase,
  type HttpMethod
} from "./naming.js";

const HTTP_METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;
const METHODS_WITHOUT_REQUEST_BODY = new Set<HttpMethod>(["get"]);
type OpenApiOperationMap = Partial<Record<HttpMethod, OpenApiOperationObject>>;
type OpenApiParameterLocation = "path" | "query" | "header" | "cookie";
type SupportedOpenApiParameterLocation = "path" | "query";
type ParamKind = "string" | "number" | "boolean" | "enum" | "array";
type OpenApiScalarType = "string" | "number" | "integer" | "boolean";

const SCHEMA_TYPE_TO_KIND: Record<
  OpenApiScalarType,
  { kind: Exclude<ParamKind, "enum">; jsonType?: "integer" }
> = {
  boolean: { kind: "boolean" },
  integer: { kind: "number", jsonType: "integer" },
  number: { kind: "number" },
  string: { kind: "string" }
};

const REQUEST_PARAM_SECTIONS = [
  { location: "path", key: "pathParams", omittable: false },
  { location: "query", key: "query", omittable: false },
  { location: "body", key: "body", omittable: true }
] as const satisfies ReadonlyArray<{
  location: Exclude<GeneratedParam["location"], "transport">;
  key: "pathParams" | "query" | "body";
  omittable: boolean;
}>;

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
  paths?: Record<string, OpenApiPathItemObject | undefined>;
  components?: {
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

type OpenApiSecurityRequirementObject = Record<string, string[]>;

export interface GenerateOptions {
  specSha: string;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

interface GeneratedCommand {
  noun: string;
  verb: string;
  exportName: string;
  filePath: string;
  contents: string;
  operationId: string;
}

interface GeneratedParam {
  paramName: string;
  sourceName: string;
  location: "path" | "query" | "body" | "transport";
  description?: string;
  shortFlag?: string;
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]];
  optional: boolean;
  definition: GeneratedParamDefinition;
}

interface GeneratedParamDefinition {
  kind: ParamKind;
  defaultValue?: unknown;
  enumValues?: ReadonlyArray<string | number | boolean>;
  format?: string;
  itemDefinition?: GeneratedParamDefinition;
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

type GeneratedParamScope = "cli" | "mcp" | "sdk";

interface GeneratedRequestField {
  location: Exclude<GeneratedParam["location"], "transport">;
  omitWhenUndefinedExpression: string;
  render: "inline" | "wrapped";
  wireName: string;
  valueExpression: string;
}

interface CollectedCommandParams {
  params: GeneratedParam[];
  preflightBlocks: GeneratedPreflightBlock[];
  requestFields: GeneratedRequestField[];
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
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

type GeneratedCommandImport = "UserError";

interface GeneratedPreflightBlock {
  code: string[];
  imports?: readonly GeneratedCommandImport[];
}

interface CreateArrayParamOptions {
  document: OpenApiDocument;
  name: string;
  description?: string;
  schema: OpenApiSchemaObject;
  optional: boolean;
  operationId: string;
  context: string;
  location: "query" | "body";
  render: GeneratedRequestField["render"];
  querySerialization?: QueryArraySerialization;
  supportsNullFlag: boolean;
}

type QueryArraySerialization = "repeat" | "comma" | "pipe";

interface OperationEntry {
  method: HttpMethod;
  path: string;
  operation: OpenApiOperationObject;
  pathItem: OpenApiPathItemObject;
}

export function generate(document: OpenApiDocument, options: GenerateOptions): GeneratedFile[] {
  const paths = document.paths;

  if (paths === undefined) {
    throw new UserError('OpenAPI document must define a top-level "paths" object.');
  }

  const commands = collectOperations(paths).map((entry) =>
    createGeneratedCommand(document, entry, options.specSha)
  );

  assertUniqueCommandPaths(commands);

  return [
    ...commands
      .slice()
      .sort((left, right) => compareGeneratedCommandPaths(left, right))
      .map(({ filePath, contents }) => ({ path: filePath, contents })),
    createIndexFile(commands)
  ];
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
  entry: OperationEntry,
  specSha: string
): GeneratedCommand {
  const operationId = entry.operation.operationId ?? `${entry.method.toUpperCase()} ${entry.path}`;
  assertSupportedSuccessResponses(document, entry.operation, operationId);
  const noun = deriveNoun(entry.operation, operationId);
  const verb = deriveVerb(entry.method, entry.path, entry.operation, operationId, noun);
  const collected = collectParams(document, entry, operationId);
  const methodDefaults = METHOD_DEFAULTS[entry.method];
  const exportName = `${toCamelCase(noun)}${toPascalCase(verb)}Command`;
  const filePath = `${noun}/${verb}.ts`;

  return {
    noun,
    verb,
    exportName,
    filePath,
    operationId,
    contents: createCommandFile({
      specSha,
      operationId,
      noun,
      verb,
      exportName,
      description: mergeCommandDescriptions(
        entry.operation.summary ?? entry.operation.description,
        collected.requestBodyDescription
      ),
      method: entry.method.toUpperCase(),
      path: entry.path,
      auth: getOperationAuthMode(entry.operation),
      confirm: methodDefaults?.confirm === true,
      params: collected.params,
      preflightBlocks: collected.preflightBlocks,
      requestFields: collected.requestFields,
      optionalSections: collected.optionalSections
    })
  };
}

function collectParams(
  document: OpenApiDocument,
  entry: OperationEntry,
  operationId: string
): CollectedCommandParams {
  const operationParams = collectOperationParameters(
    document,
    entry.path,
    entry.pathItem.parameters ?? [],
    entry.operation.parameters ?? [],
    operationId
  );
  const requestBodyParams = collectRequestBodyParams(
    document,
    entry.operation,
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
    params: [...deduped.values()].sort((left, right) =>
      left.paramName.localeCompare(right.paramName)
    ),
    preflightBlocks: [...operationParams.preflightBlocks, ...requestBodyParams.preflightBlocks],
    requestFields: [...operationParams.requestFields, ...requestBodyParams.requestFields],
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
    preflightBlocks,
    requestFields,
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
      preflightBlocks: [],
      requestFields: [],
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
    ([mediaType, mediaTypeObject]) =>
      mediaTypeObject !== undefined && isJsonMediaType(mediaType)
  )?.[1];

  if (content === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define a JSON request body media type in v1.`
    );
  }

  const schema = expectSchema(document, content.schema, operationId, "requestBody");
  const bodyOptional = requestBody.required !== true;

  if (schema.type !== "object") {
    return createCollectedRequestBodyParams(
      [
        createBodyField(
          document,
          "body",
          schema.description === undefined && requestBody.description !== undefined
            ? { ...schema, description: requestBody.description }
            : schema,
          bodyOptional,
          operationId,
          "inline"
        )
      ],
      bodyOptional,
      requestBody.description
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

  return createCollectedRequestBodyParams(assemblies, bodyOptional, requestBody.description);
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

  if (parameter.in === "path" && parameter.required !== true) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(parameter.name)} must set required: true.`
    );
  }

  if (parameter.in === "path" && (schema.type === "array" || schema.type === "object")) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(parameter.name)} must use a scalar schema (string, number, integer, or boolean).`
    );
  }

  if (parameter.in === "query" && schema.type === "array") {
    return createArrayParam({
      document,
      name: parameter.name,
      description: parameter.description ?? schema.description,
      schema,
      optional: parameter.required !== true,
      operationId,
      context: `parameter ${JSON.stringify(parameter.name)}`,
      location: "query",
      render: "wrapped",
      querySerialization: resolveQueryArraySerialization(parameter, operationId),
      // Query null currently serializes as an empty string on the wire, so v1 does not
      // synthesize a CLI-only --<name>-null helper for query arrays.
      supportsNullFlag: false
    });
  }

  const paramName = parameter.name;
  return {
    params: [
      {
        paramName,
        sourceName: parameter.name,
        location: parameter.in,
        description: parameter.description ?? schema.description,
        optional: parameter.required !== true,
        definition: createParamDefinition(
          document,
          schema,
          operationId,
          `parameter ${JSON.stringify(parameter.name)}`
        )
      } satisfies GeneratedParam
    ],
    preflightBlocks: [],
    requestField: {
      location: parameter.in,
      render: "wrapped",
      wireName: parameter.name,
      valueExpression: renderParamAccess(paramName),
      omitWhenUndefinedExpression: `${renderParamAccess(paramName)} === undefined`
    }
  };
}

function createBodyField(
  document: OpenApiDocument,
  name: string,
  schema: OpenApiSchemaObject,
  optional: boolean,
  operationId: string,
  render: GeneratedRequestField["render"] = "wrapped"
): GeneratedParameterAssembly {
  if (schema.type === "object") {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported request body field ${JSON.stringify(name)}. Nested object body fields are not supported in v1.`
    );
  }

  if (schema.type === "array") {
    return createArrayParam({
      document,
      name,
      description: schema.description,
      schema,
      optional,
      operationId,
      context: `request body field ${JSON.stringify(name)}`,
      location: "body",
      render,
      querySerialization: undefined,
      supportsNullFlag: true
    });
  }

  const paramName = name;
  const helperBaseName = normalizeParamName(name);
  const definition = createParamDefinition(
    document,
    schema,
    operationId,
    `request body field ${JSON.stringify(name)}`
  );
  const params: GeneratedParam[] = [
    {
      paramName,
      sourceName: name,
      location: "body",
      description: schema.description,
      optional,
      definition
    } satisfies GeneratedParam
  ];
  const preflightBlocks: GeneratedPreflightBlock[] = [];
  const resolvedName = `resolved${toPascalCase(helperBaseName)}`;
  const paramAccess = renderParamAccess(paramName);

  if (definition.nullable === true) {
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
      imports: ["UserError"],
      code: [
        `    if (${paramAccess} !== undefined && ${paramAccess} !== null && params.${helperBaseName}Null) {`,
        `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(paramName)}" and "--${toCliFlag(`${helperBaseName}Null`)}" are mutually exclusive.`)});`,
        "    }",
        `    const ${resolvedName} = params.${helperBaseName}Null ? null : ${paramAccess};`
      ]
    });
  }

  return {
    params,
    preflightBlocks,
    requestField: {
      location: "body",
      render,
      wireName: name,
      valueExpression: definition.nullable === true ? resolvedName : paramAccess,
      omitWhenUndefinedExpression:
        definition.nullable === true
          ? `${resolvedName} === undefined`
          : `${paramAccess} === undefined`
    }
  };
}

function createArrayParam(options: CreateArrayParamOptions): GeneratedParameterAssembly {
  const {
    document,
    name,
    description,
    schema,
    optional,
    operationId,
    context,
    location,
    render,
    querySerialization,
    supportsNullFlag
  } = options;
  const paramName = name;
  const helperBaseName = normalizeParamName(name);
  const directDefinition = createParamDefinition(document, schema, operationId, context);
  const jsonParamName = `${helperBaseName}Json`;
  const nullParamName = `${helperBaseName}Null`;
  const resolvedName = `resolved${toPascalCase(helperBaseName)}`;
  const emitsNullHelper = supportsNullFlag && directDefinition.nullable === true;
  const paramAccess = renderParamAccess(paramName);
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

  const preflightCode = [
    ...(emitsNullHelper
      ? [
          `    if (params.${nullParamName} && (${paramAccess} !== undefined || params.${jsonParamName} !== undefined)) {`,
          `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(nullParamName)}", "--${toCliFlag(paramName)}", and "--${toCliFlag(jsonParamName)}" cannot be combined.`)});`,
          "    }"
        ]
      : []),
    `    if (${paramAccess} !== undefined && params.${jsonParamName} !== undefined) {`,
    `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(paramName)}" and "--${toCliFlag(jsonParamName)}" are mutually exclusive.`)});`,
    "    }",
    `    let ${resolvedName} = ${paramAccess};`,
    `    if (params.${jsonParamName} !== undefined) {`,
    "      let parsedJson: unknown;",
    "      try {",
    `        parsedJson = JSON.parse(params.${jsonParamName});`,
    "      } catch (error) {",
    `        throw new UserError(${JSON.stringify(`Invalid value for "--${toCliFlag(jsonParamName)}". Expected valid JSON.`)});`,
    "      }",
    "      if (!Array.isArray(parsedJson)) {",
    `        throw new UserError(${JSON.stringify(`Invalid value for "--${toCliFlag(jsonParamName)}". Expected a JSON array.`)});`,
    "      }",
    `      ${resolvedName} = parsedJson;`,
    "    }",
    ...(emitsNullHelper ? [`    if (params.${nullParamName}) {`, `      ${resolvedName} = null;`, "    }"] : [])
  ];

  if (!optional) {
    preflightCode.push(
      `    if (${resolvedName} === undefined) {`,
      `      throw new UserError(${JSON.stringify(`Missing required parameter "${toCliFlag(paramName)}".`)});`,
      "    }"
    );
  }

  return {
    params,
    preflightBlocks: [
      {
        imports: ["UserError"],
        code: preflightCode
      }
    ],
    requestField: {
      location,
      render,
      wireName: name,
      valueExpression:
        location === "query"
          ? renderQueryArrayValueExpression(resolvedName, querySerialization ?? "repeat")
          : resolvedName,
      omitWhenUndefinedExpression: `${resolvedName} === undefined`
    }
  };
}

function createCollectedRequestBodyParams(
  assemblies: ReadonlyArray<GeneratedParameterAssembly>,
  bodyOptional: boolean,
  requestBodyDescription: string | undefined
): CollectedCommandParams {
  return {
    params: assemblies.flatMap((assembly) => assembly.params),
    preflightBlocks: assemblies.flatMap((assembly) => assembly.preflightBlocks),
    requestFields: assemblies.map((assembly) => assembly.requestField),
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
  for (const placeholder of collectPathPlaceholders(path)) {
    if (!parameters.has(`path:${placeholder}`)) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} path ${JSON.stringify(path)} references ${JSON.stringify(`{${placeholder}}`)} but does not define a matching path parameter.`
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

function toCliFlag(name: string): string {
  return name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replaceAll("_", "-")
    .toLowerCase();
}

function isSuccessStatusCode(statusCode: string): boolean {
  if (statusCode.length !== 3) {
    return false;
  }

  return statusCode[0] === "2";
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
): ReadonlyArray<string | number | boolean> | undefined {
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

  return filteredValues.filter(isEnumPrimitiveValue);
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

  if (parameter.in !== "path" && parameter.in !== "query") {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported parameter location ${JSON.stringify(parameter.in)}. Only path and query parameters are supported in v1; use auth or handwritten commands for headers/cookies.`
    );
  }

  return parameter as SupportedOpenApiParameterObject;
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
  if (schema === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} is missing a schema for ${context}.`
    );
  }

  if (isReferenceObject(schema)) {
    assertAcyclicRef(schema.$ref, refChain, operationId, context);
    return expectSchema(
      document,
      resolveLocalReference(document, schema.$ref, operationId, context) as
        | OpenApiSchemaObject
        | OpenApiReferenceObject,
      operationId,
      context,
      [...refChain, schema.$ref]
    );
  }

  const compositionKeyword = getCompositionKeyword(schema);

  if (compositionKeyword !== undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. JSON Schema composition keyword ${JSON.stringify(compositionKeyword)} is not supported in v1.`
    );
  }

  return schema;
}

function getCompositionKeyword(schema: OpenApiSchemaObject): "allOf" | "anyOf" | "oneOf" | undefined {
  if (schema.allOf !== undefined) {
    return "allOf";
  }

  if (schema.anyOf !== undefined) {
    return "anyOf";
  }

  if (schema.oneOf !== undefined) {
    return "oneOf";
  }

  return undefined;
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
    `Operation ${JSON.stringify(operationId)} uses circular $ref chain in ${context}: ${[...refChain, ref]
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
  preflightBlocks: GeneratedPreflightBlock[];
  requestFields: GeneratedRequestField[];
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
  confirm: boolean;
}): string {
  const commandImports = new Set<GeneratedCommandImport>();

  for (const block of options.preflightBlocks) {
    for (const imported of block.imports ?? []) {
      commandImports.add(imported);
    }
  }

  const lines = [
    "/**",
    " * Generated by @poe-code/cmdkit-openapi.",
    ` * spec-sha: ${options.specSha}`,
    ` * operation-id: ${options.operationId}`,
    " */",
    commandImports.has("UserError")
      ? 'import { defineCommand, S, UserError } from "@poe-code/cmdkit";'
      : 'import { defineCommand, S } from "@poe-code/cmdkit";',
    'import { requestJson, type OpenApiClientServices } from "@poe-code/cmdkit-openapi";',
    "",
    `export const ${options.exportName} = defineCommand<OpenApiClientServices>({`,
    `  name: ${JSON.stringify(options.verb)},`
  ];

  if (options.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(options.description)},`);
  }

  lines.push('  scope: ["cli", "mcp", "sdk"] as const,');
  if (options.confirm) {
    lines.push("  confirm: true,");
  }
  lines.push("  params: S.Object({");
  lines.push(...renderParamLines(options.params));
  lines.push("  }),");
  lines.push("  handler: async ({ params, baseUrl, tokenSource, fetch }) => {");
  lines.push(...options.preflightBlocks.flatMap((block) => block.code));
  lines.push("    return requestJson({");
  lines.push("      baseUrl,");
  lines.push(`      path: ${JSON.stringify(options.path)},`);
  lines.push(`      method: ${JSON.stringify(options.method)},`);
  if (options.auth === "none") {
    lines.push('      auth: "none",');
  }
  lines.push("      tokenSource,");
  lines.push("      fetch,");
  lines.push("      dryRun: params.dryRun,");
  lines.push("      verbose: params.verbose,");
  lines.push(
    ...renderRequestShape(options.requestFields, options.optionalSections)
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
  if (requestBodyDescription === undefined || requestBodyDescription.length === 0) {
    return operationDescription;
  }

  if (operationDescription === undefined || operationDescription.length === 0) {
    return requestBodyDescription;
  }

  if (operationDescription === requestBodyDescription) {
    return operationDescription;
  }

  return `${operationDescription}\n\nRequest body: ${requestBodyDescription}`;
}

function getOperationAuthMode(operation: OpenApiOperationObject): "required" | "none" {
  return operation.security?.length === 0 ? "none" : "required";
}

function renderParamLines(params: GeneratedParam[]): string[] {
  return params.map((param) => `    ${renderObjectKey(param.paramName)}: ${renderParamSchema(param)},`);
}

function renderParamSchema(param: GeneratedParam): string {
  const schema = renderDefinition(param.definition, param.description, param.shortFlag, param.scope);
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

  if (definition.kind === "enum") {
    const enumValues = renderConstArray(definition.enumValues ?? []);
    return renderSchemaCall("S.Enum", enumValues, options);
  }

  if (definition.kind === "array") {
    const itemDefinition = renderDefinition(
      definition.itemDefinition ?? { kind: "string" },
      undefined,
      undefined,
      undefined
    );
    return renderSchemaCall("S.Array", itemDefinition, options);
  }

  const builderName = definition.kind[0].toUpperCase() + definition.kind.slice(1);
  return renderSchemaCall(`S.${builderName}`, options);
}

function renderSchemaCall(builder: string, ...args: Array<string | undefined>): string {
  return `${builder}(${args.filter((arg): arg is string => arg !== undefined).join(", ")})`;
}

function renderSchemaOptions(param: RenderSchemaOptionsInput): string | undefined {
  const entries: string[] = [];

  if (param.description !== undefined) {
    entries.push(`description: ${JSON.stringify(param.description)}`);
  }

  if (param.definition.defaultValue !== undefined) {
    entries.push(`default: ${JSON.stringify(param.definition.defaultValue)}`);
  }

  if (param.shortFlag !== undefined) {
    entries.push(`short: ${JSON.stringify(param.shortFlag)}`);
  }

  if (param.scope !== undefined) {
    entries.push(`scope: [${param.scope.map((scope) => JSON.stringify(scope)).join(", ")}]`);
  }

  if (param.definition.minimum !== undefined) {
    entries.push(`minimum: ${JSON.stringify(param.definition.minimum)}`);
  }

  if (param.definition.maximum !== undefined) {
    entries.push(`maximum: ${JSON.stringify(param.definition.maximum)}`);
  }

  if (param.definition.minLength !== undefined) {
    entries.push(`minLength: ${JSON.stringify(param.definition.minLength)}`);
  }

  if (param.definition.maxLength !== undefined) {
    entries.push(`maxLength: ${JSON.stringify(param.definition.maxLength)}`);
  }

  if (param.definition.minItems !== undefined) {
    entries.push(`minItems: ${JSON.stringify(param.definition.minItems)}`);
  }

  if (param.definition.maxItems !== undefined) {
    entries.push(`maxItems: ${JSON.stringify(param.definition.maxItems)}`);
  }

  if (param.definition.pattern !== undefined) {
    entries.push(`pattern: ${JSON.stringify(param.definition.pattern)}`);
  }

  if (param.definition.format !== undefined) {
    entries.push(`format: ${JSON.stringify(param.definition.format)}`);
  }

  if (param.definition.jsonType !== undefined) {
    entries.push(`jsonType: ${JSON.stringify(param.definition.jsonType)}`);
  }

  if (param.definition.nullable === true) {
    entries.push("nullable: true");
  }

  if (param.definition.requiredScopes !== undefined) {
    entries.push(`requiredScopes: [${param.definition.requiredScopes.map((scope) => JSON.stringify(scope)).join(", ")}]`);
  }

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

function renderParamAccess(name: string): string {
  return isIdentifierName(name) ? `params.${name}` : `params[${JSON.stringify(name)}]`;
}

function isIdentifierName(value: string): boolean {
  return /^[$A-Z_a-z][$\w]*$/u.test(value);
}

function resolveQueryArraySerialization(
  parameter: SupportedOpenApiParameterObject,
  operationId: string
): QueryArraySerialization {
  const style = parameter.style ?? "form";
  const explode = parameter.explode ?? (style === "form");

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

function renderQueryArrayValueExpression(
  resolvedName: string,
  serialization: QueryArraySerialization
): string {
  if (serialization === "repeat") {
    return resolvedName;
  }

  const separator = serialization === "comma" ? "," : "|";
  return `${resolvedName} === undefined || ${resolvedName} === null ? ${resolvedName} : ${resolvedName}.join(${JSON.stringify(separator)})`;
}

function renderRequestShape(
  requestFields: GeneratedRequestField[],
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>
): string[] {
  const lines: string[] = [];

  for (const section of REQUEST_PARAM_SECTIONS) {
    const sectionFields = requestFields.filter((param) => param.location === section.location);
    if (sectionFields.length === 0) {
      continue;
    }

    lines.push(
      ...REQUEST_FIELD_RENDERERS[sectionFields[0]?.render ?? "wrapped"](
        section,
        sectionFields,
        optionalSections.has(section.location)
      )
    );
  }

  return lines;
}

const REQUEST_FIELD_RENDERERS = {
  inline: (
    section: (typeof REQUEST_PARAM_SECTIONS)[number],
    sectionFields: GeneratedRequestField[],
    optional: boolean
  ): string[] => {
    const [field] = sectionFields;

    if (field === undefined) {
      return [];
    }

    if (!optional) {
      return [`      ${section.key}: ${field.valueExpression},`];
    }

    return [
      `      ...(${field.omitWhenUndefinedExpression}`,
      "        ? {}",
      "        : {",
      `            ${section.key}: ${field.valueExpression},`,
      "          }),"
    ];
  },
  wrapped: (
    section: (typeof REQUEST_PARAM_SECTIONS)[number],
    sectionFields: GeneratedRequestField[],
    optional: boolean
  ): string[] => {
    if (!optional) {
      return [
        `      ${section.key}: {`,
        ...sectionFields.map(
          (param) => `        ${JSON.stringify(param.wireName)}: ${param.valueExpression},`
        ),
        "      },"
      ];
    }

    return [
      `      ...(${sectionFields.map((param) => param.omitWhenUndefinedExpression).join(" && ")}`,
      "        ? {}",
      "        : {",
      `            ${section.key}: {`,
      ...sectionFields.map(
        (param) => `              ${JSON.stringify(param.wireName)}: ${param.valueExpression},`
      ),
      "            },",
      "          }),"
    ];
  }
} as const satisfies Record<
  GeneratedRequestField["render"],
  (
    section: (typeof REQUEST_PARAM_SECTIONS)[number],
    sectionFields: GeneratedRequestField[],
    optional: boolean
  ) => string[]
>;

function createIndexFile(commands: GeneratedCommand[]): GeneratedFile {
  const groups = new Map<string, GeneratedCommand[]>();

  for (const command of commands) {
    const current = groups.get(command.noun);

    if (current === undefined) {
      groups.set(command.noun, [command]);
      continue;
    }

    current.push(command);
  }

  const nouns = [...groups.keys()].sort((left, right) => left.localeCompare(right));
  const lines = ['import { defineGroup } from "@poe-code/cmdkit";'];

  for (const noun of nouns) {
    const nounCommands = groups
      .get(noun)
      ?.slice()
      .sort((left, right) => left.verb.localeCompare(right.verb));

    for (const command of nounCommands ?? []) {
      lines.push(
        `import { ${command.exportName} } from ${JSON.stringify(`./${command.filePath.replace(/\.ts$/, ".js")}`)};`
      );
    }
  }

  if (lines.length > 1) {
    lines.push("");
  }

  for (const noun of nouns) {
    const nounCommands = groups
      .get(noun)
      ?.slice()
      .sort((left, right) => left.verb.localeCompare(right.verb));

    lines.push(`export const ${toCamelCase(noun)} = defineGroup({`);
    lines.push(`  name: ${JSON.stringify(noun)},`);
    lines.push(
      `  children: [${(nounCommands ?? []).map((command) => command.exportName).join(", ")}],`
    );
    lines.push("});");
    lines.push("");
  }

  return {
    path: "index.ts",
    contents: lines.join("\n")
  };
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
