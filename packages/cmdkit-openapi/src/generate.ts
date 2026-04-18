import { UserError } from "@poe-code/cmdkit";

const HTTP_METHOD_ORDER = ["get", "post", "put", "patch", "delete"] as const;

type HttpMethod = (typeof HTTP_METHOD_ORDER)[number];
type OpenApiOperationMap = Partial<Record<HttpMethod, OpenApiOperationObject>>;
type OpenApiParameterLocation = "path" | "query";
type ParamKind = "string" | "number" | "boolean" | "enum";

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
    createIndexFile(commands),
  ];
}

function collectOperations(paths: Record<string, OpenApiPathItemObject | undefined>): OperationEntry[] {
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
  const params = collectParams(entry, noun, operationId);
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
    }),
  };
}

function deriveNoun(operation: OpenApiOperationObject, operationId: string): string {
  const noun = operation.tags?.[0];

  if (typeof noun !== "string" || noun.length === 0) {
    throw new UserError(`Operation ${JSON.stringify(operationId)} must define tags[0] to derive a command noun.`);
  }

  return toKebabCase(noun);
}

function deriveVerb(
  method: HttpMethod,
  path: string,
  operation: OpenApiOperationObject,
  operationId: string
): string {
  const segments = splitPathSegments(path);
  const actionsIndex = segments.indexOf("actions");

  if (actionsIndex >= 0) {
    const action = segments[actionsIndex + 1];

    if (action !== undefined) {
      return toKebabCase(action);
    }
  }

  const lastSegment = segments.at(-1);
  const lastSegmentIsPathParam = lastSegment !== undefined && isPathTemplateSegment(lastSegment);

  if (method === "get") {
    return lastSegmentIsPathParam ? "view" : "list";
  }

  if (operation.operationId !== undefined) {
    return toKebabCase(operation.operationId);
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} is missing an operationId, so cmdkit-openapi cannot derive a stable command verb.`
  );
}

function collectParams(entry: OperationEntry, noun: string, operationId: string): GeneratedParam[] {
  const params = [
    ...collectOperationParameters(entry.pathItem.parameters ?? [], entry.operation.parameters ?? [], noun, operationId),
    ...collectRequestBodyParams(entry.operation, noun, operationId),
    {
      paramName: "dryRun",
      originalName: "dryRun",
      location: "transport",
      description: "Print the HTTP request and exit without sending it.",
      optional: true,
      definition: { kind: "boolean" },
    } satisfies GeneratedParam,
    {
      paramName: "verbose",
      originalName: "verbose",
      location: "transport",
      description: "Log the request line to stderr.",
      shortFlag: "v",
      optional: true,
      definition: { kind: "boolean" },
    } satisfies GeneratedParam,
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
  pathItemParameters: OpenApiParameter[],
  operationParameters: OpenApiParameter[],
  noun: string,
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

  return [...merged.values()].map((parameter) => createGeneratedParameter(parameter, noun, operationId));
}

function collectRequestBodyParams(
  operation: OpenApiOperationObject,
  noun: string,
  operationId: string
): GeneratedParam[] {
  if (operation.requestBody === undefined) {
    return [];
  }

  if (isReferenceObject(operation.requestBody)) {
    throw new UserError(`Operation ${JSON.stringify(operationId)} uses a $ref requestBody, which is not supported yet.`);
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
    return createBodyParameter(name, noun, propertySchema, bodyOptional || !required.has(name), operationId);
  });
}

function createGeneratedParameter(
  parameter: OpenApiParameterObject,
  noun: string,
  operationId: string
): GeneratedParam {
  const schema = expectSchema(parameter.schema, operationId, `parameters.${parameter.name}`);
  const optional = parameter.in === "path" ? false : parameter.required !== true;

  return {
    paramName: normalizeParamName(parameter.name, noun),
    originalName: parameter.name,
    location: parameter.in,
    description: parameter.description ?? schema.description,
    optional,
    definition: createParamDefinition(schema, operationId, `parameter ${JSON.stringify(parameter.name)}`),
  };
}

function createBodyParameter(
  name: string,
  noun: string,
  schema: OpenApiSchemaObject,
  optional: boolean,
  operationId: string
): GeneratedParam {
  return {
    paramName: normalizeParamName(name, noun),
    originalName: name,
    location: "body",
    description: schema.description,
    optional,
    definition: createParamDefinition(schema, operationId, `request body field ${JSON.stringify(name)}`),
  };
}

function createParamDefinition(
  schema: OpenApiSchemaObject,
  operationId: string,
  context: string
): GeneratedParamDefinition {
  const enumValues = normalizeEnumValues(schema.enum);

  if (enumValues !== undefined) {
    return {
      kind: "enum",
      enumValues,
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
    };
  }

  if (schema.type === "string") {
    return {
      kind: "string",
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
    };
  }

  if (schema.type === "number" || schema.type === "integer") {
    return {
      kind: "number",
      ...(schema.type === "integer" ? { jsonType: "integer" as const } : {}),
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
    };
  }

  if (schema.type === "boolean") {
    return {
      kind: "boolean",
      ...(schema.default === undefined ? {} : { defaultValue: schema.default }),
    };
  }

  throw new UserError(
    `Operation ${JSON.stringify(operationId)} uses unsupported ${context}. Supported scalar shapes in this milestone are string, number, integer, boolean, and enum.`
  );
}

function normalizeEnumValues(enumValues: unknown[] | undefined): ReadonlyArray<string | number | boolean> | undefined {
  if (enumValues === undefined) {
    return undefined;
  }

  if (
    enumValues.length === 0 ||
    enumValues.some(
      (value) => typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean"
    )
  ) {
    throw new UserError("OpenAPI enums must contain only string, number, or boolean values.");
  }

  return enumValues as ReadonlyArray<string | number | boolean>;
}

function expectParameter(parameter: OpenApiParameter, operationId: string): OpenApiParameterObject {
  if (isReferenceObject(parameter)) {
    throw new UserError(`Operation ${JSON.stringify(operationId)} uses a $ref parameter, which is not supported yet.`);
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
    throw new UserError(`Operation ${JSON.stringify(operationId)} is missing a schema for ${context}.`);
  }

  if (isReferenceObject(schema)) {
    throw new UserError(`Operation ${JSON.stringify(operationId)} uses a $ref in ${context}, which is not supported yet.`);
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
    `  name: ${JSON.stringify(options.verb)},`,
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
  lines.push(...renderRequestShape(options.params));
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

  if (param.definition.jsonType !== undefined) {
    entries.push(`jsonType: ${JSON.stringify(param.definition.jsonType)}`);
  }

  return entries.length === 0 ? "" : `, { ${entries.join(", ")} }`;
}

function renderConstArray(values: ReadonlyArray<string | number | boolean>): string {
  return `${JSON.stringify(values)} as const`;
}

function renderRequestShape(params: GeneratedParam[]): string[] {
  const pathParams = params.filter((param) => param.location === "path");
  const queryParams = params.filter((param) => param.location === "query");
  const bodyParams = params.filter((param) => param.location === "body");
  const lines: string[] = [];

  if (pathParams.length > 0) {
    lines.push("      pathParams: {");
    lines.push(...pathParams.map((param) => `        ${JSON.stringify(param.originalName)}: params.${param.paramName},`));
    lines.push("      },");
  }

  if (queryParams.length > 0) {
    lines.push("      query: {");
    lines.push(...queryParams.map((param) => `        ${JSON.stringify(param.originalName)}: params.${param.paramName},`));
    lines.push("      },");
  }

  if (bodyParams.length > 0) {
    lines.push("      body: {");
    lines.push(...bodyParams.map((param) => `        ${JSON.stringify(param.originalName)}: params.${param.paramName},`));
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
      lines.push(`import { ${command.exportName} } from ${JSON.stringify(`./${command.filePath.replace(/\.ts$/, ".js")}`)};`);
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
    contents: lines.join("\n"),
  };
}

function compareGeneratedCommandPaths(left: GeneratedCommand, right: GeneratedCommand): number {
  const nounCompare = left.noun.localeCompare(right.noun);
  if (nounCompare !== 0) {
    return nounCompare;
  }

  return left.verb.localeCompare(right.verb);
}

function splitPathSegments(path: string): string[] {
  return path.split("/").filter((segment) => segment.length > 0);
}

function isPathTemplateSegment(segment: string): boolean {
  return segment.startsWith("{") && segment.endsWith("}");
}

function normalizeParamName(name: string, noun: string): string {
  const normalized = toCamelCase(name);
  const singularNoun = toCamelCase(toSingular(noun));

  if (!normalized.startsWith(singularNoun) || normalized.length === singularNoun.length) {
    return normalized;
  }

  const nextCharacter = normalized[singularNoun.length];
  if (nextCharacter === undefined || nextCharacter !== nextCharacter.toUpperCase()) {
    return normalized;
  }

  return `${nextCharacter.toLowerCase()}${normalized.slice(singularNoun.length + 1)}`;
}

function toSingular(value: string): string {
  if (value.endsWith("ies") && value.length > 3) {
    return `${value.slice(0, -3)}y`;
  }

  if (value.endsWith("s") && value.length > 1) {
    return value.slice(0, -1);
  }

  return value;
}

function toPascalCase(value: string): string {
  const camel = toCamelCase(value);
  return camel.length === 0 ? camel : `${camel[0]?.toUpperCase() ?? ""}${camel.slice(1)}`;
}

function toCamelCase(value: string): string {
  const words = splitWords(value);

  return words
    .map((word, index) =>
      index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`
    )
    .join("");
}

function toKebabCase(value: string): string {
  return splitWords(value).join("-");
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index] ?? "";

    if (character === "-" || character === "_" || character === " " || character === ".") {
      if (current.length > 0) {
        words.push(current.toLowerCase());
        current = "";
      }
      continue;
    }

    const lower = character.toLowerCase();
    const upper = character.toUpperCase();
    const previous = value[index - 1];
    const next = value[index + 1];
    const isUppercase = character !== lower && character === upper;
    const previousIsLowercase =
      previous !== undefined && previous === previous.toLowerCase() && previous !== previous.toUpperCase();
    const nextIsLowercase =
      next !== undefined && next === next.toLowerCase() && next !== next.toUpperCase();

    if (isUppercase && current.length > 0 && (previousIsLowercase || nextIsLowercase)) {
      words.push(current.toLowerCase());
      current = character;
      continue;
    }

    current += character;
  }

  if (current.length > 0) {
    words.push(current.toLowerCase());
  }

  return words;
}

function isReferenceObject(value: unknown): value is OpenApiReferenceObject {
  return typeof value === "object" && value !== null && "$ref" in value;
}
