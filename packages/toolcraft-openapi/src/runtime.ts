import fs from "node:fs/promises";
import { UserError, defineCommand, defineGroup, S, type AnySchema, type CommandNode, type HandlerEnv, type HandlerFs } from "toolcraft";
import { defineClient, type DefineClientOptions, type DefinedClient, type OpenApiClientServices } from "./define-client.js";
import {
  collectSchemaOptionEntries,
  collectGeneratedCommands,
  type GeneratedCommand,
  type GeneratedParam,
  type GeneratedParamDefinition,
  type OpenApiDocument
} from "./generate.js";
import { groupByNoun } from "./group-by-noun.js";
import {
  prepareMultipartFileInputs,
  requestJson,
  writeBinaryResponseOutput,
  type HttpRequestOptions
} from "./http.js";
import { buildRequestShape, executePreflightBlocks } from "./interpreter.js";
import { parseOpenApiDocument, readOpenApiSourceText, type OpenApiSourceFileSystem } from "./spec-source.js";

export type OpenApiDocumentSource = OpenApiDocument | string | URL;

export interface CommandsFromSpecOptions {
  cwd?: string;
  fetch?: typeof globalThis.fetch;
  fs?: OpenApiSourceFileSystem;
}

export type DefineClientFromSpecOptions<TServices extends object = Record<string, never>> =
  Omit<DefineClientOptions<TServices>, "commands"> & CommandsFromSpecOptions;

export interface ResolveOpenApiBaseUrlOptions {
  document: OpenApiDocument;
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
}) => Promise<unknown>;
const RUNTIME_COMMAND_SCOPE = ["cli", "mcp", "sdk"] as ["cli", "mcp", "sdk"];

export async function commandsFromSpec(
  source: OpenApiDocumentSource,
  options: CommandsFromSpecOptions = {}
): Promise<CommandNode<OpenApiClientServices>[]> {
  const document = await resolveDocument(source, options);
  return createRuntimeGroups(collectGeneratedCommands(document));
}

export async function defineClientFromSpec<TServices extends object = Record<string, never>>(
  spec: OpenApiDocumentSource,
  options: DefineClientFromSpecOptions<TServices>
): Promise<DefinedClient<TServices>> {
  const { cwd, fetch, fs: specFs, ...clientOptions } = options;
  const commands = (await commandsFromSpec(spec, {
    cwd,
    fetch,
    fs: specFs
  })) as CommandNode<OpenApiClientServices & TServices>[];
  return defineClient({ ...clientOptions, commands });
}

async function resolveDocument(
  source: OpenApiDocumentSource,
  options: CommandsFromSpecOptions
): Promise<OpenApiDocument> {
  if (typeof source !== "string" && !(source instanceof URL)) {
    return source;
  }

  const sourceText = await readOpenApiSourceText(source, {
    cwd: options.cwd ?? process.cwd(),
    fetch: options.fetch ?? globalThis.fetch,
    fs: options.fs ?? fs
  });

  return parseOpenApiDocument(sourceText, source);
}

export function resolveOpenApiBaseUrl(options: ResolveOpenApiBaseUrlOptions): string | undefined {
  const environments = options.environments;

  if (environments !== undefined && Object.keys(environments).length > 0) {
    const selectedName =
      options.environment ?? options.env?.TOOLCRAFT_OPENAPI_ENV ?? Object.keys(environments)[0];
    const selectedUrl = selectedName === undefined ? undefined : environments[selectedName];

    if (selectedUrl !== undefined) {
      return normalizeBaseUrl(selectedUrl);
    }

    if (selectedName !== undefined) {
      throw new UserError(
        `Unknown OpenAPI environment ${JSON.stringify(selectedName)}. Available: ${Object.keys(environments).join(", ")}.`
      );
    }
  }

  const server = options.document.servers?.[0]?.url;
  return server === undefined ? undefined : normalizeBaseUrl(server);
}

function normalizeBaseUrl(value: string): string {
  return new URL(value).toString().replace(/\/$/, "");
}

function createRuntimeGroups(
  commands: ReadonlyArray<GeneratedCommand>
): CommandNode<OpenApiClientServices>[] {
  return groupByNoun(commands).map(({ noun, commands: nounCommands }) =>
    defineGroup({
      name: noun,
      children: nounCommands.map((command) => createRuntimeCommand(command))
    })
  );
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
    scope: RUNTIME_COMMAND_SCOPE,
    ...(command.confirm ? { confirm: true } : {}),
    ...(command.positional.length > 0 ? { positional: command.positional } : {}),
    params: paramsSchema as any,
    handler: createRuntimeHandler(command)
  });
}

function createRuntimeHandler(command: GeneratedCommand): GeneratedCommandHandler {
  return async ({ params, baseUrl, tokenSource, fetch, fs, env }) => {
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
      env
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
      verbose: params.verbose as boolean | undefined,
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
    param.scope,
    param.global
  );

  return param.optional ? S.Optional(definition) : definition;
}

function createRuntimeDefinition(
  definition: GeneratedParamDefinition,
  description?: string,
  shortFlag?: string,
  scope?: readonly ["cli" | "mcp" | "sdk", ...Array<"cli" | "mcp" | "sdk">],
  global?: boolean
): AnySchema {
  const options = createRuntimeSchemaOptions(definition, description, shortFlag, scope, global);

  return RUNTIME_DEFINITION_BUILDERS[definition.kind](definition as never, options);
}

const RUNTIME_DEFINITION_BUILDERS = {
  array: (definition: Extract<GeneratedParamDefinition, { kind: "array" }>, options?: Record<string, unknown>) => {
    const itemDefinition = createRuntimeDefinition(
      definition.itemDefinition,
      undefined,
      undefined,
      undefined
    );
    return options === undefined ? S.Array(itemDefinition) : S.Array(itemDefinition, options);
  },
  boolean: (_definition: Extract<GeneratedParamDefinition, { kind: "boolean" }>, options?: Record<string, unknown>) =>
    options === undefined ? S.Boolean() : S.Boolean(options),
  enum: (definition: Extract<GeneratedParamDefinition, { kind: "enum" }>, options?: Record<string, unknown>) =>
    options === undefined ? S.Enum(definition.enumValues) : S.Enum(definition.enumValues, options),
  json: (_definition: Extract<GeneratedParamDefinition, { kind: "json" }>) => S.Json(),
  number: (_definition: Extract<GeneratedParamDefinition, { kind: "number" }>, options?: Record<string, unknown>) =>
    options === undefined ? S.Number() : S.Number(options),
  object: (definition: Extract<GeneratedParamDefinition, { kind: "object" }>, options?: Record<string, unknown>) => {
    const shape = Object.fromEntries(
      definition.properties.map((property) => {
        const propertySchema = createRuntimeDefinition(
          property.definition,
          undefined,
          undefined,
          undefined
        );
        return [property.name, property.optional ? S.Optional(propertySchema) : propertySchema];
      })
    ) as Record<string, AnySchema>;
    return options === undefined ? S.Object(shape) : S.Object(shape, options);
  },
  string: (_definition: Extract<GeneratedParamDefinition, { kind: "string" }>, options?: Record<string, unknown>) =>
    options === undefined ? S.String() : S.String(options)
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
  scope?: readonly ["cli" | "mcp" | "sdk", ...Array<"cli" | "mcp" | "sdk">],
  global?: boolean
) {
  const options = Object.fromEntries(
    collectSchemaOptionEntries({
      definition,
      description,
      shortFlag,
      scope,
      global
    }).map(({ key, value }) => [key, Array.isArray(value) ? [...value] : value])
  );

  return Object.keys(options).length === 0 ? undefined : options;
}
