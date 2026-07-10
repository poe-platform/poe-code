import { ToolcraftBugError, UserError } from "toolcraft";
import {
  METHOD_DEFAULTS,
  deriveDisambiguatedVerb,
  deriveNoun,
  derivePathDisambiguatedVerb,
  deriveVerb,
  isIdentifierName,
  normalizeNoun,
  normalizeParamName,
  toCliFlag,
  toCamelCase,
  toPascalCase,
  type HttpMethod
} from "./naming.js";
import { groupByNoun } from "./group-by-noun.js";
import { renderPreflightBlock, renderRequestShape } from "./interpreter.js";
import { normalizeOpenApiDocument } from "./normalize-swagger.js";
import type { ToolcraftConfig, ToolcraftMethodConfig, ToolcraftResourceConfig } from "./config.js";

const HTTP_METHOD_ORDER = ["get", "post", "put", "patch", "delete", "head", "options"] as const;
const UNSUPPORTED_HTTP_METHODS = ["trace"] as const;
const METHODS_WITHOUT_REQUEST_BODY = new Set<HttpMethod>(["head", "options"]);
type OpenApiOperation = OpenApiOperationObject | OpenApiReferenceObject;
type OpenApiOperationMap = Partial<Record<HttpMethod, OpenApiOperation>>;
type OpenApiParameterLocation = "path" | "query" | "header" | "cookie";
type SupportedOpenApiParameterLocation = "path" | "query" | "header";
type OpenApiScalarType = "string" | "number" | "integer" | "boolean";
type OpenApiSchemaType = OpenApiScalarType | "object" | "array";
type OpenApiJsonSchemaType = OpenApiSchemaType | "null";
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
  header: { array: false, scalar: false },
  path: { array: false, scalar: false },
  // Query null already serializes as the existing empty-string wire encoding, so v1
  // keeps null-helper flags body-only until a real query-null convention lands.
  query: { array: false, scalar: false }
} as const satisfies Record<GeneratedRequestLocation, Record<NullHelperShape, boolean>>;

const BINARY_OUTPUT_PARAM = {
  paramName: "output",
  sourceName: "output",
  location: "transport",
  description: "Write a binary response body to this local file path.",
  scope: ["cli"],
  optional: true,
  definition: { kind: "string" }
} as const satisfies GeneratedParam;

export interface OpenApiTagObject {
  name: string;
  description?: string;
}

export interface OpenApiDocument {
  openapi?: string;
  info?: {
    title?: string;
    version?: string;
  };
  servers?: OpenApiServerObject[];
  security?: OpenApiSecurityRequirementObject[];
  tags?: OpenApiTagObject[];
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
  example?: unknown;
  examples?: Record<string, { value?: unknown } | undefined>;
}

export interface OpenApiSchemaObject {
  type?: OpenApiJsonSchemaType | readonly OpenApiJsonSchemaType[];
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
  brand?: string;
  config?: ToolcraftConfig;
}

export interface GeneratedFile {
  path: string;
  contents: string;
}

export interface GeneratedSkill {
  name: string;
  contents: string;
}

export interface GeneratedCommand {
  noun: string;
  verb: string;
  exportName: string;
  filePath: string;
  operationId: string;
  description?: string;
  examples?: GeneratedCommandExample[];
  method: string;
  path: string;
  auth: "required" | "none";
  responseMode: "json" | "text" | "binary";
  accept: string;
  baseUrl?: string;
  bodyMode?: "json" | "form" | "raw" | "base64" | "multipart";
  contentType?: string;
  multipartBinaryFields?: readonly string[];
  idempotencyHeader?: string;
  rawResponse?: boolean;
  confirm: boolean;
  positional: string[];
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
  location: "path" | "query" | "header" | "body" | "transport";
  description?: string;
  longAliases?: string[];
  shortFlag?: string;
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]];
  global?: boolean;
  optional: boolean;
  definition: GeneratedParamDefinition;
}

interface GeneratedCommandExample {
  title: string;
  params: Record<string, unknown>;
}

interface GeneratedParamDefinitionMetadata {
  additionalProperties?: boolean;
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

interface GeneratedJsonParamDefinition extends GeneratedParamDefinitionMetadata {
  kind: "json";
}

interface GeneratedObjectParamDefinition extends GeneratedParamDefinitionMetadata {
  kind: "object";
  properties: readonly GeneratedObjectPropertyDefinition[];
}

interface GeneratedObjectPropertyDefinition {
  name: string;
  optional: boolean;
  definition: GeneratedParamDefinition;
}

export type GeneratedParamDefinition =
  | GeneratedScalarParamDefinition
  | GeneratedEnumParamDefinition
  | GeneratedArrayParamDefinition
  | GeneratedObjectParamDefinition
  | GeneratedJsonParamDefinition;

type GeneratedParamScope = "cli" | "mcp" | "sdk";
type GeneratedEnumValue = string | number | boolean;
export type GeneratedValueReference =
  | { kind: "param"; paramName: string }
  | { kind: "resolved"; resolvedName: string };
export type GeneratedValueExpression =
  | { kind: "reference"; reference: GeneratedValueReference }
  | { kind: "emptyObject" }
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
  bodyMode?: "json" | "form" | "raw" | "base64" | "multipart";
  contentType?: string;
  multipartBinaryFields?: readonly string[];
}

interface GeneratedParameterAssembly {
  params: GeneratedParam[];
  preflightBlocks: GeneratedPreflightBlock[];
  requestField: GeneratedRequestField;
}

interface RenderSchemaOptionsInput {
  definition: GeneratedParamDefinition;
  description?: string;
  longAliases?: string[];
  shortFlag?: string;
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]];
  global?: boolean;
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
      definition: Extract<GeneratedParamDefinition, { kind: "array" }>;
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
    key: "additionalProperties",
    get: (param: RenderSchemaOptionsInput) => param.definition.additionalProperties
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
    key: "cliAliases",
    get: (param: RenderSchemaOptionsInput) => param.longAliases
  },
  {
    key: "scope",
    get: (param: RenderSchemaOptionsInput) => param.scope
  },
  {
    key: "global",
    get: (param: RenderSchemaOptionsInput) => (param.global === true ? true : undefined)
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
  queryObjectSerialization?: "deepObject";
}

type QueryArraySerialization = "repeat" | "brackets" | "comma" | "pipe";

interface OperationEntry {
  method: HttpMethod;
  path: string;
  operation: OpenApiOperation;
  pathItem: OpenApiPathItemObject;
}

export function generate(document: OpenApiDocument, options: GenerateOptions): GeneratedFile[] {
  const normalizedDocument = normalizeOpenApiDocument(document);
  const commands = collectGeneratedCommands(normalizedDocument, options.config);
  const brand = options.brand ?? "blue";
  const label = normalizedDocument.info?.title ?? "Toolcraft";

  return [
    ...commands.map((command) => ({
      path: command.filePath,
      contents: createCommandFile(command)
    })),
    createIndexFile(commands, normalizedDocument),
    createClientFile(),
    createCliFile({ brand, label }),
    createMcpFile()
  ];
}

export function generateSkill(
  document: OpenApiDocument,
  options: { commandName?: string | undefined; config?: ToolcraftConfig | undefined } = {}
): GeneratedSkill {
  const normalizedDocument = normalizeOpenApiDocument(document);
  const commands = collectGeneratedCommands(normalizedDocument, options.config);
  const label = normalizedDocument.info?.title ?? "Toolcraft";

  return createSkill({
    commands,
    commandName: options.commandName,
    label
  });
}

export function collectGeneratedCommands(
  document: OpenApiDocument,
  config?: ToolcraftConfig
): GeneratedCommand[] {
  const normalizedDocument = normalizeOpenApiDocument(document);
  const paths = normalizedDocument.paths;

  if (paths === undefined) {
    throw new UserError('OpenAPI document must define a top-level "paths" object.');
  }

  const commands = collectOperations(paths).map((entry) =>
    createGeneratedCommand(normalizedDocument, entry)
  );

  applyConfiguredCommandShape(commands, config);
  disambiguateCommandPaths(commands);
  assertUniqueCommandPaths(commands);

  return commands.slice().sort((left, right) => compareGeneratedCommandPaths(left, right));
}

interface ConfiguredCommandShape {
  exampleKey: string;
  noun: string;
  verb: string;
  method: ToolcraftMethodConfig;
}

function applyConfiguredCommandShape(
  commands: GeneratedCommand[],
  config: ToolcraftConfig | undefined
): void {
  const configured = collectConfiguredCommandShapes(config?.resources);
  if (configured.length === 0) {
    return;
  }

  for (const command of commands) {
    const match = configured.find(
      (candidate) =>
        candidate.method.method.toUpperCase() === command.method &&
        candidate.method.path === command.path
    );

    if (match === undefined) {
      continue;
    }

    command.noun = createSafeGeneratedNoun(match.noun);
    command.verb = createSafeGeneratedVerb(match.verb);
    command.examples = config?.readme?.examples?.[match.exampleKey];
    applyConfiguredRawResponse(command);
    applyConfiguredIdempotency(command, match.method, config);
    refreshGeneratedCommandNames(command);
  }
}

function applyConfiguredRawResponse(command: GeneratedCommand): void {
  command.rawResponse = true;
  if (command.params.some((param) => param.paramName === "rawResponse")) {
    return;
  }

  command.params.push({
    paramName: "rawResponse",
    sourceName: "rawResponse",
    location: "transport",
    description: "Return parsed data with the raw HTTP Response.",
    longAliases: ["raw"],
    scope: ["cli", "sdk"],
    optional: true,
    definition: { kind: "boolean" }
  });
}

function applyConfiguredIdempotency(
  command: GeneratedCommand,
  method: ToolcraftMethodConfig,
  config: ToolcraftConfig | undefined
): void {
  const header = config?.client_settings?.idempotency_header;
  if (method.idempotent !== true || header === undefined || command.method === "GET") {
    return;
  }

  command.idempotencyHeader = header;
  if (command.params.some((param) => param.paramName === "idempotencyKey")) {
    return;
  }

  command.params.push({
    paramName: "idempotencyKey",
    sourceName: "idempotencyKey",
    location: "transport",
    description: "Set an idempotency key to retry this request safely.",
    scope: ["cli", "mcp", "sdk"],
    optional: true,
    definition: { kind: "string" }
  });
}

function collectConfiguredCommandShapes(
  resources: Record<string, ToolcraftResourceConfig> | undefined
): ConfiguredCommandShape[] {
  const shapes: ConfiguredCommandShape[] = [];

  function visit(
    resourceName: string,
    resource: ToolcraftResourceConfig,
    resourcePath: string[]
  ): void {
    for (const [methodName, method] of Object.entries(resource.methods ?? {})) {
      shapes.push({
        exampleKey: [...resourcePath, methodName].join("."),
        noun: resourceName,
        verb: methodName,
        method
      });
    }

    for (const [childName, childResource] of Object.entries(resource.subresources ?? {})) {
      visit(childName, childResource, [...resourcePath, childName]);
    }
  }

  for (const [resourceName, resource] of Object.entries(resources ?? {})) {
    visit(resourceName, resource, [resourceName]);
  }

  return shapes;
}

function createSafeGeneratedVerb(value: string): string {
  const verb = toCamelCase(value);

  if (!isIdentifierName(verb)) {
    throw new UserError(
      `Configured method ${JSON.stringify(value)} must map to a valid command name.`
    );
  }

  return verb;
}

function refreshGeneratedCommandNames(command: GeneratedCommand): void {
  command.exportName = `${toCamelCase(command.noun)}${toPascalCase(command.verb)}Command`;
  command.filePath = `${command.noun}/${command.verb}.ts`;
}

export function collectGeneratedCommand(
  document: OpenApiDocument,
  path: string,
  method: HttpMethod
): GeneratedCommand {
  const normalizedDocument = normalizeOpenApiDocument(document);
  const pathItem = normalizedDocument.paths?.[path];
  const operation = pathItem?.[method];

  if (pathItem === undefined || operation === undefined) {
    throw new ToolcraftBugError(
      `Cannot generate missing OpenAPI operation ${method.toUpperCase()} ${path}.`
    );
  }

  return createGeneratedCommand(normalizedDocument, { method, path, operation, pathItem });
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
        const operation = getOwnPathItemValue(pathItem, method) as OpenApiOperation | undefined;
        if (operation === undefined) {
          return [];
        }

        return [{ method, path, operation, pathItem } satisfies OperationEntry];
      });
    });
}

function getOwnPathItemValue(pathItem: OpenApiPathItemObject, key: string): unknown {
  return Object.prototype.hasOwnProperty.call(pathItem, key)
    ? (pathItem as Record<string, unknown>)[key]
    : undefined;
}

function createGeneratedCommand(
  document: OpenApiDocument,
  entry: OperationEntry
): GeneratedCommand {
  const operation = expectOperation(document, entry.operation, entry.method, entry.path);
  const operationId = operation.operationId ?? `${entry.method.toUpperCase()} ${entry.path}`;
  const operationBaseUrl = resolveOperationBaseUrl(operation, operationId);
  const auth = getOperationAuthMode(document, operation, operationId);
  const response = resolveSuccessResponse(document, operation, operationId);
  const noun = createSafeGeneratedNoun(deriveNoun(operation, entry.path, operationId));
  const verb = deriveVerb(entry.method, entry.path, operation, operationId, noun);
  const collected = collectParams(document, entry, operation, operationId, auth, response.mode);
  const positional = collectPathPositionals(entry.path, collected.params, operationId);
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
    auth,
    responseMode: response.mode,
    accept: response.accept,
    baseUrl: operationBaseUrl,
    bodyMode: collected.bodyMode,
    contentType: collected.contentType,
    multipartBinaryFields: collected.multipartBinaryFields,
    confirm: methodDefaults?.confirm === true,
    positional,
    params: collected.params,
    paramsSchemaOptions: collected.paramsSchemaOptions,
    preflightBlocks: collected.preflightBlocks,
    requestFields: collected.requestFields,
    sectionRenders: collected.sectionRenders,
    optionalSections: collected.optionalSections
  };
}

function collectPathPositionals(
  pathTemplate: string,
  params: readonly GeneratedParam[],
  operationId: string
): string[] {
  const pathParamNames = new Set(
    params.filter((param) => param.location === "path").map((param) => param.sourceName)
  );
  const positionals: string[] = [];

  for (const segment of pathTemplate.split("/")) {
    if (!segment.startsWith("{") || !segment.endsWith("}")) {
      continue;
    }

    const sourceName = segment.slice(1, -1);
    if (!pathParamNames.has(sourceName)) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(sourceName)} is missing from generated params.`
      );
    }

    const param = params.find(
      (candidate) => candidate.location === "path" && candidate.sourceName === sourceName
    );
    if (param === undefined) {
      continue;
    }
    if (param.definition.kind === "array" && positionals.length < pathParamNames.size - 1) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} path parameter ${JSON.stringify(sourceName)} is an array and can only be the final positional argument.`
      );
    }

    positionals.push(param.paramName);
  }

  return positionals;
}

function resolveOperationBaseUrl(
  operation: OpenApiOperationObject,
  operationId: string
): string | undefined {
  if (operation.servers === undefined) {
    return undefined;
  }

  const [server] = operation.servers;
  if (operation.servers.length !== 1 || server === undefined || server.url.includes("{")) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define exactly one fixed per-operation server URL in v1.`
    );
  }

  try {
    return new URL(server.url).toString().replace(/\/$/, "");
  } catch {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} defines invalid per-operation server URL ${JSON.stringify(server.url)}.`
    );
  }
}

function collectParams(
  document: OpenApiDocument,
  entry: OperationEntry,
  operation: OpenApiOperationObject,
  operationId: string,
  auth: "required" | "none",
  responseMode: "json" | "text" | "binary"
): CollectedCommandParams {
  const transportParams = responseMode === "binary" ? [BINARY_OUTPUT_PARAM] : [];
  const operationParams = collectOperationParameters(
    document,
    entry.path,
    entry.pathItem.parameters ?? [],
    operation.parameters ?? [],
    operationId,
    auth
  );
  const requestBodyParams = collectRequestBodyParams(
    document,
    operation,
    operationId,
    entry.method
  );
  const qualifiedRequestBodyParams = qualifyBodyParamCollisions(
    requestBodyParams,
    new Set([...operationParams.params, ...transportParams].map((param) => param.paramName))
  );
  const params = [
    ...operationParams.params,
    ...qualifiedRequestBodyParams.params,
    ...transportParams
  ];
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
    paramsSchemaOptions: qualifiedRequestBodyParams.paramsSchemaOptions,
    preflightBlocks: [
      ...operationParams.preflightBlocks,
      ...qualifiedRequestBodyParams.preflightBlocks
    ],
    requestFields: [...operationParams.requestFields, ...qualifiedRequestBodyParams.requestFields],
    sectionRenders: {
      ...operationParams.sectionRenders,
      ...qualifiedRequestBodyParams.sectionRenders
    },
    optionalSections: new Set([
      ...operationParams.optionalSections,
      ...qualifiedRequestBodyParams.optionalSections
    ]),
    requestBodyDescription: qualifiedRequestBodyParams.requestBodyDescription,
    bodyMode: qualifiedRequestBodyParams.bodyMode,
    contentType: qualifiedRequestBodyParams.contentType,
    multipartBinaryFields: qualifiedRequestBodyParams.multipartBinaryFields
  };
}

function qualifyBodyParamCollisions(
  collected: CollectedCommandParams,
  reservedNames: ReadonlySet<string>
): CollectedCommandParams {
  const renames = new Map<string, string>();
  const usedNames = new Set(reservedNames);

  for (const param of collected.params) {
    let paramName = param.paramName;
    if (usedNames.has(paramName)) {
      const baseName = `body${toPascalCase(paramName)}`;
      paramName = baseName;
      let suffix = 2;
      while (usedNames.has(paramName)) {
        paramName = `${baseName}${suffix}`;
        suffix += 1;
      }
      renames.set(param.paramName, paramName);
    }
    usedNames.add(paramName);
  }

  if (renames.size === 0) {
    return collected;
  }

  const renameReference = (reference: GeneratedValueReference): GeneratedValueReference =>
    reference.kind === "param" && renames.has(reference.paramName)
      ? { ...reference, paramName: renames.get(reference.paramName) as string }
      : reference;

  return {
    ...collected,
    params: collected.params.map((param) => ({
      ...param,
      paramName: renames.get(param.paramName) ?? param.paramName
    })),
    preflightBlocks: collected.preflightBlocks.map((block) =>
      block.kind === "scalar-null"
        ? {
            ...block,
            paramName: renames.get(block.paramName) ?? block.paramName,
            nullParamName: renames.get(block.nullParamName) ?? block.nullParamName
          }
        : {
            ...block,
            paramName: renames.get(block.paramName) ?? block.paramName,
            jsonParamName: renames.get(block.jsonParamName) ?? block.jsonParamName,
            ...(block.nullParamName === undefined
              ? {}
              : { nullParamName: renames.get(block.nullParamName) ?? block.nullParamName })
          }
    ),
    requestFields: collected.requestFields.map((field) => ({
      ...field,
      omitWhenUndefinedReference: renameReference(field.omitWhenUndefinedReference),
      value:
        field.value.kind === "reference"
          ? { ...field.value, reference: renameReference(field.value.reference) }
          : field.value.kind === "queryArray"
            ? { ...field.value, reference: renameReference(field.value.reference) }
            : field.value
    }))
  };
}

function collectOperationParameters(
  document: OpenApiDocument,
  path: string,
  pathItemParameters: OpenApiParameter[],
  operationParameters: OpenApiParameter[],
  operationId: string,
  auth: "required" | "none"
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

  promoteQueryDeclaredPathParameters(path, merged);

  assertPathTemplateParameters(path, merged, operationId);

  const params: GeneratedParam[] = [];
  const preflightBlocks: GeneratedPreflightBlock[] = [];
  const requestFields: GeneratedRequestField[] = [];
  const usedParamNames = new Set<string>();

  for (const parameter of merged.values()) {
    if (
      parameter.in === "header" &&
      ["accept", "content-type"].includes(parameter.name.toLowerCase())
    ) {
      continue;
    }

    const paramName = usedParamNames.has(parameter.name)
      ? `${parameter.in}${toPascalCase(parameter.name)}`
      : parameter.name;
    const generated = createGeneratedParameter(
      document,
      paramName === parameter.name ? parameter : { ...parameter, name: paramName },
      operationId,
      auth
    );
    generated.requestField.wireName = generated.requestField.wireName.endsWith("[]")
      ? `${parameter.name}[]`
      : parameter.name;
    for (const param of generated.params) {
      param.sourceName = parameter.name;
      usedParamNames.add(param.paramName);
    }
    params.push(...generated.params);
    preflightBlocks.push(...generated.preflightBlocks);
    requestFields.push(generated.requestField);
  }

  return {
    params,
    paramsSchemaOptions: undefined,
    preflightBlocks,
    requestFields,
    sectionRenders: { path: "wrapped", query: "wrapped", header: "wrapped" },
    optionalSections: new Set(),
    requestBodyDescription: undefined
  };
}

function promoteQueryDeclaredPathParameters(
  path: string,
  parameters: Map<string, SupportedOpenApiParameterObject>
): void {
  for (const placeholder of collectPathPlaceholders(path)) {
    if (parameters.has(`path:${placeholder}`)) {
      continue;
    }

    const queryParameter = parameters.get(`query:${placeholder}`);
    if (queryParameter === undefined) {
      continue;
    }

    parameters.delete(`query:${placeholder}`);
    parameters.set(`path:${placeholder}`, { ...queryParameter, in: "path", required: true });
  }
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
  const contentEntries = Object.entries(requestBody.content ?? {});
  const contentEntry =
    contentEntries.find(
      ([mediaType, mediaTypeObject]) => mediaTypeObject !== undefined && isJsonMediaType(mediaType)
    ) ??
    contentEntries.find(
      ([mediaType, mediaTypeObject]) =>
        mediaTypeObject !== undefined &&
        mediaType.toLowerCase() === "application/x-www-form-urlencoded"
    ) ??
    contentEntries.find(
      ([mediaType, mediaTypeObject]) => mediaTypeObject !== undefined && isTextMediaType(mediaType)
    ) ??
    contentEntries.find(
      ([mediaType, mediaTypeObject]) =>
        mediaTypeObject !== undefined && isBinaryMediaType(mediaType)
    ) ??
    contentEntries.find(
      ([mediaType, mediaTypeObject]) =>
        mediaTypeObject !== undefined && mediaType.toLowerCase() === "multipart/form-data"
    );
  const content = contentEntry?.[1];
  const requestMediaType = contentEntry?.[0];
  const bodyMode =
    requestMediaType?.toLowerCase() === "application/x-www-form-urlencoded"
      ? "form"
      : requestMediaType?.toLowerCase() === "multipart/form-data"
        ? "multipart"
        : requestMediaType !== undefined && !isJsonMediaType(requestMediaType)
          ? isTextMediaType(requestMediaType)
            ? "raw"
            : "base64"
          : "json";

  if (content === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define a JSON request body media type in v1.`
    );
  }

  if (bodyMode === "raw" || bodyMode === "base64") {
    const description = requestBody.description;
    return {
      ...createCollectedRequestBodyParams(
        [
          createBodyField(
            document,
            "body",
            { type: "string", ...(description === undefined ? {} : { description }) },
            requestBody.required !== true,
            operationId
          )
        ],
        requestBody.required !== true,
        description,
        "inline",
        undefined,
        bodyMode
      ),
      contentType: requestMediaType
    };
  }

  const schema = resolveBodySchema(document, content.schema, operationId, "requestBody");
  const bodyOptional = requestBody.required !== true;
  const multipartBinaryFields =
    bodyMode === "multipart" && schema.properties !== undefined
      ? Object.entries(schema.properties)
          .filter(([, property]) => {
            const resolved = resolveBodySchema(
              document,
              property,
              operationId,
              "requestBody multipart field"
            );
            return resolved.type === "string" && resolved.format === "binary";
          })
          .map(([name]) => name)
      : undefined;

  if (schema.type !== "object" || getCompositionKeyword(schema) !== undefined) {
    const bodySchema =
      schema.description === undefined && requestBody.description !== undefined
        ? { ...schema, description: requestBody.description }
        : schema;

    return createCollectedRequestBodyParams(
      [createBodyField(document, "body", bodySchema, bodyOptional, operationId)],
      bodyOptional,
      schema.description === undefined ? undefined : requestBody.description,
      "inline",
      undefined,
      bodyMode,
      multipartBinaryFields
    );
  }

  if (
    (schema.additionalProperties !== undefined && schema.additionalProperties !== false) ||
    schema.properties === undefined
  ) {
    return createCollectedRequestBodyParams(
      [
        createJsonBodyField({
          document,
          name: "body",
          description: schema.description ?? requestBody.description,
          schema,
          optional: bodyOptional,
          operationId,
          context: "requestBody",
          location: "body"
        })
      ],
      bodyOptional,
      requestBody.description,
      "inline",
      undefined,
      bodyMode,
      multipartBinaryFields
    );
  }

  const required = new Set(schema.required ?? []);
  const assemblies: GeneratedParameterAssembly[] = [];
  const declaredPropertyCount = Object.keys(schema.properties).length;

  for (const [name, property] of Object.entries(schema.properties)) {
    const propertySchema = resolveBodySchema(
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
    if (declaredPropertyCount === 0) {
      return {
        params: [],
        paramsSchemaOptions:
          schema.additionalProperties === false ? { additionalProperties: false } : undefined,
        preflightBlocks: [],
        requestFields: [
          {
            location: "body",
            wireName: "body",
            value: { kind: "emptyObject" },
            omitWhenUndefinedReference: { kind: "resolved", resolvedName: "emptyBody" }
          }
        ],
        sectionRenders: { body: "inline" },
        optionalSections: new Set(),
        requestBodyDescription: requestBody.description,
        bodyMode,
        ...(multipartBinaryFields === undefined ? {} : { multipartBinaryFields })
      };
    }

    throw new UserError(
      `Operation ${JSON.stringify(operationId)} requestBody is required but all declared fields are readOnly.`
    );
  }

  return createCollectedRequestBodyParams(
    assemblies,
    bodyOptional,
    requestBody.description,
    "wrapped",
    schema.additionalProperties === false ? { additionalProperties: false } : undefined,
    bodyMode,
    multipartBinaryFields
  );
}

function resolveSuccessResponse(
  document: OpenApiDocument,
  operation: OpenApiOperationObject,
  operationId: string
): { mode: "json" | "text" | "binary"; accept: string } {
  let textualMediaType: string | undefined;
  let binaryMediaType: string | undefined;

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
      declaredMediaTypes.some((mediaType) => isJsonMediaType(mediaType))
    ) {
      continue;
    }

    const textual = declaredMediaTypes.find(isTextMediaType);
    if (textual !== undefined && declaredMediaTypes.every(isTextMediaType)) {
      textualMediaType ??= textual;
      continue;
    }

    binaryMediaType ??= declaredMediaTypes[0];
  }

  if (binaryMediaType !== undefined) {
    return { mode: "binary", accept: binaryMediaType };
  }

  return textualMediaType === undefined
    ? { mode: "json", accept: "application/json" }
    : { mode: "text", accept: textualMediaType };
}

function createGeneratedParameter(
  document: OpenApiDocument,
  parameter: SupportedOpenApiParameterObject,
  operationId: string,
  auth: "required" | "none"
): GeneratedParameterAssembly {
  if (
    parameter.in === "header" &&
    parameter.name.toLowerCase() === "authorization" &&
    auth === "required"
  ) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} header parameter ${JSON.stringify(parameter.name)} is managed by the HTTP transport and cannot be generated as a command parameter.`
    );
  }

  const context = `parameter ${JSON.stringify(parameter.name)}`;
  const schema =
    parameter.in === "query" && parameter.style === "deepObject"
      ? resolveBodySchema(document, parameter.schema, operationId, context)
      : expectSchema(document, parameter.schema, operationId, context);

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

  if (
    parameter.in === "query" &&
    parameter.style === "deepObject" &&
    (getCompositionKeyword(schema) !== undefined ||
      (schema.type === "array" &&
        schema.items !== undefined &&
        isComplexJsonBodySchema(
          document,
          schema.items as OpenApiSchemaObject,
          operationId,
          `${context} items`
        )))
  ) {
    return createJsonQueryField({
      document,
      name: parameter.name,
      description: parameter.description ?? schema.description,
      schema,
      optional: parameter.required !== true,
      operationId,
      context,
      location: "query",
      queryObjectSerialization: resolveQueryObjectSerialization(parameter, operationId)
    });
  }

  const querySerialization =
    parameter.in === "query" && schema.type === "array"
      ? resolveQueryArraySerialization(parameter, operationId)
      : undefined;
  const generated = createField({
    document,
    name: parameter.name,
    description: parameter.description ?? schema.description,
    schema,
    optional: parameter.required !== true,
    operationId,
    context,
    location: parameter.in,
    querySerialization,
    queryObjectSerialization:
      parameter.in === "query" && schema.type === "object"
        ? resolveQueryObjectSerialization(parameter, operationId)
        : undefined
  });
  if (querySerialization === "brackets") {
    generated.requestField.wireName = `${parameter.name}[]`;
  }
  return generated;
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
  if (
    shouldUseJsonBodyField(
      document,
      schema,
      operationId,
      `request body field ${JSON.stringify(name)}`
    )
  ) {
    return createJsonBodyField({
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

function shouldUseJsonBodyField(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): boolean {
  if (isUnconstrainedJsonSchema(schema)) {
    return true;
  }

  if (getCompositionKeyword(schema) !== undefined || Array.isArray(schema.type)) {
    return true;
  }

  if (schema.type === "object") {
    return typeof schema.additionalProperties === "object";
  }

  if (schema.properties !== undefined || schema.additionalProperties !== undefined) {
    return true;
  }

  if (schema.type !== "array" || schema.items === undefined) {
    return false;
  }

  const itemSchema = resolveBodySchema(document, schema.items, operationId, `${context} items`);
  return shouldUseJsonBodyField(document, itemSchema, operationId, `${context} items`);
}

function isComplexJsonBodySchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): boolean {
  if (isUnconstrainedJsonSchema(schema)) {
    return true;
  }

  if (
    schema.type === "object" ||
    schema.properties !== undefined ||
    schema.additionalProperties !== undefined ||
    getCompositionKeyword(schema) !== undefined ||
    Array.isArray(schema.type)
  ) {
    return true;
  }

  if (schema.type !== "array" || schema.items === undefined) {
    return false;
  }

  const itemSchema = resolveBodySchema(document, schema.items, operationId, `${context} items`);
  return isComplexJsonBodySchema(document, itemSchema, operationId, `${context} items`);
}

function isUnconstrainedJsonSchema(schema: OpenApiSchemaObject): boolean {
  return (
    schema.type === undefined &&
    schema.enum === undefined &&
    schema.properties === undefined &&
    schema.additionalProperties === undefined &&
    schema.allOf === undefined &&
    schema.anyOf === undefined &&
    schema.oneOf === undefined
  );
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

function createScalarOnlyParameterError(
  name: string,
  operationId: string,
  location: "path" | "header"
): never {
  throw new UserError(
    `Operation ${JSON.stringify(operationId)} ${location} parameter ${JSON.stringify(name)} must use a scalar schema (string, number, integer, or boolean).`
  );
}

function createJsonBodyField(options: CreateFieldOptions): GeneratedParameterAssembly {
  return {
    params: [
      {
        paramName: options.name,
        sourceName: options.name,
        location: "body",
        description: options.description,
        optional: options.optional,
        definition: { kind: "json" }
      }
    ],
    preflightBlocks: [],
    requestField: {
      location: "body",
      wireName: options.name,
      value: { kind: "reference", reference: { kind: "param", paramName: options.name } },
      omitWhenUndefinedReference: { kind: "param", paramName: options.name }
    }
  };
}

function createJsonQueryField(options: CreateFieldOptions): GeneratedParameterAssembly {
  if (options.queryObjectSerialization !== "deepObject") {
    throw new ToolcraftBugError(
      "Missing deep-object serialization for generated JSON query field."
    );
  }

  return {
    params: [
      {
        paramName: options.name,
        sourceName: options.name,
        location: "query",
        description: options.description,
        optional: options.optional,
        definition: { kind: "json" }
      }
    ],
    preflightBlocks: [],
    requestField: {
      location: "query",
      wireName: options.name,
      value: { kind: "reference", reference: { kind: "param", paramName: options.name } },
      omitWhenUndefinedReference: { kind: "param", paramName: options.name }
    }
  };
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
        definition: directDefinition as Extract<GeneratedParamDefinition, { kind: "array" }>,
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
      createScalarParam({
        ...options,
        location: "body"
      }),
    scalar: (options: CreateFieldOptions) =>
      createScalarParam({
        ...options,
        location: "body"
      })
  },
  header: {
    array: (options: CreateFieldOptions) =>
      createScalarOnlyParameterError(options.name, options.operationId, "header"),
    object: (options: CreateFieldOptions) =>
      createScalarOnlyParameterError(options.name, options.operationId, "header"),
    scalar: (options: CreateFieldOptions) =>
      createScalarParam({
        ...options,
        location: "header"
      })
  },
  path: {
    array: (options: CreateFieldOptions) => createPathArrayParam(options),
    object: (options: CreateFieldOptions) =>
      createScalarOnlyParameterError(options.name, options.operationId, "path"),
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
    object: (options: CreateFieldOptions) => createJsonQueryField(options),
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

function createPathArrayParam(options: CreateFieldOptions): GeneratedParameterAssembly {
  const definition = createParamDefinition(
    options.document,
    options.schema,
    options.operationId,
    options.context
  );
  const paramName = options.name;

  return {
    params: [
      {
        paramName,
        sourceName: options.name,
        location: "path",
        description: options.description,
        optional: false,
        definition
      }
    ],
    preflightBlocks: [],
    requestField: {
      location: "path",
      wireName: options.name,
      value: {
        kind: "queryArray",
        reference: { kind: "param", paramName },
        serialization: "comma"
      },
      omitWhenUndefinedReference: { kind: "param", paramName }
    }
  };
}

function expectQueryArraySerialization(
  querySerialization: QueryArraySerialization | undefined
): QueryArraySerialization {
  if (querySerialization === undefined) {
    throw new ToolcraftBugError(
      "Missing query array serialization for generated query array field."
    );
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
  paramsSchemaOptions: GeneratedObjectSchemaOptions | undefined,
  bodyMode: "json" | "form" | "raw" | "base64" | "multipart",
  multipartBinaryFields?: readonly string[]
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
    requestBodyDescription,
    bodyMode,
    ...(multipartBinaryFields === undefined ? {} : { multipartBinaryFields })
  };
}

function createParamDefinition(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): GeneratedParamDefinition {
  if (Array.isArray(schema.type)) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. JSON Schema type arrays with multiple non-null types are not supported in v1.`
    );
  }

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

  if (schema.type === "object") {
    return {
      kind: "object",
      properties: createObjectPropertyDefinitions(document, schema, operationId, context),
      additionalProperties: schema.additionalProperties !== false,
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
      ...(schema.nullable === true ? { nullable: true } : {})
    };
  }

  const scalarDefinition = isOpenApiScalarType(schema.type)
    ? SCHEMA_TYPE_TO_KIND[schema.type]
    : undefined;
  const enumValues = normalizeEnumValues(schema.enum, operationId, context);

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

function createObjectPropertyDefinitions(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): GeneratedObjectPropertyDefinition[] {
  const required = new Set(schema.required ?? []);
  const properties: GeneratedObjectPropertyDefinition[] = [];

  for (const [name, property] of Object.entries(schema.properties ?? {})) {
    const propertySchema = resolveBodySchema(
      document,
      property,
      operationId,
      `${context}.properties.${name}`
    );

    if (propertySchema.readOnly === true) {
      continue;
    }

    properties.push({
      name,
      optional: !required.has(name),
      definition: shouldUseJsonBodyField(
        document,
        propertySchema,
        operationId,
        `${context}.properties.${name}`
      )
        ? {
            kind: "json",
            ...(propertySchema.nullable === true ? { nullable: true } : {})
          }
        : createParamDefinition(
            document,
            propertySchema,
            operationId,
            `${context}.properties.${name}`
          )
    });
  }

  return properties;
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
  return (
    normalized === "*/*" ||
    normalized === "text/json" ||
    normalized.includes("application/json") ||
    normalized.includes("+json")
  );
}

function isTextMediaType(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return (
    normalized.startsWith("text/") ||
    normalized === "plain/text" ||
    normalized === "application/jwt"
  );
}

function isBinaryMediaType(mediaType: string): boolean {
  const normalized = mediaType.toLowerCase();
  return (
    normalized === "application/octet-stream" ||
    normalized === "application/zip" ||
    normalized === "application/gzip" ||
    normalized === "application/pdf"
  );
}

function normalizeEnumValues(
  enumValues: unknown[] | undefined,
  operationId: string,
  context: string
): readonly [GeneratedEnumValue, ...GeneratedEnumValue[]] | undefined {
  if (enumValues === undefined) {
    return undefined;
  }

  const filteredValues = enumValues.filter(isEnumPrimitiveValue);

  if (filteredValues.length === 0) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Enum values cannot be empty.`
    );
  }

  const primitiveTypes = new Set(filteredValues.map((value) => typeof value));

  if (primitiveTypes.size > 1) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Enums must not mix primitive types.`
    );
  }

  return filteredValues.filter((value) => value !== null) as unknown as readonly [
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
    if (
      typeof current !== "object" ||
      current === null ||
      !Object.prototype.hasOwnProperty.call(current, segment)
    ) {
      throw new UserError(
        `Operation ${JSON.stringify(operationId)} references missing $ref ${JSON.stringify(ref)} in ${context}.`
      );
    }

    current = (current as Record<string, unknown>)[segment];
  }

  return current;
}

function unescapeJsonPointerSegment(segment: string): string {
  const unescaped = segment.replaceAll("~1", "/").replaceAll("~0", "~");

  try {
    return decodeURIComponent(unescaped);
  } catch {
    return unescaped;
  }
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

  if (parameter.in !== "path" && parameter.in !== "query" && parameter.in !== "header") {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported parameter location ${JSON.stringify(parameter.in)}. Only path, query, and header parameters are supported in v1; use auth or handwritten commands for cookies.`
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

function isOpenApiScalarType(type: OpenApiSchemaObject["type"]): type is OpenApiScalarType {
  return (
    typeof type === "string" && Object.prototype.hasOwnProperty.call(SCHEMA_TYPE_TO_KIND, type)
  );
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
  const resolvedSchema = normalizeNullableSchema(
    document,
    resolveSchema(document, schema, operationId, context, refChain),
    operationId,
    context
  );
  const compositionKeyword = getCompositionKeyword(resolvedSchema);

  if (compositionKeyword !== undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. JSON Schema composition keyword ${JSON.stringify(compositionKeyword)} is not supported in v1.`
    );
  }

  return resolvedSchema;
}

function resolveBodySchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject | OpenApiReferenceObject | undefined,
  operationId: string,
  context: string
): OpenApiSchemaObject {
  return normalizeNullableSchema(
    document,
    resolveSchema(document, schema, operationId, context),
    operationId,
    context
  );
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
    const resolved = resolveLocalReference(document, schema.$ref, operationId, context) as
      | OpenApiSchemaObject
      | OpenApiReferenceObject
      | { schema?: OpenApiSchemaObject | OpenApiReferenceObject };
    const nestedSchema = isSchemaContainer(resolved) ? resolved.schema : resolved;
    return resolveSchema(
      document,
      nestedSchema as OpenApiSchemaObject | OpenApiReferenceObject,
      operationId,
      context,
      [...refChain, schema.$ref]
    );
  }

  return cloneOwnSchemaObject(schema);
}

function cloneOwnSchemaObject(schema: OpenApiSchemaObject): OpenApiSchemaObject {
  const clone = Object.create(null) as OpenApiSchemaObject;

  for (const [key, value] of Object.entries(schema)) {
    Object.defineProperty(clone, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return clone;
}

function isSchemaContainer(
  value:
    | OpenApiSchemaObject
    | OpenApiReferenceObject
    | { schema?: OpenApiSchemaObject | OpenApiReferenceObject }
): value is { schema: OpenApiSchemaObject | OpenApiReferenceObject } {
  return !isReferenceObject(value) && "schema" in value && value.schema !== undefined;
}

function normalizeNullableSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): OpenApiSchemaObject {
  const typeNormalizedSchema = normalizeNullableTypeArray(schema);
  const equivalentComposition = resolveEquivalentCompositionSchema(
    document,
    typeNormalizedSchema,
    operationId,
    context
  );

  if (equivalentComposition !== undefined) {
    return equivalentComposition;
  }

  if (getCompositionKeyword(typeNormalizedSchema) !== "anyOf") {
    return typeNormalizedSchema;
  }

  return (
    resolveNullableAnyOfSchema(document, typeNormalizedSchema, operationId, context) ??
    typeNormalizedSchema
  );
}

function resolveEquivalentCompositionSchema(
  document: OpenApiDocument,
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): OpenApiSchemaObject | undefined {
  const keyword = getCompositionKeyword(schema);
  if (keyword !== "anyOf" && keyword !== "oneOf") {
    return undefined;
  }

  const variants = schema[keyword];
  if (variants === undefined || variants.length === 0) {
    return undefined;
  }

  const resolved = variants.map((variant, index) =>
    normalizeNullableSchema(
      document,
      resolveSchema(document, variant, operationId, `${context} ${keyword} variant ${index}`),
      operationId,
      `${context} ${keyword} variant ${index}`
    )
  );
  const shapes = resolved.map(getEquivalentSchemaShape);
  const [firstShape] = shapes;
  if (firstShape === undefined || shapes.some((shape) => shape !== firstShape)) {
    return undefined;
  }

  const { anyOf: _anyOf, oneOf: _oneOf, ...wrapper } = schema;
  void _anyOf;
  void _oneOf;
  const enumValues = collectEquivalentCompositionEnumValues(resolved);
  return {
    ...wrapper,
    ...createSchemaFromEquivalentShape(firstShape),
    ...(enumValues === undefined ? {} : { enum: enumValues })
  };
}

function getEquivalentSchemaShape(schema: OpenApiSchemaObject): string | undefined {
  if (getCompositionKeyword(schema) !== undefined || Array.isArray(schema.type)) {
    return undefined;
  }
  if (schema.type === "array") {
    if (schema.items === undefined || isReferenceObject(schema.items)) return undefined;
    const itemShape = getEquivalentSchemaShape(schema.items);
    return itemShape === undefined ? undefined : `array:${itemShape}`;
  }
  return isOpenApiScalarType(schema.type) ? schema.type : undefined;
}

function createSchemaFromEquivalentShape(shape: string): OpenApiSchemaObject {
  if (!shape.startsWith("array:")) {
    return { type: shape as OpenApiScalarType };
  }
  return { type: "array", items: createSchemaFromEquivalentShape(shape.slice("array:".length)) };
}

function collectEquivalentCompositionEnumValues(
  schemas: readonly OpenApiSchemaObject[]
): unknown[] | undefined {
  if (schemas.some((schema) => schema.enum === undefined)) {
    return undefined;
  }

  const values: unknown[] = [];
  for (const schema of schemas) {
    for (const value of schema.enum ?? []) {
      if (!values.some((existing) => Object.is(existing, value))) {
        values.push(value);
      }
    }
  }

  return values.length === 0 ? undefined : values;
}

function normalizeNullableTypeArray(schema: OpenApiSchemaObject): OpenApiSchemaObject {
  if (!Array.isArray(schema.type)) {
    return schema;
  }

  const nonNullTypes = schema.type.filter((type) => type !== "null");

  if (nonNullTypes.length === schema.type.length) {
    return schema;
  }

  return {
    ...schema,
    type: nonNullTypes.length === 1 ? nonNullTypes[0] : nonNullTypes,
    nullable: true
  };
}

function getCompositionKeyword(
  schema: OpenApiSchemaObject
): "allOf" | "anyOf" | "oneOf" | undefined {
  for (const keyword of ["allOf", "anyOf", "oneOf"] as const) {
    if (Object.prototype.hasOwnProperty.call(schema, keyword) && schema[keyword] !== undefined) {
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
    normalizeNullableSchema(
      document,
      resolveSchema(document, variant, operationId, `${context} anyOf variant ${index}`),
      operationId,
      `${context} anyOf variant ${index}`
    )
  );
  const nullVariantIndex = resolvedVariants.findIndex(isExplicitNullSchema);

  if (nullVariantIndex === -1) {
    return undefined;
  }

  const nonNullVariant = resolvedVariants[Number(!nullVariantIndex)];

  if (nonNullVariant === undefined || getCompositionKeyword(nonNullVariant) !== undefined) {
    return undefined;
  }

  const { anyOf: _anyOf, nullable: _nullable, ...wrapperSchema } = schema;
  void _anyOf;
  void _nullable;

  return {
    ...wrapperSchema,
    ...nonNullVariant,
    description: nonNullVariant.description ?? schema.description,
    default: nonNullVariant.default ?? schema.default,
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

function disambiguateCommandPaths(commands: GeneratedCommand[]): void {
  const byCommandPath = new Map<string, GeneratedCommand[]>();

  for (const command of commands) {
    const key = `${command.noun} ${command.verb}`;
    byCommandPath.set(key, [...(byCommandPath.get(key) ?? []), command]);
  }

  for (const collisions of byCommandPath.values()) {
    if (collisions.length < 2) {
      continue;
    }

    const existingPaths = new Set(
      commands
        .filter((command) => !collisions.includes(command))
        .map((command) => `${command.noun} ${command.verb}`)
    );
    const operationIdCandidates = collisions.map((command) => ({
      command,
      verb: deriveDisambiguatedVerb(command.operationId, command.noun)
    }));

    if (applyDisambiguatedVerbs(operationIdCandidates, existingPaths)) {
      continue;
    }

    const pathCandidates = collisions.map((command) => ({
      command,
      verb: derivePathDisambiguatedVerb(
        command.method.toLowerCase() as HttpMethod,
        command.path,
        command.noun,
        command.verb
      )
    }));

    if (applyDisambiguatedVerbs(pathCandidates, existingPaths)) {
      continue;
    }

    if (
      applyDisambiguatedVerbs(
        collisions.map((command) => ({
          command,
          verb: derivePathDisambiguatedVerb(
            command.method.toLowerCase() as HttpMethod,
            command.path,
            command.noun,
            command.verb,
            true
          )
        })),
        existingPaths
      )
    ) {
      continue;
    }

    applyDisambiguatedVerbs(
      collisions.map((command) => ({
        command,
        verb: derivePathDisambiguatedVerb(
          command.method.toLowerCase() as HttpMethod,
          command.path,
          command.noun,
          command.verb,
          true,
          true
        )
      })),
      existingPaths
    );
  }
}

function applyDisambiguatedVerbs(
  candidates: Array<{ command: GeneratedCommand; verb: string }>,
  existingPaths: ReadonlySet<string>
): boolean {
  const candidatePaths = candidates.map(({ command, verb }) => `${command.noun} ${verb}`);

  if (
    candidates.some(({ verb }) => verb.length === 0) ||
    new Set(candidatePaths).size !== candidatePaths.length ||
    candidatePaths.some((path) => existingPaths.has(path))
  ) {
    return false;
  }

  for (const { command, verb } of candidates) {
    command.verb = verb;
    command.exportName = `${toCamelCase(command.noun)}${toPascalCase(verb)}Command`;
    command.filePath = `${command.noun}/${verb}.ts`;
  }

  return true;
}

function createCommandFile(options: {
  operationId: string;
  noun: string;
  verb: string;
  exportName: string;
  description?: string;
  examples?: GeneratedCommandExample[];
  method: string;
  path: string;
  auth: "required" | "none";
  responseMode: "json" | "text" | "binary";
  accept: string;
  baseUrl?: string;
  bodyMode?: "json" | "form" | "raw" | "base64" | "multipart";
  contentType?: string;
  multipartBinaryFields?: readonly string[];
  idempotencyHeader?: string;
  rawResponse?: boolean;
  params: GeneratedParam[];
  paramsSchemaOptions?: GeneratedObjectSchemaOptions;
  preflightBlocks: GeneratedPreflightBlock[];
  requestFields: GeneratedRequestField[];
  sectionRenders: GeneratedRequestSectionRenders;
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
  confirm: boolean;
  positional: string[];
}): string {
  const requiresUserError = options.preflightBlocks.length > 0;
  const usesMultipartFileInputs =
    options.bodyMode === "multipart" &&
    options.multipartBinaryFields !== undefined &&
    options.multipartBinaryFields.length > 0;
  const usesArrayJsonValidation = options.preflightBlocks.some((block) => block.kind === "array");
  const usesBinaryOutput = options.responseMode === "binary";
  const usesRequestShapeVariable = usesMultipartFileInputs || usesBinaryOutput;
  const openApiImports = [
    "requestJson",
    "defineApiCommand",
    ...(usesArrayJsonValidation ? ["validateArrayJsonHelperValue"] : []),
    ...(usesMultipartFileInputs ? ["prepareMultipartFileInputs"] : []),
    ...(usesBinaryOutput ? ["writeBinaryResponseOutput"] : [])
  ];
  const lines = createGeneratedTypeScriptFileLines([`operation-id: ${options.operationId}`]);
  lines.push(
    requiresUserError
      ? 'import { S, UserError } from "toolcraft";'
      : 'import { S } from "toolcraft";',
    `import { ${openApiImports.join(", ")} } from "toolcraft-openapi";`,
    "",
    `export const ${options.exportName} = defineApiCommand({`,
    `  name: ${JSON.stringify(options.verb)},`
  );

  if (options.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(options.description)},`);
  }
  if (options.examples !== undefined && options.examples.length > 0) {
    lines.push(`  examples: ${JSON.stringify(options.examples)},`);
  }

  lines.push('  scope: ["cli", "mcp", "sdk"] as const,');
  if (options.confirm) {
    lines.push("  confirm: true,");
  }
  if (options.positional.length > 0) {
    lines.push(`  positional: ${JSON.stringify(options.positional)},`);
  }
  lines.push("  params: S.Object({");
  lines.push(...renderParamLines(options.params));
  lines.push(
    options.paramsSchemaOptions?.additionalProperties === false
      ? "  }, { additionalProperties: false }),"
      : "  }),"
  );
  lines.push(
    usesRequestShapeVariable
      ? "  handler: async ({ params, baseUrl, tokenSource, fetch, fs, env, diagnostics }) => {"
      : "  handler: async ({ params, baseUrl, tokenSource, fetch, diagnostics }) => {"
  );
  lines.push(...options.preflightBlocks.flatMap((block) => renderPreflightBlock(block)));
  if (usesRequestShapeVariable) {
    lines.push("    const requestShape = {");
    lines.push(
      ...renderRequestShape(options.requestFields, options.sectionRenders, options.optionalSections)
    );
    lines.push("    };");

    if (usesMultipartFileInputs) {
      lines.push(
        "    const preparedRequestShape = await prepareMultipartFileInputs(requestShape, {"
      );
      lines.push('      bodyMode: "multipart",');
      lines.push(`      multipartBinaryFields: ${JSON.stringify(options.multipartBinaryFields)},`);
      lines.push("      fs,");
      lines.push("      env,");
      lines.push("    });");
    } else {
      lines.push("    const preparedRequestShape = requestShape;");
    }

    lines.push("    const result = await requestJson({");
  } else {
    lines.push("    return requestJson({");
  }
  lines.push(
    options.baseUrl === undefined
      ? "      baseUrl,"
      : `      baseUrl: ${JSON.stringify(options.baseUrl)},`
  );
  lines.push(`      path: ${JSON.stringify(options.path)},`);
  lines.push(`      method: ${JSON.stringify(options.method)},`);
  lines.push(`      auth: ${JSON.stringify(options.auth)},`);
  if (options.responseMode !== "json") {
    lines.push(`      responseMode: ${JSON.stringify(options.responseMode)},`);
  }
  if (options.accept !== "application/json") {
    lines.push(`      accept: ${JSON.stringify(options.accept)},`);
  }
  if (options.bodyMode === "form") {
    lines.push('      bodyMode: "form",');
  } else if (options.bodyMode === "raw") {
    lines.push('      bodyMode: "raw",');
  } else if (options.bodyMode === "base64") {
    lines.push('      bodyMode: "base64",');
  } else if (options.bodyMode === "multipart") {
    lines.push('      bodyMode: "multipart",');
  }
  if (options.multipartBinaryFields !== undefined) {
    lines.push(`      multipartBinaryFields: ${JSON.stringify(options.multipartBinaryFields)},`);
  }
  if (options.contentType !== undefined) {
    lines.push(`      contentType: ${JSON.stringify(options.contentType)},`);
  }
  lines.push("      tokenSource,");
  lines.push("      fetch,");
  lines.push("      diagnostics,");
  if (options.rawResponse === true) {
    lines.push("      rawResponse: params.rawResponse,");
  }
  if (options.idempotencyHeader !== undefined) {
    lines.push("      idempotency: {");
    lines.push(`        header: ${JSON.stringify(options.idempotencyHeader)},`);
    lines.push("        enabled: true,");
    lines.push("        key: params.idempotencyKey,");
    lines.push("      },");
  }
  if (usesRequestShapeVariable) {
    lines.push("      ...preparedRequestShape,");
  } else {
    lines.push(
      ...renderRequestShape(options.requestFields, options.sectionRenders, options.optionalSections)
    );
  }
  lines.push("    });");
  if (usesBinaryOutput) {
    lines.push("    return writeBinaryResponseOutput(result, params.output, { fs, env });");
  }
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
      if (
        definedSchemes !== undefined &&
        Object.prototype.hasOwnProperty.call(definedSchemes, schemeName)
      ) {
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
  for (const method of UNSUPPORTED_HTTP_METHODS) {
    const operation = getOwnPathItemValue(pathItem, method);

    if (operation === undefined) {
      continue;
    }

    throw new UserError(
      `Operation ${JSON.stringify(getOperationId(path, method, operation))} uses unsupported HTTP method ${JSON.stringify(method.toUpperCase())}. Supported in v1: GET, POST, PUT, PATCH, DELETE, HEAD, OPTIONS.`
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
    param.longAliases,
    param.scope,
    param.global
  );
  return param.optional ? `S.Optional(${schema})` : schema;
}

function renderDefinition(
  definition: GeneratedParamDefinition,
  description?: string,
  shortFlag?: string,
  longAliases?: string[],
  scope?: readonly [GeneratedParamScope, ...GeneratedParamScope[]],
  global?: boolean
): string {
  const options = renderSchemaOptions({
    definition,
    description,
    shortFlag,
    longAliases,
    scope,
    global
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
  json: (_definition: GeneratedJsonParamDefinition) => renderSchemaCall("S.Json"),
  number: (_definition: GeneratedScalarParamDefinition, options?: string) =>
    renderSchemaCall("S.Number", options),
  object: (definition: GeneratedObjectParamDefinition, options?: string) =>
    renderSchemaCall("S.Object", renderObjectDefinitionShape(definition), options),
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

function renderObjectDefinitionShape(definition: GeneratedObjectParamDefinition): string {
  if (definition.properties.length === 0) {
    return "{}";
  }

  return `{ ${definition.properties.map(renderObjectDefinitionProperty).join(", ")} }`;
}

function renderObjectDefinitionProperty(property: GeneratedObjectPropertyDefinition): string {
  const schema = renderDefinition(property.definition, undefined, undefined, undefined);
  return `${renderObjectKey(property.name)}: ${property.optional ? `S.Optional(${schema})` : schema}`;
}

function renderObjectKey(name: string): string {
  if (name === "__proto__") {
    return `[${JSON.stringify(name)}]`;
  }

  if (name === normalizeParamName(name) && isIdentifierName(name)) {
    return name;
  }

  return JSON.stringify(name);
}

function createSafeGeneratedNoun(noun: string): string {
  const normalized = normalizeNoun(noun);
  return isTypeScriptIdentifier(toCamelCase(normalized))
    ? normalized
    : `api-${normalized || "operation"}`;
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

  if (style === "deepObject" && explode === true) {
    return "brackets";
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported query-array serialization for parameter ${JSON.stringify(parameter.name)}. Supported in v1: form (explode true/false) and pipeDelimited.`
  );
}

function resolveQueryObjectSerialization(
  parameter: SupportedOpenApiParameterObject,
  operationId: string
): "deepObject" {
  if (parameter.style === "deepObject" && parameter.explode !== false) {
    return "deepObject";
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported query-object serialization for parameter ${JSON.stringify(parameter.name)}. Supported in v1: deepObject with explode true.`
  );
}

function collectTagDescriptions(document: OpenApiDocument): Map<string, string> {
  const descriptions = new Map<string, string>();

  for (const tag of document.tags ?? []) {
    if (typeof tag.name !== "string" || tag.name.length === 0) {
      continue;
    }
    if (typeof tag.description !== "string" || tag.description.trim().length === 0) {
      continue;
    }
    descriptions.set(normalizeNoun(tag.name), tag.description.trim());
  }

  return descriptions;
}

function createIndexFile(commands: GeneratedCommand[], document: OpenApiDocument): GeneratedFile {
  const groups = groupByNoun(commands);
  const tagDescriptions = collectTagDescriptions(document);

  if (groups.length === 0) {
    return {
      path: "index.ts",
      contents: createGeneratedTypeScriptFile(["export const generatedCommands = [] as const;", ""])
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
    const description = tagDescriptions.get(noun);
    lines.push(`export const ${toCamelCase(noun)} = defineGroup({`);
    lines.push(`  name: ${JSON.stringify(noun)},`);
    if (description !== undefined) {
      lines.push(`  description: ${JSON.stringify(description)},`);
    }
    lines.push(`  children: [${nounCommands.map((command) => command.exportName).join(", ")}],`);
    lines.push("});");
    lines.push("");
  }

  lines.push(
    `export const generatedCommands = [${groups.map(({ noun }) => toCamelCase(noun)).join(", ")}] as const;`
  );
  lines.push("");

  return {
    path: "index.ts",
    contents: lines.join("\n")
  };
}

function createClientFile(): GeneratedFile {
  return {
    path: "client.ts",
    contents: createGeneratedTypeScriptFile([
      'import { defineClient, type DefineClientOptions } from "toolcraft-openapi";',
      'import { generatedCommands } from "./index.js";',
      "",
      'export type GeneratedClientOptions = Omit<DefineClientOptions<object>, "commands">;',
      "",
      "export function defineGeneratedClient(options: GeneratedClientOptions) {",
      "  return defineClient<object>({",
      "    ...options,",
      "    commands: [...generatedCommands],",
      "  });",
      "}",
      ""
    ])
  };
}

function createCliFile(theme: { brand: string; label: string }): GeneratedFile {
  return {
    path: "cli.ts",
    contents: [
      "#!/usr/bin/env node",
      ...createGeneratedTypeScriptFileLines(),
      'import { configureTheme, runCLI, type RunCLIOptions } from "toolcraft/cli";',
      'import type { OpenApiClientServices } from "toolcraft-openapi";',
      'import { defineGeneratedClient, type GeneratedClientOptions } from "./client.js";',
      "",
      "export type GeneratedCLIOptions = GeneratedClientOptions &",
      '  Omit<RunCLIOptions<OpenApiClientServices>, "services">;',
      "",
      "export async function runGeneratedCLI(options: GeneratedCLIOptions) {",
      "  const client = defineGeneratedClient(options);",
      `  configureTheme({ brand: ${JSON.stringify(theme.brand)}, label: ${JSON.stringify(theme.label)} });`,
      "",
      "  await runCLI(client.root, {",
      "    ...options,",
      "    services: client.services,",
      "  });",
      "}",
      ""
    ].join("\n")
  };
}

function createMcpFile(): GeneratedFile {
  return {
    path: "mcp.ts",
    contents: [
      "#!/usr/bin/env node",
      ...createGeneratedTypeScriptFileLines(),
      'import { runMCP, type RunMCPOptions } from "toolcraft/mcp";',
      'import type { OpenApiClientServices } from "toolcraft-openapi";',
      'import { defineGeneratedClient, type GeneratedClientOptions } from "./client.js";',
      "",
      "export type GeneratedMCPOptions = GeneratedClientOptions &",
      '  Omit<RunMCPOptions<OpenApiClientServices>, "name" | "services">;',
      "",
      "export async function runGeneratedMCP(options: GeneratedMCPOptions) {",
      "  const client = defineGeneratedClient(options);",
      "",
      "  await runMCP(client.root, {",
      "    ...options,",
      "    name: client.name,",
      "    services: client.services,",
      "  });",
      "}",
      ""
    ].join("\n")
  };
}

function createSkill(options: {
  commands: GeneratedCommand[];
  commandName?: string;
  label: string;
}): GeneratedSkill {
  const commandName = options.commandName ?? "<cli>";
  const groups = groupByNoun(options.commands);
  const skillName = createSkillName(options.commandName ?? options.label);
  const description = createSkillDescription(
    options.label,
    groups.map((group) => group.noun)
  );
  const quickStartCommands = collectQuickStartCommands(commandName, options.commands);
  const lines = [
    "---",
    `name: ${skillName}`,
    `description: ${JSON.stringify(description)}`,
    "---",
    "",
    `# ${options.label}`,
    "",
    `Use \`${commandName}\` for CLI examples. If MCP tools from this package are registered, prefer them for structured calls; their names mirror the command groups and verbs below.`,
    "",
    "## Quick Start",
    "",
    "```sh",
    `${commandName} --help`,
    ...quickStartCommands,
    "```",
    "",
    "## Command Groups",
    ""
  ];

  if (groups.length === 0) {
    lines.push("No OpenAPI operations were generated.", "");
  } else {
    for (const group of groups) {
      lines.push(
        `- \`${group.noun}\`: ${group.commands.map((command) => `\`${command.verb}\``).join(", ")}`
      );
    }
    lines.push("");
  }

  const catalogCommands = options.commands.slice(0, 80);
  if (catalogCommands.length > 0) {
    lines.push("## Commands", "");
    for (const command of catalogCommands) {
      lines.push(renderSkillCommandCatalogLine(commandName, command));
    }

    const omittedCount = options.commands.length - catalogCommands.length;
    if (omittedCount > 0) {
      lines.push(
        `- ${omittedCount} more commands omitted. Run \`${commandName} --help\` and group help for the full surface.`
      );
    }
    lines.push("");
  }

  const exampleBlocks = options.commands.flatMap((command) =>
    (command.examples ?? []).map((example) => ({ command, example }))
  );
  if (exampleBlocks.length > 0) {
    lines.push("## Examples", "");
    for (const { command, example } of exampleBlocks.slice(0, 5)) {
      lines.push(`### ${oneLine(example.title)}`, "");
      lines.push("```sh", renderSkillCommandLine(commandName, command), "```", "");
      lines.push("Params:");
      lines.push("```json", `${JSON.stringify(example.params, null, 2)}`, "```", "");
    }
  }

  lines.push(
    "## Output",
    "",
    "Commands return structured output. Use command or group `--help` to inspect the full generated option list before calling commands with complex request bodies.",
    ""
  );

  return {
    name: skillName,
    contents: lines.join("\n")
  };
}

function createSkillName(label: string): string {
  const normalized = normalizeNoun(label);
  const fallback = normalized.length === 0 ? "openapi-tools" : normalized;
  if (fallback.length <= 63) {
    return fallback;
  }

  return trimTrailingHyphens(fallback.slice(0, 63));
}

function createSkillDescription(label: string, groupNames: string[]): string {
  const groupSummary =
    groupNames.length === 0
      ? ""
      : ` Includes command groups: ${groupNames.slice(0, 12).join(", ")}${groupNames.length > 12 ? ", and more" : ""}.`;

  return `Use ${label} generated OpenAPI CLI or MCP tools. Use when Codex needs to call this API, inspect available commands, or run generated operations from the OpenAPI specification.${groupSummary}`;
}

function collectQuickStartCommands(commandName: string, commands: GeneratedCommand[]): string[] {
  const lines: string[] = [];
  const firstGroup = groupByNoun(commands)[0];
  if (firstGroup !== undefined) {
    lines.push(`${commandName} ${firstGroup.noun} --help`);
  }

  for (const command of commands) {
    if (lines.length >= 4) {
      break;
    }

    if (!isReadCommand(command)) {
      continue;
    }

    const requiredNamedParams = command.params.filter(
      (param) =>
        !param.optional &&
        param.global !== true &&
        param.location !== "transport" &&
        !command.positional.includes(param.paramName)
    );

    if (requiredNamedParams.length === 0) {
      lines.push(renderSkillCommandLine(commandName, command));
    }
  }

  return lines;
}

function isReadCommand(command: GeneratedCommand): boolean {
  return command.method === "GET" || command.method === "HEAD" || command.method === "OPTIONS";
}

function renderSkillCommandCatalogLine(commandName: string, command: GeneratedCommand): string {
  const description =
    command.description === undefined ? "" : ` - ${truncate(oneLine(command.description), 140)}`;
  return `- \`${renderSkillCommandLine(commandName, command)}\`${description} (\`${command.method} ${command.path}\`)`;
}

function renderSkillCommandLine(commandName: string, command: GeneratedCommand): string {
  const parts = [
    commandName,
    command.noun,
    command.verb,
    ...command.positional.map((paramName) => `<${paramName}>`)
  ];
  const requiredFlags = command.params.filter(
    (param) =>
      !param.optional &&
      param.global !== true &&
      param.location !== "transport" &&
      !command.positional.includes(param.paramName)
  );
  const renderedFlags = requiredFlags
    .filter((param) => param.definition.kind !== "object")
    .slice(0, 4)
    .map(renderRequiredSkillFlag);
  parts.push(...renderedFlags);

  if (requiredFlags.length > renderedFlags.length) {
    parts.push("[required options...]");
  }

  return parts.join(" ");
}

function renderRequiredSkillFlag(param: GeneratedParam): string {
  const flag = `--${toCliFlag(param.paramName)}`;
  if (param.definition.kind === "boolean") {
    return flag;
  }

  if (param.definition.kind === "array") {
    return `${flag} <value...>`;
  }

  if (param.definition.kind === "enum") {
    return `${flag} <${param.definition.enumValues.map((value) => String(value)).join("|")}>`;
  }

  return `${flag} <value>`;
}

function oneLine(value: string): string {
  const words: string[] = [];
  let current = "";

  for (const character of value) {
    if (isWhitespace(character)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    words.push(current);
  }

  return words.join(" ");
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function trimTrailingHyphens(value: string): string {
  let endIndex = value.length;
  while (endIndex > 0 && value[endIndex - 1] === "-") {
    endIndex -= 1;
  }

  return value.slice(0, endIndex);
}

function isWhitespace(value: string): boolean {
  return value === " " || value === "\n" || value === "\r" || value === "\t" || value === "\f";
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
  return (
    typeof value === "object" &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, "$ref")
  );
}
