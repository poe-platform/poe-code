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
  schema?: OpenApiSchemaObject | OpenApiReferenceObject;
}

type SupportedOpenApiParameterObject = Omit<OpenApiParameterObject, "in"> & {
  in: SupportedOpenApiParameterLocation;
};

export interface OpenApiRequestBodyObject {
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
  pattern?: string;
  required?: string[];
  properties?: Record<string, OpenApiSchemaObject | OpenApiReferenceObject>;
}

export interface OpenApiReferenceObject {
  $ref: string;
}

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
  originalName: string;
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
}

type GeneratedParamScope = "cli" | "mcp" | "sdk";

interface GeneratedRequestField {
  location: Exclude<GeneratedParam["location"], "transport">;
  omitWhenUndefinedExpression: string;
  originalName: string;
  valueExpression: string;
}

interface CollectedCommandParams {
  params: GeneratedParam[];
  preflightLines: string[];
  requestFields: GeneratedRequestField[];
  requiresUserError: boolean;
}

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
  const verb = deriveVerb(entry.method, entry.path, entry.operation, operationId);
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
      description: entry.operation.summary ?? entry.operation.description,
      method: entry.method.toUpperCase(),
      path: entry.path,
      ...(methodDefaults?.confirm === true ? { confirm: true } : {}),
      params: collected.params,
      preflightLines: collected.preflightLines,
      requiresUserError: collected.requiresUserError,
      requestFields: collected.requestFields,
      optionalSections: collectOptionalRequestSections(document, entry.operation)
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
  const requestBodyParams = collectRequestBodyParams(document, entry.operation, operationId);
  const transportParams = [
    {
      paramName: "dryRun",
      originalName: "dryRun",
      location: "transport",
      description: "Print the HTTP request and exit without sending it.",
      scope: ["cli", "sdk"],
      optional: true,
      definition: { kind: "boolean" }
    } satisfies GeneratedParam,
    {
      paramName: "verbose",
      originalName: "verbose",
      location: "transport",
      description: "Log the request line to stderr.",
      shortFlag: "v",
      scope: ["cli", "sdk"],
      optional: true,
      definition: { kind: "boolean" }
    } satisfies GeneratedParam,
    ...(hasJsonSuccessResponseSchema(document, entry.operation, operationId)
      ? [
          {
            paramName: "json",
            originalName: "json",
            location: "transport",
            description: "Print the response as raw JSON.",
            scope: ["cli", "sdk"],
            optional: true,
            definition: { kind: "boolean" }
          } satisfies GeneratedParam
        ]
      : [])
  ];
  const params = [...operationParams.params, ...requestBodyParams.params, ...transportParams];
  const deduped = new Map<string, GeneratedParam>();

  for (const param of params) {
    const existing = deduped.get(param.paramName);

    if (existing !== undefined) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} maps both ${JSON.stringify(existing.originalName)} and ${JSON.stringify(param.originalName)} to flag ${JSON.stringify(param.paramName)}.`
      );
    }

    deduped.set(param.paramName, param);
  }

  return {
    params: [...deduped.values()].sort((left, right) => left.paramName.localeCompare(right.paramName)),
    preflightLines: [...operationParams.preflightLines, ...requestBodyParams.preflightLines],
    requestFields: [...operationParams.requestFields, ...requestBodyParams.requestFields],
    requiresUserError: operationParams.requiresUserError || requestBodyParams.requiresUserError
  };
}

function hasJsonSuccessResponseSchema(
  document: OpenApiDocument,
  operation: OpenApiOperationObject,
  operationId: string
): boolean {
  for (const [statusCode, response] of Object.entries(operation.responses ?? {})) {
    if (!isSuccessStatusCode(statusCode)) {
      continue;
    }

    const resolvedResponse = expectResponse(document, response, operationId, statusCode);

    for (const [mediaType, content] of Object.entries(resolvedResponse.content ?? {})) {
      if (content === undefined || !isJsonMediaType(mediaType)) {
        continue;
      }

      if (content.schema !== undefined) {
        return true;
      }
    }
  }

  return false;
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
  const preflightLines: string[] = [];
  const requestFields: GeneratedRequestField[] = [];
  let requiresUserError = false;

  for (const parameter of merged.values()) {
    const generated = createGeneratedParameter(document, parameter, operationId);
    params.push(...generated.params);
    preflightLines.push(...generated.preflightLines);
    requestFields.push(generated.requestField);
    requiresUserError ||= generated.requiresUserError;
  }

  return {
    params,
    preflightLines,
    requestFields,
    requiresUserError
  };
}

function collectRequestBodyParams(
  document: OpenApiDocument,
  operation: OpenApiOperationObject,
  operationId: string
): CollectedCommandParams {
  if (operation.requestBody === undefined) {
    return {
      params: [],
      preflightLines: [],
      requestFields: [],
      requiresUserError: false
    };
  }

  const requestBody = expectRequestBody(document, operation.requestBody, operationId, "requestBody");
  const content = requestBody.content?.["application/json"];

  if (content === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define requestBody.content["application/json"] in v1.`
    );
  }

  const schema = expectSchema(document, content.schema, operationId, "requestBody");

  if (schema.type !== "object" || schema.properties === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define an object-shaped JSON request body.`
    );
  }

  const required = new Set(schema.required ?? []);
  const bodyOptional = requestBody.required !== true;
  const params: GeneratedParam[] = [];
  const preflightLines: string[] = [];
  const requestFields: GeneratedRequestField[] = [];
  let requiresUserError = false;

  for (const [name, property] of Object.entries(schema.properties)) {
    const propertySchema = expectSchema(document, property, operationId, `requestBody.properties.${name}`);
    const generated = createBodyField(
      document,
      name,
      propertySchema,
      bodyOptional || !required.has(name),
      operationId
    );

    params.push(...generated.params);
    preflightLines.push(...generated.preflightLines);
    requestFields.push(generated.requestField);

    if (generated.preflightLines.length > 0) {
      requiresUserError = true;
    }
  }

  return {
    params,
    preflightLines,
    requestFields,
    requiresUserError
  };
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
): {
  params: GeneratedParam[];
  preflightLines: string[];
  requestField: GeneratedRequestField;
  requiresUserError: boolean;
} {
  const schema = expectSchema(document, parameter.schema, operationId, `parameters.${parameter.name}`);

  if (parameter.in === "path" && parameter.required !== true) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(parameter.name)} must set required: true.`
    );
  }

  if (parameter.in === "query" && schema.type === "array") {
    return createArrayQueryParameter(
      document,
      parameter.name,
      parameter.description ?? schema.description,
      schema,
      parameter.required !== true,
      operationId
    );
  }

  const paramName = normalizeParamName(parameter.name);
  return {
    params: [
      {
        paramName,
        originalName: parameter.name,
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
    preflightLines: [],
    requestField: {
      location: parameter.in,
      originalName: parameter.name,
      valueExpression: `params.${paramName}`,
      omitWhenUndefinedExpression: `params.${paramName} === undefined`
    },
    requiresUserError: false
  };
}

function createArrayQueryParameter(
  document: OpenApiDocument,
  name: string,
  description: string | undefined,
  schema: OpenApiSchemaObject,
  optional: boolean,
  operationId: string
): {
  params: GeneratedParam[];
  preflightLines: string[];
  requestField: GeneratedRequestField;
  requiresUserError: boolean;
} {
  const paramName = normalizeParamName(name);
  const directDefinition = createParamDefinition(
    document,
    schema,
    operationId,
    `parameter ${JSON.stringify(name)}`
  );
  const repeatableParamName = deriveArrayCliParamName(name);
  const jsonParamName = `${paramName}Json`;
  const resolvedName = `resolved${toPascalCase(paramName)}`;

  return {
    params: [
      {
        paramName,
        originalName: name,
        location: "query",
        description,
        optional,
        scope: ["mcp", "sdk"],
        definition: directDefinition
      } satisfies GeneratedParam,
      {
        paramName: repeatableParamName,
        originalName: repeatableParamName,
        location: "transport",
        description,
        optional: true,
        scope: ["cli"],
        definition: directDefinition
      } satisfies GeneratedParam,
      {
        paramName: jsonParamName,
        originalName: jsonParamName,
        location: "transport",
        description: `JSON-encoded value for ${name}.`,
        optional: true,
        scope: ["cli"],
        definition: { kind: "string" }
      } satisfies GeneratedParam
    ],
    preflightLines: [
      `    if (params.${paramName} !== undefined && (params.${repeatableParamName} !== undefined || params.${jsonParamName} !== undefined)) {`,
      `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(paramName)}", "--${toCliFlag(repeatableParamName)}", and "--${toCliFlag(jsonParamName)}" cannot be combined.`)});`,
      "    }",
      `    if (params.${repeatableParamName} !== undefined && params.${jsonParamName} !== undefined) {`,
      `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(repeatableParamName)}" and "--${toCliFlag(jsonParamName)}" are mutually exclusive.`)});`,
      "    }",
      `    let ${resolvedName} = params.${paramName} !== undefined ? params.${paramName} : params.${repeatableParamName};`,
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
      ...(optional
        ? []
        : [
            `    if (${resolvedName} === undefined) {`,
            `      throw new UserError(${JSON.stringify(`Missing required parameter "${toCliFlag(repeatableParamName)}".`)});`,
            "    }"
          ])
    ],
    requestField: {
      location: "query",
      originalName: name,
      valueExpression: resolvedName,
      omitWhenUndefinedExpression: `${resolvedName} === undefined`
    },
    requiresUserError: true
  };
}

function createBodyField(
  document: OpenApiDocument,
  name: string,
  schema: OpenApiSchemaObject,
  optional: boolean,
  operationId: string
): {
  params: GeneratedParam[];
  preflightLines: string[];
  requestField: GeneratedRequestField;
} {
  if (schema.type === "array") {
    return createArrayBodyField(document, name, schema, optional, operationId);
  }

  const paramName = normalizeParamName(name);
  const definition = createParamDefinition(
    document,
    schema,
    operationId,
    `request body field ${JSON.stringify(name)}`
  );
  const params: GeneratedParam[] = [
    {
      paramName,
      originalName: name,
      location: "body",
      description: schema.description,
      optional,
      definition
    } satisfies GeneratedParam
  ];
  const preflightLines: string[] = [];
  const resolvedName = `resolved${toPascalCase(paramName)}`;

  if (definition.nullable === true) {
    params.push({
      paramName: `${paramName}Null`,
      originalName: `${name}Null`,
      location: "transport",
      description: `Send null for ${name}.`,
      optional: true,
      scope: ["cli"],
      definition: { kind: "boolean" }
    });
    preflightLines.push(
      `    if (params.${paramName} !== undefined && params.${paramName} !== null && params.${paramName}Null) {`,
      `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(paramName)}" and "--${toCliFlag(`${paramName}Null`)}" are mutually exclusive.`)});`,
      "    }",
      `    const ${resolvedName} = params.${paramName}Null ? null : params.${paramName};`
    );
  }

  return {
    params,
    preflightLines,
    requestField: {
      location: "body",
      originalName: name,
      valueExpression: definition.nullable === true ? resolvedName : `params.${paramName}`,
      omitWhenUndefinedExpression:
        definition.nullable === true
          ? `${resolvedName} === undefined`
          : `params.${paramName} === undefined`
    }
  };
}

function createArrayBodyField(
  document: OpenApiDocument,
  name: string,
  schema: OpenApiSchemaObject,
  optional: boolean,
  operationId: string
): {
  params: GeneratedParam[];
  preflightLines: string[];
  requestField: GeneratedRequestField;
} {
  const paramName = normalizeParamName(name);
  const directDefinition = createParamDefinition(
    document,
    schema,
    operationId,
    `request body field ${JSON.stringify(name)}`
  );
  const repeatableParamName = deriveArrayCliParamName(name);
  const jsonParamName = `${paramName}Json`;
  const nullParamName = `${paramName}Null`;
  const resolvedName = `resolved${toPascalCase(paramName)}`;
  const params: GeneratedParam[] = [
    {
      paramName,
      originalName: name,
      location: "body",
      description: schema.description,
      optional,
      scope: ["mcp", "sdk"],
      definition: directDefinition
    } satisfies GeneratedParam,
    {
      paramName: repeatableParamName,
      originalName: repeatableParamName,
      location: "transport",
      description: schema.description,
      optional: true,
      scope: ["cli"],
      definition: directDefinition
    } satisfies GeneratedParam,
    {
      paramName: jsonParamName,
      originalName: jsonParamName,
      location: "transport",
      description: `JSON-encoded value for ${name}.`,
      optional: true,
      scope: ["cli"],
      definition: { kind: "string" }
    } satisfies GeneratedParam
  ];

  if (directDefinition.nullable === true) {
    params.push({
      paramName: nullParamName,
      originalName: nullParamName,
      location: "transport",
      description: `Send null for ${name}.`,
      optional: true,
      scope: ["cli"],
      definition: { kind: "boolean" }
    });
  }

  const preflightLines = [
    ...(directDefinition.nullable === true
      ? [
          `    if (params.${nullParamName} && (params.${paramName} !== undefined || params.${repeatableParamName} !== undefined || params.${jsonParamName} !== undefined)) {`,
          `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(nullParamName)}", "--${toCliFlag(paramName)}", "--${toCliFlag(repeatableParamName)}", and "--${toCliFlag(jsonParamName)}" cannot be combined.`)});`,
          "    }"
        ]
      : []),
    `    if (params.${paramName} !== undefined && (params.${repeatableParamName} !== undefined || params.${jsonParamName} !== undefined)) {`,
    `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(paramName)}", "--${toCliFlag(repeatableParamName)}", and "--${toCliFlag(jsonParamName)}" cannot be combined.`)});`,
    "    }",
    `    if (params.${repeatableParamName} !== undefined && params.${jsonParamName} !== undefined) {`,
    `      throw new UserError(${JSON.stringify(`Options "--${toCliFlag(repeatableParamName)}" and "--${toCliFlag(jsonParamName)}" are mutually exclusive.`)});`,
    "    }",
    `    let ${resolvedName} = params.${paramName} !== undefined ? params.${paramName} : params.${repeatableParamName};`,
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
    ...(directDefinition.nullable === true
      ? [`    if (params.${nullParamName}) {`, `      ${resolvedName} = null;`, "    }"]
      : [])
  ];

  if (!optional) {
    preflightLines.push(
      `    if (${resolvedName} === undefined) {`,
      `      throw new UserError(${JSON.stringify(`Missing required parameter "${toCliFlag(repeatableParamName)}".`)});`,
      "    }"
    );
  }

  return {
    params,
    preflightLines,
    requestField: {
      location: "body",
      originalName: name,
      valueExpression: resolvedName,
      omitWhenUndefinedExpression: `${resolvedName} === undefined`
    }
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
  const enumValues = normalizeEnumValues(schema.enum, operationId, context, schema.nullable === true);

  if (enumValues !== undefined) {
    return {
      kind: "enum",
      enumValues,
      ...(scalarDefinition?.jsonType === undefined ? {} : { jsonType: scalarDefinition.jsonType }),
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
      ...(schema.nullable === true || schema.enum?.includes(null) === true ? { nullable: true } : {})
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

function deriveArrayCliParamName(name: string): string {
  const normalized = normalizeParamName(name);

  if (normalized.endsWith("ies") && normalized.length > 3) {
    return `${normalized.slice(0, -3)}y`;
  }

  if (normalized.endsWith("s") && !normalized.endsWith("ss") && normalized.length > 1) {
    return normalized.slice(0, -1);
  }

  return `${normalized}Item`;
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
  nullable: boolean
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

  if (
    filteredValues.some((value) => !isEnumPrimitiveValue(value))
  ) {
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
  operationId: string
): SupportedOpenApiParameterObject {
  if (isReferenceObject(parameter)) {
    return expectParameter(
      document,
      resolveLocalReference(document, parameter.$ref, operationId, "parameter") as OpenApiParameter,
      operationId
    );
  }

  if (parameter.in !== "path" && parameter.in !== "query") {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported parameter location ${JSON.stringify(parameter.in)}.`
    );
  }

  return {
    ...parameter,
    in: parameter.in
  };
}

function isEnumPrimitiveValue(value: unknown): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function expectRequestBody(
  document: OpenApiDocument,
  requestBody: OpenApiRequestBodyObject | OpenApiReferenceObject,
  operationId: string,
  context: string
): OpenApiRequestBodyObject {
  if (!isReferenceObject(requestBody)) {
    return requestBody;
  }

  return expectRequestBody(
    document,
    resolveLocalReference(document, requestBody.$ref, operationId, context) as OpenApiRequestBodyObject | OpenApiReferenceObject,
    operationId,
    context
  );
}

function expectResponse(
  document: OpenApiDocument,
  response: OpenApiResponseObject | OpenApiReferenceObject,
  operationId: string,
  statusCode: string
): OpenApiResponseObject {
  if (!isReferenceObject(response)) {
    return response;
  }

  return expectResponse(
    document,
    resolveLocalReference(
      document,
      response.$ref,
      operationId,
      `success response for status ${JSON.stringify(statusCode)}`
    ) as OpenApiResponseObject | OpenApiReferenceObject,
    operationId,
    statusCode
  );
}

function expectSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined,
  operationId: string,
  context: string
): OpenApiSchemaObject {
  if (schema === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} is missing a schema for ${context}.`
    );
  }

  if (isReferenceObject(schema)) {
    return expectSchema(
      document,
      resolveLocalReference(document, schema.$ref, operationId, context) as
        | OpenApiSchemaObject
        | OpenApiReferenceObject,
      operationId,
      context
    );
  }

  return schema;
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

function collectOptionalRequestSections(
  document: OpenApiDocument,
  operation: OpenApiOperationObject
): Set<Exclude<GeneratedParam["location"], "transport">> {
  const optionalSections = new Set<Exclude<GeneratedParam["location"], "transport">>();

  if (
    operation.requestBody !== undefined &&
    expectRequestBody(document, operation.requestBody, operation.operationId ?? "requestBody", "requestBody")
      .required !== true
  ) {
    optionalSections.add("body");
  }

  return optionalSections;
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
  params: GeneratedParam[];
  preflightLines: string[];
  requiresUserError: boolean;
  requestFields: GeneratedRequestField[];
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
  confirm?: true;
}): string {
  const lines = [
    "/**",
    " * Generated by @poe-code/cmdkit-openapi.",
    ` * spec-sha: ${options.specSha}`,
    ` * operation-id: ${options.operationId}`,
    " */",
    options.requiresUserError
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
  if (options.confirm === true) {
    lines.push("  confirm: true,");
  }
  lines.push("  params: S.Object({");
  lines.push(...renderParamLines(options.params));
  lines.push("  }),");
  lines.push("  handler: async ({ params, baseUrl, tokenSource, fetch }) => {");
  lines.push(...options.preflightLines);
  lines.push("    return requestJson({");
  lines.push("      baseUrl,");
  lines.push(`      path: ${JSON.stringify(options.path)},`);
  lines.push(`      method: ${JSON.stringify(options.method)},`);
  lines.push("      tokenSource,");
  lines.push("      fetch,");
  lines.push("      dryRun: params.dryRun,");
  lines.push("      verbose: params.verbose,");
  lines.push(...renderRequestShape(options.requestFields, options.optionalSections));
  lines.push("    });");
  lines.push("  },");
  lines.push("});");
  lines.push("");

  return lines.join("\n");
}

function renderParamLines(params: GeneratedParam[]): string[] {
  return params.map((param) => `    ${param.paramName}: ${renderParamSchema(param)},`);
}

function renderParamSchema(param: GeneratedParam): string {
  const schema = renderRequiredParamSchema(param);
  return param.optional ? `S.Optional(${schema})` : schema;
}

function renderRequiredParamSchema(param: GeneratedParam): string {
  return renderDefinition(param.definition, param.description, param.shortFlag, param.scope);
}

function renderDefinition(
  definition: GeneratedParamDefinition,
  description?: string,
  shortFlag?: string,
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]]
): string {
  const schema = {
    description,
    shortFlag,
    scope,
    definition
  } satisfies Pick<GeneratedParam, "description" | "shortFlag" | "scope" | "definition">;
  const options = renderSchemaOptions(schema as GeneratedParam);

  if (definition.kind === "enum") {
    return `S.Enum(${renderConstArray(definition.enumValues ?? [])}${options})`;
  }

  if (definition.kind === "array") {
    return `S.Array(${renderDefinition(definition.itemDefinition ?? { kind: "string" }, undefined, undefined, undefined)}${options})`;
  }

  const builderName = definition.kind[0]?.toUpperCase() + definition.kind.slice(1);
  return `S.${builderName}(${options.length === 0 ? "" : options.slice(2)})`;
}

function renderSchemaOptions(param: GeneratedParam): string {
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

  return entries.length === 0 ? "" : `, { ${entries.join(", ")} }`;
}

function renderConstArray(values: ReadonlyArray<string | number | boolean>): string {
  return `${JSON.stringify(values)} as const`;
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

    if (section.omittable && optionalSections.has(section.location)) {
      lines.push(
        `      ...(${sectionFields
          .map((param) => param.omitWhenUndefinedExpression)
          .join(" && ")}`
      );
      lines.push("        ? {}");
      lines.push("        : {");
      lines.push(`            ${section.key}: {`);
      lines.push(
        ...sectionFields.map(
          (param) =>
            `              ${JSON.stringify(param.originalName)}: ${param.valueExpression},`
        )
      );
      lines.push("            },");
      lines.push("          }),");
      continue;
    }

    lines.push(`      ${section.key}: {`);
    lines.push(
      ...sectionFields.map(
        (param) => `        ${JSON.stringify(param.originalName)}: ${param.valueExpression},`
      )
    );
    lines.push("      },");
  }

  return lines;
}

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
