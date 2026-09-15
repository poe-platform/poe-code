import fs from "node:fs/promises";
import {
  UserError,
  defineCommand,
  defineGroup,
  S,
  type AnySchema,
  type CommandNode,
  type HandlerEnv,
  type HandlerFs,
  type RuntimeLogger
} from "toolcraft";
import {
  defineClient,
  type DefineClientOptions,
  type DefinedClient,
  type OpenApiClientServices
} from "./define-client.js";
import {
  collectTagDescriptions,
  collectSchemaOptionEntries,
  collectGeneratedCommands,
  type GeneratedCommand,
  type GeneratedParam,
  type GeneratedParamDefinition,
  type OpenApiDocument
} from "./generate.js";
import type { ToolcraftConfig } from "./config.js";
import { groupByNoun } from "./group-by-noun.js";
import {
  prepareMultipartFileInputs,
  requestJson,
  writeBinaryResponseOutput,
  type HttpRequestOptions
} from "./http.js";
import { buildRequestShape, executePreflightBlocks } from "./interpreter.js";
import {
  DEFAULT_OPENAPI_FETCH_TIMEOUT_MS,
  loadCachedOpenApiSource,
  type OpenApiSpecCacheFileSystem,
  type OpenApiSpecCacheOptions,
  type OpenApiTimeoutContext
} from "./spec-cache.js";
import { parseOpenApiDocument, readOpenApiSourceText } from "./spec-source.js";

export type OpenApiDocumentSource = OpenApiDocument | string | URL;

export interface CommandsFromSpecOptions {
  cwd?: string;
  fetch?: typeof globalThis.fetch;
  fs?: OpenApiSpecCacheFileSystem;
  cache?: false | OpenApiSpecCacheOptions;
  onTimeout?: (context: OpenApiTimeoutContext) => void | Promise<void>;
  timeoutMs?: number;
  config?: ToolcraftConfig;
}

export type DefineClientFromSpecOptions<TServices extends object = Record<string, never>> = Omit<
  DefineClientOptions<TServices>,
  "baseUrl" | "commands"
> &
  CommandsFromSpecOptions & {
    baseUrl?: string;
    environment?: string;
    env?: Record<string, string | undefined>;
  };

export interface ResolveOpenApiBaseUrlOptions {
  document: OpenApiDocument;
  sourceUrl?: string | URL;
  environments?: Record<string, string>;
  environment?: string;
  env?: Record<string, string | undefined>;
}

type GeneratedCommandHandler = (ctx: {
  params: any;
  baseUrl: string;
  tokenSource: OpenApiClientServices["tokenSource"];
  fetch?: typeof globalThis.fetch;
  fs?: HandlerFs;
  env?: HandlerEnv;
  diagnostics: RuntimeLogger;
}) => Promise<unknown>;
const RUNTIME_COMMAND_SCOPE = ["cli", "mcp", "sdk"] as ["cli", "mcp", "sdk"];

export async function commandsFromSpec(
  source: OpenApiDocumentSource,
  options: CommandsFromSpecOptions = {}
): Promise<CommandNode<OpenApiClientServices>[]> {
  const resolved = await resolveDocument(source, options);
  const commands = createRuntimeNodes(resolved.document, options.config);
  await resolved.commit?.();
  return commands;
}

export async function defineClientFromSpec<TServices extends object = Record<string, never>>(
  spec: OpenApiDocumentSource,
  options: DefineClientFromSpecOptions<TServices>
): Promise<DefinedClient<TServices>> {
  const {
    cwd,
    fetch,
    fs: specFs,
    cache,
    onTimeout,
    timeoutMs,
    config,
    baseUrl,
    environment,
    env,
    ...clientOptions
  } = options;
  const resolved = await resolveDocument(spec, {
    cwd,
    fetch,
    fs: specFs,
    cache,
    onTimeout,
    timeoutMs,
    config
  });
  const document = resolved.document;
  const resolvedBaseUrl =
    baseUrl ??
    resolveOpenApiBaseUrl({
      document,
      sourceUrl: resolved.sourceUrl,
      environments: config?.environments,
      environment,
      env: env ?? process.env
    });

  if (resolvedBaseUrl === undefined) {
    throw new UserError(
      "defineClientFromSpec could not resolve a base URL. Pass baseUrl, configure an environment, or define OpenAPI servers[0].url."
    );
  }

  const commands = createRuntimeNodes(document, config) as CommandNode<
    OpenApiClientServices & TServices
  >[];
  const client = defineClient({ ...clientOptions, baseUrl: resolvedBaseUrl, commands });
  await resolved.commit?.();
  return client;
}

interface ResolvedOpenApiDocument {
  document: OpenApiDocument;
  sourceUrl?: string;
  commit?: () => Promise<void>;
}

async function resolveDocument(
  source: OpenApiDocumentSource,
  options: CommandsFromSpecOptions
): Promise<ResolvedOpenApiDocument> {
  if (typeof source !== "string" && !(source instanceof URL)) {
    return { document: source };
  }

  const sourceUrl = source instanceof URL ? source : tryParseUrl(source);
  if (sourceUrl !== null && (sourceUrl.protocol === "http:" || sourceUrl.protocol === "https:")) {
    const loaded = await loadCachedOpenApiSource(sourceUrl, {
      cache: options.cache ?? resolveDefaultCache(options),
      fetch: options.fetch ?? globalThis.fetch,
      fs: options.fs ?? fs,
      onTimeout: options.onTimeout,
      timeoutMs: options.timeoutMs ?? DEFAULT_OPENAPI_FETCH_TIMEOUT_MS
    });
    return {
      document: loaded.document,
      sourceUrl: loaded.sourceUrl,
      ...(loaded.commit === undefined ? {} : { commit: loaded.commit })
    };
  }

  const sourceText = await readOpenApiSourceText(source, {
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    fs: options.fs ?? fs
  });

  return { document: parseOpenApiDocument(sourceText, source) };
}

function resolveDefaultCache(options: CommandsFromSpecOptions): false | OpenApiSpecCacheOptions {
  if (options.fetch !== undefined) {
    return false;
  }

  const configured = Object.prototype.hasOwnProperty.call(process.env, "TOOLCRAFT_OPENAPI_CACHE")
    ? process.env.TOOLCRAFT_OPENAPI_CACHE?.trim().toLowerCase()
    : undefined;
  return configured === "0" || configured === "false" ? false : {};
}

function tryParseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

export function resolveOpenApiBaseUrl(options: ResolveOpenApiBaseUrlOptions): string | undefined {
  const environments = options.environments;

  if (environments !== undefined && Object.keys(environments).length > 0) {
    const selectedName =
      options.environment ?? options.env?.TOOLCRAFT_OPENAPI_ENV ?? Object.keys(environments)[0];
    const selectedUrl = selectedName === undefined ? undefined : environments[selectedName];

    if (selectedUrl !== undefined) {
      return normalizeBaseUrl(selectedUrl, `environments[${JSON.stringify(selectedName)}]`);
    }

    if (selectedName !== undefined) {
      throw new UserError(
        `Unknown OpenAPI environment ${JSON.stringify(selectedName)}. Available: ${Object.keys(environments).join(", ")}.`
      );
    }
  }

  const document = options.document;
  if (document.swagger === "2.0") {
    if (document.host !== undefined && typeof document.host !== "string") {
      throw new UserError("OpenAPI Swagger host must be a string.");
    }
    if (document.schemes !== undefined && !Array.isArray(document.schemes)) {
      throw new UserError("OpenAPI Swagger schemes must be an array.");
    }
    if (document.schemes !== undefined && document.schemes.length > 0 && typeof document.schemes[0] !== "string") {
      throw new UserError("OpenAPI Swagger schemes[0] must be a string.");
    }
    if (document.basePath !== undefined && (typeof document.basePath !== "string" || !document.basePath.startsWith("/"))) {
      throw new UserError("OpenAPI Swagger basePath must be a string starting with '/'.");
    }
    const source = options.sourceUrl === undefined ? undefined : new URL(options.sourceUrl);
    const host = document.host ?? source?.host;
    const scheme = document.schemes?.[0] ?? source?.protocol.slice(0, -1);
    if (host === undefined || scheme === undefined) return undefined;
    return normalizeBaseUrl(`${scheme}://${host}${document.basePath ?? "/"}`, "Swagger host/schemes/basePath");
  }

  if (document.servers !== undefined && !Array.isArray(document.servers)) {
    throw new UserError("OpenAPI servers must be an array.");
  }
  if (document.servers === undefined || document.servers.length === 0) {
    return options.sourceUrl === undefined
      ? undefined
      : normalizeBaseUrl("/", "servers[0].url", options.sourceUrl);
  }
  const server = document.servers[0];
  if (server === null || typeof server !== "object" || Array.isArray(server)) {
    throw new UserError("OpenAPI servers[0] must be an object.");
  }
  if (typeof server.url !== "string") {
    throw new UserError("OpenAPI servers[0].url must be a string.");
  }

  let expanded = "";
  let offset = 0;
  while (offset < server.url.length) {
    const start = server.url.indexOf("{", offset);
    if (start === -1) {
      expanded += server.url.slice(offset);
      break;
    }
    expanded += server.url.slice(offset, start);
    const end = server.url.indexOf("}", start + 1);
    if (end === -1) {
      throw new UserError("OpenAPI servers[0].url contains an unterminated server variable.");
    }
    const name = server.url.slice(start + 1, end);
    const value = server.variables?.[name]?.default;
    if (typeof value !== "string") {
      throw new UserError(`OpenAPI servers[0].variables[${JSON.stringify(name)}].default must be a string.`);
    }
    expanded += value;
    offset = end + 1;
  }
  return normalizeBaseUrl(expanded, "servers[0].url", options.sourceUrl);
}

function normalizeBaseUrl(value: string, field: string, sourceUrl?: string | URL): string {
  let url: URL;
  try {
    url = new URL(value, sourceUrl);
  } catch {
    throw new UserError(`OpenAPI ${field} must resolve to an absolute URL. Pass baseUrl for a relative server without a remote document origin.`);
  }
  const normalized = url.toString();
  return normalized.endsWith("/") && url.search === "" && url.hash === ""
    ? normalized.slice(0, -1)
    : normalized;
}

function createRuntimeNodes(
  document: OpenApiDocument,
  config: ToolcraftConfig | undefined
): CommandNode<OpenApiClientServices>[] {
  const commands = collectGeneratedCommands(document, config);
  const tagDescriptions = collectTagDescriptions(document);

  return [
    ...commands.filter((command) => command.topLevel).map(createRuntimeCommand),
    ...groupByNoun(commands).map(({ noun, commands: nounCommands }) =>
      defineGroup({
        name: noun,
        description: tagDescriptions.get(noun),
        children: nounCommands.map(createRuntimeCommand)
      })
    )
  ];
}

function createRuntimeCommand(command: GeneratedCommand) {
  const paramsSchema = S.Object(
    Object.fromEntries(
      command.params.map((param) => [param.paramName, createRuntimeParamSchema(param)])
    ) as Record<string, AnySchema>,
    command.paramsSchemaOptions
  );

  return defineCommand<
    OpenApiClientServices,
    string,
    any,
    undefined,
    unknown,
    ["cli", "mcp", "sdk"]
  >({
    name: command.verb,
    ...(command.description === undefined ? {} : { description: command.description }),
    ...(command.examples === undefined ? {} : { examples: command.examples }),
    scope: RUNTIME_COMMAND_SCOPE,
    ...(command.confirm ? { confirm: true } : {}),
    ...(command.positional.length > 0 ? { positional: command.positional } : {}),
    params: paramsSchema as any,
    handler: createRuntimeHandler(command)
  });
}

function createRuntimeHandler(command: GeneratedCommand): GeneratedCommandHandler {
  return async ({ params, baseUrl, tokenSource, fetch, fs, env, diagnostics }) => {
    const resolvedValues = executePreflightBlocks(command.preflightBlocks, params);
    const requestShape = buildRequestShape(
      command.requestFields,
      command.sectionRenders,
      command.optionalSections,
      params,
      resolvedValues
    ) as Partial<Pick<HttpRequestOptions, "pathParams" | "query" | "headers" | "body">>;
    const preparedRequestShape = await prepareMultipartFileInputs(requestShape, {
      bodyMode: command.bodyMode,
      multipartBinaryFields: command.multipartBinaryFields,
      fs,
      env,
      fetch
    });

    const result = await requestJson({
      baseUrl: command.baseUrl ?? baseUrl,
      path: command.path,
      method: command.method,
      auth: command.auth,
      responseMode: command.responseMode,
      accept: command.accept,
      bodyMode: command.bodyMode,
      contentType: command.contentType,
      multipartBinaryFields: command.multipartBinaryFields,
      tokenSource,
      fetch,
      diagnostics,
      ...(command.rawResponse === true ? { rawResponse: params.rawResponse } : {}),
      ...(command.idempotencyHeader === undefined
        ? {}
        : {
            idempotency: {
              header: command.idempotencyHeader,
              enabled: true,
              key: params.idempotencyKey
            }
          }),
      ...preparedRequestShape
    });

    return writeBinaryResponseOutput(
      result,
      command.responseMode === "binary" ? params.output : undefined,
      { fs, env }
    );
  };
}

function createRuntimeParamSchema(param: GeneratedParam): AnySchema {
  const definition = createRuntimeDefinition(
    param.definition,
    param.description,
    param.shortFlag,
    param.longAliases,
    param.scope,
    param.global
  );

  return param.optional ? S.Optional(definition) : definition;
}

function createRuntimeDefinition(
  definition: GeneratedParamDefinition,
  description?: string,
  shortFlag?: string,
  longAliases?: string[],
  scope?: readonly ["cli" | "mcp" | "sdk", ...Array<"cli" | "mcp" | "sdk">],
  global?: boolean
): AnySchema {
  const options = createRuntimeSchemaOptions(
    definition,
    description,
    shortFlag,
    longAliases,
    scope,
    global
  );

  return RUNTIME_DEFINITION_BUILDERS[definition.kind](definition as never, options);
}

const RUNTIME_DEFINITION_BUILDERS = {
  array: (
    definition: Extract<GeneratedParamDefinition, { kind: "array" }>,
    options?: Record<string, unknown>
  ) => {
    const itemDefinition = createRuntimeDefinition(
      definition.itemDefinition,
      undefined,
      undefined,
      undefined,
      undefined
    );
    return options === undefined ? S.Array(itemDefinition) : S.Array(itemDefinition, options);
  },
  boolean: (
    _definition: Extract<GeneratedParamDefinition, { kind: "boolean" }>,
    options?: Record<string, unknown>
  ) => (options === undefined ? S.Boolean() : S.Boolean(options)),
  enum: (
    definition: Extract<GeneratedParamDefinition, { kind: "enum" }>,
    options?: Record<string, unknown>
  ) =>
    options === undefined ? S.Enum(definition.enumValues) : S.Enum(definition.enumValues, options),
  json: (_definition: Extract<GeneratedParamDefinition, { kind: "json" }>) => S.Json(),
  number: (
    _definition: Extract<GeneratedParamDefinition, { kind: "number" }>,
    options?: Record<string, unknown>
  ) => (options === undefined ? S.Number() : S.Number(options)),
  object: (
    definition: Extract<GeneratedParamDefinition, { kind: "object" }>,
    options?: Record<string, unknown>
  ) => {
    const shape = Object.fromEntries(
      definition.properties.map((property) => {
        const propertySchema = createRuntimeDefinition(
          property.definition,
          undefined,
          undefined,
          undefined,
          undefined
        );
        return [property.name, property.optional ? S.Optional(propertySchema) : propertySchema];
      })
    ) as Record<string, AnySchema>;
    return options === undefined ? S.Object(shape) : S.Object(shape, options);
  },
  string: (
    _definition: Extract<GeneratedParamDefinition, { kind: "string" }>,
    options?: Record<string, unknown>
  ) => (options === undefined ? S.String() : S.String(options))
} as const satisfies {
  [K in GeneratedParamDefinition["kind"]]: (
    definition: Extract<GeneratedParamDefinition, { kind: K }>,
    options?: Record<string, unknown>
  ) => AnySchema;
};

function createRuntimeSchemaOptions(
  definition: GeneratedParamDefinition,
  description?: string,
  shortFlag?: string,
  longAliases?: string[],
  scope?: readonly ["cli" | "mcp" | "sdk", ...Array<"cli" | "mcp" | "sdk">],
  global?: boolean
) {
  const options = Object.fromEntries(
    collectSchemaOptionEntries({
      definition,
      description,
      shortFlag,
      longAliases,
      scope,
      global
    }).map(({ key, value }) => [key, Array.isArray(value) ? [...value] : value])
  );

  return Object.keys(options).length === 0 ? undefined : options;
}
