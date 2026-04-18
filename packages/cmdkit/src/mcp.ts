import { access, readFile, writeFile } from "node:fs/promises";
import {
  createServer,
  JSON_RPC_ERROR_CODES,
  ToolError,
  type SDKTransport,
  type Server as TinyServer,
  type TypedSchema,
} from "tiny-stdio-mcp-server";
import { toJsonSchema, type AnySchema, type JsonSchema, type ObjectSchema } from "@poe-code/cmdkit-schema";
import type { Command, Group, HandlerEnv, HandlerFs } from "./index.js";
import { UserError, assertCommandRequirements, resolveCommandSecrets } from "./index.js";

const RESERVED_SERVICE_NAMES = new Set(["params", "secrets", "fetch", "fs", "env", "progress"]);

type Casing = "snake" | "camel";
type CmdkitServer = Omit<TinyServer, "connect"> & {
  connect(transport: SDKTransport): Promise<void>;
};
type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "audio"; data: string; mimeType: string }
  | {
      type: "resource";
      resource:
        | { uri: string; mimeType: string; text: string }
        | { uri: string; mimeType: string; blob: string };
    };

interface ToolDefinition<TServices extends object> {
  command: Command<TServices, any, any, any>;
  description: string;
  inputSchema: JsonSchema;
  name: string;
}

export interface RunMCPOptions<TServices extends object = Record<string, unknown>> {
  name: string;
  version: string;
  tools?: string[];
  services?: TServices;
  casing?: Casing;
}

function normalizeRoots<TServices extends object>(
  roots: Group<TServices> | Group<TServices>[]
): Group<TServices> {
  if (!Array.isArray(roots)) {
    return roots;
  }

  return {
    kind: "group",
    name: "",
    aliases: [],
    secrets: {},
    children: roots,
  };
}

function splitWords(value: string): string[] {
  const words: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";
    const lower = char.toLowerCase();
    const upper = char.toUpperCase();
    const isSeparator = char === "-" || char === "_" || char === " " || char === ".";

    if (isSeparator) {
      if (current.length > 0) {
        words.push(current.toLowerCase());
        current = "";
      }
      continue;
    }

    const isUppercase = char !== lower && char === upper;
    const previous = value[index - 1];
    const next = value[index + 1];
    const previousIsLowercase =
      previous !== undefined && previous === previous.toLowerCase() && previous !== previous.toUpperCase();
    const nextIsLowercase =
      next !== undefined && next === next.toLowerCase() && next !== next.toUpperCase();

    if (isUppercase && current.length > 0 && (previousIsLowercase || nextIsLowercase)) {
      words.push(current.toLowerCase());
      current = char;
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    words.push(current.toLowerCase());
  }

  return words;
}

function formatSegment(segment: string, casing: Casing): string {
  const words = splitWords(segment);

  if (casing === "snake") {
    return words.join("_");
  }

  return words
    .map((word, index) =>
      index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`
    )
    .join("");
}

function unwrapOptional(schema: AnySchema): AnySchema {
  if (schema.kind === "optional") {
    return unwrapOptional(schema.inner);
  }

  return schema;
}

function isOptional(schema: AnySchema): boolean {
  return schema.kind === "optional";
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function createFs(): HandlerFs {
  return {
    readFile: async (path: string, encoding = "utf8") => readFile(path, { encoding }),
    writeFile: async (path: string, contents: string) => {
      await writeFile(path, contents);
    },
    exists: async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
  };
}

function createEnv(values: Record<string, string | undefined> = process.env): HandlerEnv {
  return {
    get(key: string): string | undefined {
      return values[key];
    },
  };
}

function validateServices(services: Record<string, unknown>): void {
  for (const name of Object.keys(services)) {
    if (RESERVED_SERVICE_NAMES.has(name)) {
      throw new Error(`Service name "${name}" is reserved. Choose a different name.`);
    }
  }
}

function applySchemaCasing(schema: JsonSchema, casing: Casing): JsonSchema {
  if (schema.type !== "object" || schema.properties === undefined) {
    if (schema.type === "array" && schema.items !== undefined) {
      return {
        ...schema,
        items: applySchemaCasing(schema.items, casing),
      };
    }

    return schema;
  }

  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([key, value]) => [
      formatSegment(key, casing),
      applySchemaCasing(value, casing),
    ])
  );
  const required = schema.required?.map((key) => formatSegment(key, casing));

  return {
    ...schema,
    properties,
    ...(required === undefined ? {} : { required }),
  };
}

function filterSchemaForScope(schema: AnySchema, scope: "cli" | "mcp" | "sdk"): AnySchema | undefined {
  if (schema.scope !== undefined && !schema.scope.includes(scope)) {
    return undefined;
  }

  if (schema.kind === "optional") {
    const inner = filterSchemaForScope(schema.inner, scope);
    return inner === undefined ? undefined : { ...schema, inner };
  }

  if (schema.kind === "array") {
    const item = filterSchemaForScope(schema.item, scope);
    return item === undefined ? undefined : { ...schema, item };
  }

  if (schema.kind !== "object") {
    return schema;
  }

  return {
    ...schema,
    shape: Object.fromEntries(
      Object.entries(schema.shape).flatMap(([key, childSchema]) => {
        const filtered = filterSchemaForScope(childSchema, scope);
        return filtered === undefined ? [] : [[key, filtered]];
      })
    ),
  };
}

function collectParamSummaries(
  schema: ObjectSchema<any>,
  casing: Casing,
  path: string[] = [],
  inheritedOptional = false
): string[] {
  const summaries: string[] = [];

  for (const [key, rawChildSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const childSchema = unwrapOptional(rawChildSchema);
    const nextPath = [...path, formatSegment(key, casing)];
    const optional = inheritedOptional || isOptional(rawChildSchema);

    if (childSchema.kind === "object") {
      summaries.push(...collectParamSummaries(childSchema, casing, nextPath, optional));
      continue;
    }

    summaries.push(`${nextPath.join(".")}${optional ? "" : " (required)"}`);
  }

  return summaries;
}

function buildToolDescription(
  description: string | undefined,
  params: ObjectSchema<any>,
  casing: Casing
): string {
  const summary = collectParamSummaries(params, casing);
  const parameterSummary =
    summary.length === 0 ? "" : `Parameters: ${summary.join(", ")}.`;

  if (description === undefined) {
    return parameterSummary;
  }

  if (parameterSummary.length === 0) {
    return description;
  }

  return `${description} ${parameterSummary}`;
}

function matchesAllowlist(toolName: string, allowlist: string[] | undefined): boolean {
  if (allowlist === undefined) {
    return true;
  }

  const segments = toolName.split(".");
  const candidates = segments.map((_segment, index) => segments.slice(0, index + 1).join("."));
  return candidates.some((candidate) => allowlist.includes(candidate));
}

function enumerateTools<TServices extends object>(
  root: Group<TServices>,
  casing: Casing,
  allowlist: string[] | undefined
): ToolDefinition<TServices>[] {
  const tools: ToolDefinition<TServices>[] = [];

  function visit(node: Command<TServices, any, any, any> | Group<TServices>, path: string[]): void {
    if (node.kind === "command") {
      if (!node.scope.includes("mcp")) {
        return;
      }

      const name = [...path, node.name].join(".");
      const params = filterSchemaForScope(node.params, "mcp");
      if (!matchesAllowlist(name, allowlist)) {
        return;
      }

      if (params === undefined || params.kind !== "object") {
        throw new Error(`Bug: command "${name}" must define an object params schema for MCP.`);
      }

      tools.push({
        command: node,
        name,
        description: buildToolDescription(node.description, params, casing),
        inputSchema: applySchemaCasing(toJsonSchema(params), casing),
      });
      return;
    }

    const nextPath = [...path, node.name];

    for (const child of node.children) {
      visit(child, nextPath);
    }
  }

  for (const child of root.children) {
    visit(child, []);
  }

  return tools;
}

function validateEnum(value: unknown, schema: Extract<AnySchema, { kind: "enum" }>, label: string): string | number | boolean {
  if (!schema.values.includes(value as never)) {
    throw new UserError(
      `Invalid value for "${label}". Expected one of: ${schema.values.map((candidate) => String(candidate)).join(", ")}.`
    );
  }

  return value as string | number | boolean;
}

function validateSchemaValue(
  schema: AnySchema,
  value: unknown,
  casing: Casing,
  label: string
): unknown {
  const unwrappedSchema = unwrapOptional(schema);

  switch (unwrappedSchema.kind) {
    case "string":
      if (typeof value !== "string") {
        throw new UserError(`Invalid value for "${label}". Expected a string.`);
      }
      return value;

    case "number":
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new UserError(`Invalid value for "${label}". Expected a number.`);
      }
      return value;

    case "boolean":
      if (typeof value !== "boolean") {
        throw new UserError(`Invalid value for "${label}". Expected a boolean.`);
      }
      return value;

    case "enum":
      return validateEnum(value, unwrappedSchema, label);

    case "array":
      if (!Array.isArray(value)) {
        throw new UserError(`Invalid value for "${label}". Expected an array.`);
      }
      return value.map((item, index) =>
        validateSchemaValue(unwrappedSchema.item, item, casing, `${label}[${index}]`)
      );

    case "object":
      return validateObjectSchema(unwrappedSchema, value, casing, label);
  }
}

function validateObjectSchema(
  schema: ObjectSchema<any>,
  value: unknown,
  casing: Casing,
  label: string
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new UserError(`Invalid value for "${label}". Expected an object.`);
  }

  const result: Record<string, unknown> = {};
  const expectedKeys = new Map<string, [string, AnySchema]>();

  for (const [key, childSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    expectedKeys.set(formatSegment(key, casing), [key, childSchema]);
  }

  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      const fieldLabel = label.length === 0 ? key : `${label}.${key}`;
      throw new UserError(`Unexpected parameter "${fieldLabel}".`);
    }
  }

  for (const [inputKey, [outputKey, rawChildSchema]] of expectedKeys.entries()) {
    const childSchema = unwrapOptional(rawChildSchema);
    const hasValue = Object.prototype.hasOwnProperty.call(value, inputKey);
    const fieldLabel = label.length === 0 ? inputKey : `${label}.${inputKey}`;

    if (!hasValue) {
      if (childSchema.default !== undefined) {
        result[outputKey] = childSchema.default;
        continue;
      }

      if (isOptional(rawChildSchema)) {
        continue;
      }

      throw new UserError(`Missing required parameter "${fieldLabel}".`);
    }

    result[outputKey] = validateSchemaValue(rawChildSchema, value[inputKey], casing, fieldLabel);
  }

  return result;
}

function validateToolArguments(
  schema: ObjectSchema<any>,
  argumentsValue: Record<string, unknown> | undefined,
  casing: Casing
): Record<string, unknown> {
  return validateObjectSchema(schema, argumentsValue ?? {}, casing, "");
}

function isContentBlock(value: unknown): value is ToolContent {
  if (!isPlainObject(value) || typeof value.type !== "string") {
    return false;
  }

  return (
    value.type === "text" ||
    value.type === "image" ||
    value.type === "audio" ||
    value.type === "resource"
  );
}

function toToolContent(result: unknown): ToolContent[] {
  if (result === undefined) {
    return [];
  }

  if (Array.isArray(result)) {
    return result.flatMap((item) => toToolContent(item));
  }

  if (
    typeof result === "string" ||
    typeof result === "number" ||
    typeof result === "boolean"
  ) {
    return [{ type: "text", text: String(result) }];
  }

  if (result === null) {
    return [{ type: "text", text: "null" }];
  }

  if (isContentBlock(result)) {
    return [result];
  }

  return [{ type: "text", text: JSON.stringify(result) }];
}

function toToolError(error: unknown): ToolError {
  if (error instanceof ToolError) {
    return error;
  }

  if (error instanceof UserError) {
    return new ToolError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, error.message);
  }

  if (error instanceof Error) {
    return new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR, error.message);
  }

  return new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR, String(error));
}

export function createMCPServer<TServices extends object = Record<string, unknown>>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunMCPOptions<TServices>
): CmdkitServer {
  const root = normalizeRoots(roots);
  const casing = options.casing ?? "snake";
  const services = (options.services ?? {}) as TServices;
  validateServices(services as Record<string, unknown>);

  const tools = enumerateTools(root, casing, options.tools);
  const server = createServer({ name: options.name, version: options.version });

  for (const tool of tools) {
    server.tool(
      tool.name,
      tool.description,
      tool.inputSchema as TypedSchema<Record<string, unknown>>,
      async (argumentsValue) => {
        try {
          const secrets = resolveCommandSecrets(tool.command);
          const baseContext = {
            ...services,
            secrets,
            fetch: globalThis.fetch,
            fs: createFs(),
            env: createEnv(),
            progress(): void {
              return undefined;
            },
          };

          await assertCommandRequirements(tool.command, { ...baseContext, params: undefined });

          const params = validateToolArguments(tool.command.params, argumentsValue, casing);
          const result = await tool.command.handler({
            ...baseContext,
            params,
          } as Parameters<typeof tool.command.handler>[0]);

          return toToolContent(result);
        } catch (error) {
          throw toToolError(error);
        }
      }
    );
  }

  return {
    ...server,
    connect(transport: SDKTransport): Promise<void> {
      return server.connectSDK(transport);
    },
  };
}

export async function runMCP<TServices extends object = Record<string, unknown>>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunMCPOptions<TServices>
): Promise<void> {
  const server = createMCPServer(roots, options);
  await server.listen();
}
