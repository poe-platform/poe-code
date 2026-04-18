import { UserError } from "@poe-code/cmdkit";
import {
  deriveNoun,
  deriveVerb,
  normalizeParamName,
  toCamelCase,
  toPascalCase,
  type HttpMethod
} from "./naming.js";

const HTTP_METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;
type OpenApiOperationMap = Partial<Record<HttpMethod, OpenApiOperationObject>>;
type OpenApiParameterLocation = "path" | "query";
type ParamKind = "string" | "number" | "boolean" | "enum";
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
  optional: boolean;
  definition: GeneratedParamDefinition;
}

interface GeneratedParamDefinition {
  kind: ParamKind;
  defaultValue?: unknown;
  enumValues?: ReadonlyArray<string | number | boolean>;
  jsonType?: "integer";
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
    createGeneratedCommand(entry, options.specSha)
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

function createGeneratedCommand(entry: OperationEntry, specSha: string): GeneratedCommand {
  const operationId = entry.operation.operationId ?? `${entry.method.toUpperCase()} ${entry.path}`;
  const noun = deriveNoun(entry.operation, operationId);
  const verb = deriveVerb(entry.method, entry.path, entry.operation, operationId);
  const params = collectParams(entry, operationId);
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
      params,
      optionalSections: collectOptionalRequestSections(entry.operation)
    })
  };
}

function collectParams(entry: OperationEntry, operationId: string): GeneratedParam[] {
  const params = [
    ...collectOperationParameters(
      entry.path,
      entry.pathItem.parameters ?? [],
      entry.operation.parameters ?? [],
      operationId
    ),
    ...collectRequestBodyParams(entry.operation, operationId),
    {
      paramName: "dryRun",
      originalName: "dryRun",
      location: "transport",
      description: "Print the HTTP request and exit without sending it.",
      optional: true,
      definition: { kind: "boolean" }
    } satisfies GeneratedParam,
    {
      paramName: "verbose",
      originalName: "verbose",
      location: "transport",
      description: "Log the request line to stderr.",
      shortFlag: "v",
      optional: true,
      definition: { kind: "boolean" }
    } satisfies GeneratedParam
  ];

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

  return [...deduped.values()].sort((left, right) => left.paramName.localeCompare(right.paramName));
}

function collectOperationParameters(
  path: string,
  pathItemParameters: OpenApiParameter[],
  operationParameters: OpenApiParameter[],
  operationId: string
): GeneratedParam[] {
  const merged = new Map<string, OpenApiParameterObject>();

  for (const parameter of pathItemParameters) {
    const resolved = expectParameter(parameter, operationId);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }

  for (const parameter of operationParameters) {
    const resolved = expectParameter(parameter, operationId);
    merged.set(`${resolved.in}:${resolved.name}`, resolved);
  }

  assertPathTemplateParameters(path, merged, operationId);

  return [...merged.values()].map((parameter) => createGeneratedParameter(parameter, operationId));
}

function collectRequestBodyParams(
  operation: OpenApiOperationObject,
  operationId: string
): GeneratedParam[] {
  if (operation.requestBody === undefined) {
    return [];
  }

  if (isReferenceObject(operation.requestBody)) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses a $ref requestBody, which is not supported yet.`
    );
  }

  const content = operation.requestBody.content?.["application/json"];

  if (content === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define requestBody.content["application/json"] in v1.`
    );
  }

  const schema = expectSchema(content.schema, operationId, "requestBody");

  if (schema.type !== "object" || schema.properties === undefined) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} must define an object-shaped JSON request body.`
    );
  }

  const required = new Set(schema.required ?? []);
  const bodyOptional = operation.requestBody.required !== true;

  return Object.entries(schema.properties).map(([name, property]) => {
    const propertySchema = expectSchema(property, operationId, `requestBody.properties.${name}`);
    return createBodyParameter(
      name,
      propertySchema,
      bodyOptional || !required.has(name),
      operationId
    );
  });
}

function createGeneratedParameter(
  parameter: OpenApiParameterObject,
  operationId: string
): GeneratedParam {
  const schema = expectSchema(parameter.schema, operationId, `parameters.${parameter.name}`);
  const optional = parameter.in === "path" ? false : parameter.required !== true;

  return {
    paramName: normalizeParamName(parameter.name),
    originalName: parameter.name,
    location: parameter.in,
    description: parameter.description ?? schema.description,
    optional,
    definition: createParamDefinition(
      schema,
      operationId,
      `parameter ${JSON.stringify(parameter.name)}`
    )
  };
}

function createBodyParameter(
  name: string,
  schema: OpenApiSchemaObject,
  optional: boolean,
  operationId: string
): GeneratedParam {
  return {
    paramName: normalizeParamName(name),
    originalName: name,
    location: "body",
    description: schema.description,
    optional,
    definition: createParamDefinition(
      schema,
      operationId,
      `request body field ${JSON.stringify(name)}`
    )
  };
}

function createParamDefinition(
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): GeneratedParamDefinition {
  const scalarDefinition =
    schema.type === undefined || !(schema.type in SCHEMA_TYPE_TO_KIND)
      ? undefined
      : SCHEMA_TYPE_TO_KIND[schema.type as OpenApiScalarType];
  const enumValues = normalizeEnumValues(schema.enum);

  if (enumValues !== undefined) {
    return {
      kind: "enum",
      enumValues,
      ...(scalarDefinition?.jsonType === undefined ? {} : { jsonType: scalarDefinition.jsonType }),
      ...(schema.default === undefined ? {} : { defaultValue: schema.default })
    };
  }

  if (scalarDefinition !== undefined) {
    return {
      kind: scalarDefinition.kind,
      ...(scalarDefinition.jsonType === undefined ? {} : { jsonType: scalarDefinition.jsonType }),
      ...(schema.default === undefined ? {} : { defaultValue: schema.default })
    };
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Supported scalar shapes in this milestone are string, number, integer, boolean, and enum.`
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

function normalizeEnumValues(
  enumValues: unknown[] | undefined
): ReadonlyArray<string | number | boolean> | undefined {
  if (enumValues === undefined) {
    return undefined;
  }

  if (
    enumValues.length === 0 ||
    enumValues.some(
      (value) =>
        typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean"
    )
  ) {
    throw new UserError("OpenAPI enums must contain only string, number, or boolean values.");
  }

  return enumValues as ReadonlyArray<string | number | boolean>;
}

function expectParameter(parameter: OpenApiParameter, operationId: string): OpenApiParameterObject {
  if (isReferenceObject(parameter)) {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses a $ref parameter, which is not supported yet.`
    );
  }

  if (parameter.in !== "path" && parameter.in !== "query") {
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses unsupported parameter location ${JSON.stringify(parameter.in)}.`
    );
  }

  return parameter;
}

function expectSchema(
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
    throw new UserError(
      `Operation ${JSON.stringify(operationId)} uses a $ref in ${context}, which is not supported yet.`
    );
  }

  return schema;
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
  operation: OpenApiOperationObject
): Set<Exclude<GeneratedParam["location"], "transport">> {
  const optionalSections = new Set<Exclude<GeneratedParam["location"], "transport">>();

  if (
    operation.requestBody !== undefined &&
    !isReferenceObject(operation.requestBody) &&
    operation.requestBody.required !== true
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
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>;
}): string {
  const lines = [
    "/**",
    " * Generated by @poe-code/cmdkit-openapi.",
    ` * spec-sha: ${options.specSha}`,
    ` * operation-id: ${options.operationId}`,
    " */",
    'import { defineCommand, S } from "@poe-code/cmdkit";',
    'import { requestJson, type OpenApiClientServices } from "@poe-code/cmdkit-openapi";',
    "",
    `export const ${options.exportName} = defineCommand<OpenApiClientServices>({`,
    `  name: ${JSON.stringify(options.verb)},`
  ];

  if (options.description !== undefined) {
    lines.push(`  description: ${JSON.stringify(options.description)},`);
  }

  lines.push('  scope: ["cli", "mcp", "sdk"] as const,');
  lines.push("  params: S.Object({");
  lines.push(...renderParamLines(options.params));
  lines.push("  }),");
  lines.push("  handler: async ({ params, baseUrl, tokenSource, fetch }) => {");
  lines.push("    return requestJson({");
  lines.push("      baseUrl,");
  lines.push(`      path: ${JSON.stringify(options.path)},`);
  lines.push(`      method: ${JSON.stringify(options.method)},`);
  lines.push("      tokenSource,");
  lines.push("      fetch,");
  lines.push("      dryRun: params.dryRun,");
  lines.push("      verbose: params.verbose,");
  lines.push(...renderRequestShape(options.params, options.optionalSections));
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
  const options = renderSchemaOptions(param);

  if (param.definition.kind === "enum") {
    return `S.Enum(${renderConstArray(param.definition.enumValues ?? [])}${options})`;
  }

  const builderName = param.definition.kind[0]?.toUpperCase() + param.definition.kind.slice(1);
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

  if (param.location === "transport") {
    entries.push('scope: ["cli", "sdk"]');
  }

  if (param.definition.jsonType !== undefined) {
    entries.push(`jsonType: ${JSON.stringify(param.definition.jsonType)}`);
  }

  return entries.length === 0 ? "" : `, { ${entries.join(", ")} }`;
}

function renderConstArray(values: ReadonlyArray<string | number | boolean>): string {
  return `${JSON.stringify(values)} as const`;
}

function renderRequestShape(
  params: GeneratedParam[],
  optionalSections: ReadonlySet<Exclude<GeneratedParam["location"], "transport">>
): string[] {
  const lines: string[] = [];

  for (const section of REQUEST_PARAM_SECTIONS) {
    const sectionParams = params.filter((param) => param.location === section.location);
    if (sectionParams.length === 0) {
      continue;
    }

    if (section.omittable && optionalSections.has(section.location)) {
      lines.push(
        `      ...(${sectionParams
          .map((param) => `params.${param.paramName} === undefined`)
          .join(" && ")}`
      );
      lines.push("        ? {}");
      lines.push("        : {");
      lines.push(`            ${section.key}: {`);
      lines.push(
        ...sectionParams.map(
          (param) => `              ${JSON.stringify(param.originalName)}: params.${param.paramName},`
        )
      );
      lines.push("            },");
      lines.push("          }),");
      continue;
    }

    lines.push(`      ${section.key}: {`);
    lines.push(
      ...sectionParams.map(
        (param) => `        ${JSON.stringify(param.originalName)}: params.${param.paramName},`
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
