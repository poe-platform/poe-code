import { access, lstat, readFile, rename, unlink, writeFile } from "node:fs/promises";
import {
  createServer,
  JSON_RPC_ERROR_CODES,
  ToolError,
  type ToolHandler,
  type SDKTransport,
  type Server as TinyServer,
  type TypedSchema
} from "tiny-stdio-mcp-server";
import { toJsonSchema, type AnySchema, type JsonSchema, type ObjectSchema } from "toolcraft-schema";
import type { Command, Group, HandlerEnv, HandlerFs } from "./index.js";
import { createHttpErrorEnvelope, isHttpErrorLike } from "./api-error-summary.js";
import {
  ToolcraftBugError,
  UserError,
  assertCommandRequirements,
  resolveCommandSecrets
} from "./index.js";
import { writeErrorReport, type ErrorReportsOption } from "./error-report.js";
import { mergeApprovalsGroup } from "./human-in-loop/approvals-commands.js";
import {
  ApprovalDeclinedError,
  invokeWithHumanInLoop,
  type HumanInLoopPending,
  type HumanInLoopRuntimeOptions
} from "./human-in-loop/index.js";
import { hasMcpProxyGroups, resolveMcpProxies } from "./mcp-proxy.js";
import { getExpectedNumberDescription, isValidNumberSchemaValue } from "./number-schema.js";
import { findEntrypointPackageMetadata } from "./package-metadata.js";
import { filterSchemaForScope } from "./schema-scope.js";
import { enableSourceMaps } from "./stack-trim.js";
import { suggest } from "./suggest.js";
import { throwValidationErrors, type ValidationError } from "./validation-errors.js";

const RESERVED_SERVICE_NAMES = new Set([
  "params",
  "secrets",
  "fetch",
  "fs",
  "env",
  "progress",
  "runtimeOptions",
  "root"
]);
const RESERVED_SERVICE_NAMES_MESSAGE =
  "Available reserved names: params, secrets, fetch, fs, env, progress, runtimeOptions, root.";

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
  commandPath: string;
  description: string;
  inputSchema: JsonSchema;
  name: string;
  outputSchema?: JsonSchema;
  resultSchema?: ObjectSchema<any>;
}

export interface RunMCPOptions<TServices extends object = Record<string, unknown>> {
  approvals?: boolean;
  fetch?: typeof globalThis.fetch;
  name: string;
  version?: string;
  humanInLoop?: HumanInLoopRuntimeOptions;
  projectRoot?: string;
  /**
   * Optional allowlist of MCP tool names or group prefixes.
   *
   * Tool names always use `__`-joined snake_case path segments, for example
   * `root__bot__create`.
   *
   * Passing a group prefix like `root__bot` includes every descendant tool in
   * that subtree.
   */
  tools?: string[];
  /**
   * Omit the root group name from MCP tool names for a single root group.
   *
   * Defaults to false, so existing MCP tool names keep the root group prefix.
   */
  omitRootToolNamePrefix?: boolean;
  services?: TServices;
  errorReports?: ErrorReportsOption;
  /**
   * Controls MCP input-schema key casing and accepted argument-key casing.
   *
   * This does not change tool names. Tool names always stay `__`-joined
   * snake_case path segments.
   */
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
    children: roots
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
      previous !== undefined &&
      previous === previous.toLowerCase() &&
      previous !== previous.toUpperCase();
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
    .map((word, index) => (index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`))
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
    writeFile: async (
      path: string,
      contents: string,
      options?: { encoding?: BufferEncoding; flag?: string; mode?: number }
    ) => {
      await writeFile(path, contents, options);
    },
    exists: async (path: string) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    lstat: async (path: string) => lstat(path),
    rename: async (fromPath: string, toPath: string) => rename(fromPath, toPath),
    unlink: async (path: string) => unlink(path)
  };
}

function createEnv(values: Record<string, string | undefined> = process.env): HandlerEnv {
  return {
    get(key: string): string | undefined {
      return values[key];
    }
  };
}

function validateServices(services: Record<string, unknown>): void {
  for (const name of Object.keys(services)) {
    if (RESERVED_SERVICE_NAMES.has(name)) {
      throw new Error(
        `Service name "${name}" is reserved. Choose a different name. ${RESERVED_SERVICE_NAMES_MESSAGE}`
      );
    }
  }
}

function formatAvailableList(values: Iterable<string>): string {
  return `Available: ${[...values].sort().join(", ")}.`;
}

function applySchemaCasing(schema: JsonSchema, casing: Casing): JsonSchema {
  const oneOf = schema.oneOf?.map((child) => applySchemaCasing(child, casing));
  const additionalProperties =
    typeof schema.additionalProperties === "object" && schema.additionalProperties !== null
      ? applySchemaCasing(schema.additionalProperties, casing)
      : schema.additionalProperties;

  if (schema.type !== "object" || schema.properties === undefined) {
    if (schema.type === "array" && schema.items !== undefined) {
      return {
        ...schema,
        ...(additionalProperties === undefined ? {} : { additionalProperties }),
        items: applySchemaCasing(schema.items, casing),
        ...(oneOf === undefined ? {} : { oneOf })
      };
    }

    return {
      ...schema,
      ...(additionalProperties === undefined ? {} : { additionalProperties }),
      ...(oneOf === undefined ? {} : { oneOf })
    };
  }

  const properties = Object.fromEntries(
    Object.entries(schema.properties).map(([key, value]) => [
      formatSegment(key, casing),
      applySchemaCasing(value, casing)
    ])
  );
  const required = schema.required?.map((key) => formatSegment(key, casing));

  return {
    ...schema,
    ...(additionalProperties === undefined ? {} : { additionalProperties }),
    properties,
    ...(required === undefined ? {} : { required }),
    ...(oneOf === undefined ? {} : { oneOf })
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
  examples: Command<any, any, any, any>["examples"],
  commandName: string,
  casing: Casing
): string {
  const summary = collectParamSummaries(params, casing);
  const parameterSummary = summary.length === 0 ? "" : `Parameters: ${summary.join(", ")}.`;
  const exampleSummary =
    examples.length === 0
      ? ""
      : `\n\nExamples:\n${examples
          .map(
            (example) =>
              `- ${example.title}: ${commandName} ${formatMcpExampleParams(example.params)}`
          )
          .join("\n")}`;

  if (description === undefined) {
    return `${parameterSummary}${exampleSummary}`;
  }

  if (parameterSummary.length === 0) {
    return `${description}${exampleSummary}`;
  }

  return `${description} ${parameterSummary}${exampleSummary}`;
}

function formatMcpExampleParams(params: Record<string, unknown>): string {
  return Object.entries(params)
    .map(([key, value]) => `${key}=${formatMcpExampleValue(value)}`)
    .join(" ");
}

function formatMcpExampleValue(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function matchesAllowlist(toolName: string, allowlist: string[] | undefined): boolean {
  if (allowlist === undefined) {
    return true;
  }

  const segments = toolName.split("__");
  const candidates = segments.map((_segment, index) => segments.slice(0, index + 1).join("__"));
  return candidates.some((candidate) => allowlist.includes(candidate));
}

function formatToolName(path: string[]): string {
  return path.map((segment) => formatSegment(segment, "snake")).join("__");
}

function validateUniqueMCPParameterFields(schema: ObjectSchema<any>, casing: Casing): void {
  const sourceKeysByField = new Map<string, string>();

  for (const [key, rawChildSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const field = formatSegment(key, casing);
    const existingKey = sourceKeysByField.get(field);

    if (existingKey !== undefined) {
      throw new UserError(
        `Parameters "${existingKey}" and "${key}" use conflicting MCP field "${field}".`
      );
    }

    sourceKeysByField.set(field, key);

    const childSchema = unwrapOptional(rawChildSchema);
    if (childSchema.kind === "object") {
      validateUniqueMCPParameterFields(childSchema, casing);
    }
  }
}

function enumerateTools<TServices extends object>(
  root: Group<TServices>,
  casing: Casing,
  allowlist: string[] | undefined,
  omitRootToolNamePrefix: boolean
): ToolDefinition<TServices>[] {
  const tools: ToolDefinition<TServices>[] = [];
  const commandPathsByToolName = new Map<string, string>();

  function visit(
    node: Command<TServices, any, any, any> | Group<TServices>,
    toolPath: string[],
    commandPath: string[]
  ): void {
    if (node.kind === "command") {
      if (!node.scope.includes("mcp")) {
        return;
      }

      const name = formatToolName([...toolPath, node.name]);
      const params = filterSchemaForScope(node.params, "mcp");
      if (!matchesAllowlist(name, allowlist)) {
        return;
      }

      if (params === undefined || params.kind !== "object") {
        throw new ToolcraftBugError(
          `command "${name}" must define an object params schema for MCP.`
        );
      }

      validateUniqueMCPParameterFields(params, casing);
      if (node.result !== undefined) {
        validateUniqueMCPParameterFields(node.result, casing);
      }

      const resolvedCommandPath = [...commandPath, node.name].join(".");
      const existingPath = commandPathsByToolName.get(name);
      if (existingPath !== undefined) {
        throw new UserError(
          `MCP commands "${existingPath}" and "${resolvedCommandPath}" use conflicting tool name "${name}".`
        );
      }

      commandPathsByToolName.set(name, resolvedCommandPath);

      tools.push({
        command: node,
        commandPath: resolvedCommandPath,
        name,
        description: buildToolDescription(
          node.description,
          params,
          node.examples,
          node.name,
          casing
        ),
        inputSchema: applySchemaCasing(toJsonSchema(params), casing),
        ...(node.result === undefined
          ? {}
          : {
              outputSchema: applySchemaCasing(toJsonSchema(node.result), casing),
              resultSchema: node.result
            })
      });
      return;
    }

    const nextToolPath = [...toolPath, node.name];
    const nextCommandPath = [...commandPath, node.name];

    for (const child of node.children) {
      visit(child, nextToolPath, nextCommandPath);
    }
  }

  const rootPath = omitRootToolNamePrefix || root.name.length === 0 ? [] : [root.name];

  for (const child of root.children) {
    visit(child, rootPath, []);
  }

  return tools;
}

function isHumanInLoopPending(result: unknown): result is HumanInLoopPending {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { status?: unknown }).status === "pending-approval" &&
    typeof (result as { approvalId?: unknown }).approvalId === "string" &&
    typeof (result as { message?: unknown }).message === "string" &&
    typeof (result as { enqueuedAt?: unknown }).enqueuedAt === "string"
  );
}

function renderPendingApproval(pending: HumanInLoopPending): {
  isError: false;
  content: ToolContent[];
} {
  return {
    isError: false,
    content: [
      {
        type: "text",
        text: `Queued for human approval (id: ${pending.approvalId}). Track with \`toolcraft approvals show ${pending.approvalId}\`.`
      },
      {
        type: "text",
        text: JSON.stringify(pending)
      }
    ]
  };
}

function renderDeclinedApproval(error: ApprovalDeclinedError): {
  isError: true;
  content: ToolContent[];
} {
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: error.reason === undefined ? "Declined." : `Declined: ${error.reason}`
      },
      {
        type: "text",
        text: JSON.stringify({
          outcome: "declined",
          reason: error.reason,
          commandPath: error.commandPath
        })
      }
    ]
  };
}

function formatEnumError(
  value: unknown,
  schema: Extract<AnySchema, { kind: "enum" }>,
  label: string
): string {
  const suggestionLine =
    typeof value === "string"
      ? formatEnumSuggestionLine(
          value,
          schema.values.map((candidate) => String(candidate))
        )
      : " ";
  return `Invalid value for "${label}".${suggestionLine}Expected one of: ${schema.values.map((candidate) => String(candidate)).join(", ")}, got ${describeReceived(value)}.`;
}

function formatEnumSuggestionLine(value: string, values: readonly string[]): string {
  const suggestions = suggest(value, values);
  return suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?\n` : " ";
}

function describeReceived(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "missing";
  if (Array.isArray(value)) return `array(${value.length})`;
  if (typeof value === "object") return "object";
  if (typeof value === "string") {
    const s = value.length > 40 ? `${value.slice(0, 40)}…` : value;
    return `${JSON.stringify(s)}`;
  }
  return JSON.stringify(value);
}

function validateSchemaValue(
  schema: AnySchema,
  value: unknown,
  casing: Casing,
  label: string,
  errors: ValidationError[]
): unknown {
  const unwrappedSchema = unwrapOptional(schema);

  if (value === null && unwrappedSchema.nullable === true) {
    return null;
  }

  switch (unwrappedSchema.kind) {
    case "string":
      if (typeof value !== "string") {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected a string, got ${describeReceived(value)}.`
        });
      } else {
        validateStringConstraints(unwrappedSchema, value, label, errors);
      }
      return value;

    case "number":
      if (!isValidNumberSchemaValue(value, unwrappedSchema)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected ${getExpectedNumberDescription(unwrappedSchema)}, got ${describeReceived(value)}.`
        });
      }
      return value;

    case "boolean":
      if (typeof value !== "boolean") {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected a boolean, got ${describeReceived(value)}.`
        });
      }
      return value;

    case "enum":
      if (!unwrappedSchema.values.includes(value as never)) {
        errors.push({ path: label, message: formatEnumError(value, unwrappedSchema, label) });
      }
      return value;

    case "array":
      if (!Array.isArray(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an array, got ${describeReceived(value)}.`
        });
        return value;
      }
      validateArrayConstraints(unwrappedSchema, value, label, errors);
      return value.map((item, index) =>
        validateSchemaValue(unwrappedSchema.item, item, casing, `${label}[${index}]`, errors)
      );

    case "object":
      return validateObjectSchema(unwrappedSchema, value, casing, label, errors);

    case "json":
      return value;

    case "record": {
      if (!isPlainObject(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
        });
        return value;
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          validateSchemaValue(unwrappedSchema.value, item, casing, `${label}.${key}`, errors)
        ])
      );
    }

    case "oneOf": {
      if (!isPlainObject(value)) {
        return value;
      }
      const discriminatorKey = formatSegment(unwrappedSchema.discriminator, casing);
      const discriminator = value[discriminatorKey];
      const branch =
        typeof discriminator === "string" ? unwrappedSchema.branches[discriminator] : undefined;
      if (branch === undefined) {
        return value;
      }
      const { [discriminatorKey]: ignoredDiscriminator, ...branchValue } = value;
      void ignoredDiscriminator;
      return {
        [unwrappedSchema.discriminator]: discriminator,
        ...validateObjectSchema(branch, branchValue, casing, label, errors)
      };
    }

    case "union": {
      if (!isPlainObject(value)) {
        return value;
      }
      const branch = unwrappedSchema.branches.find((candidate) =>
        Object.keys(candidate.shape).every(
          (key) =>
            candidate.shape[key]?.kind === "optional" ||
            Object.prototype.hasOwnProperty.call(value, formatSegment(key, casing))
        )
      );
      return branch === undefined
        ? value
        : validateObjectSchema(branch, value, casing, label, errors);
    }
  }
}

function validateStringConstraints(
  schema: Extract<AnySchema, { kind: "string" }>,
  value: string,
  label: string,
  errors: ValidationError[]
): void {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected a string with length at least ${schema.minLength}, got string with length ${value.length}.`
    });
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected a string with length at most ${schema.maxLength}, got string with length ${value.length}.`
    });
  }

  if (schema.pattern !== undefined && !new RegExp(schema.pattern).test(value)) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}": "${value}" does not match pattern "${schema.pattern}".`
    });
  }
}

function validateArrayConstraints(
  schema: Extract<AnySchema, { kind: "array" }>,
  value: unknown[],
  label: string,
  errors: ValidationError[]
): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an array with at least ${schema.minItems} items, got array(${value.length}).`
    });
  }

  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an array with at most ${schema.maxItems} items, got array(${value.length}).`
    });
  }
}

function validateObjectSchema(
  schema: ObjectSchema<any>,
  value: unknown,
  casing: Casing,
  label: string,
  errors: ValidationError[]
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
    });
    return {};
  }

  const result: Record<string, unknown> = {};
  const expectedKeys = new Map<string, [string, AnySchema]>();

  for (const [key, childSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    expectedKeys.set(formatSegment(key, casing), [key, childSchema]);
  }

  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key)) {
      if (schema.additionalProperties === true) {
        Object.defineProperty(result, key, {
          value: value[key],
          enumerable: true,
          configurable: true,
          writable: true
        });
        continue;
      }
      const fieldLabel = label.length === 0 ? key : `${label}.${key}`;
      errors.push({
        path: fieldLabel,
        message: `Unexpected parameter "${fieldLabel}". ${formatAvailableList(
          [...expectedKeys.keys()].map((expectedKey) =>
            label.length === 0 ? expectedKey : `${label}.${expectedKey}`
          )
        )}`
      });
    }
  }

  for (const [inputKey, [outputKey, rawChildSchema]] of expectedKeys.entries()) {
    const childSchema = unwrapOptional(rawChildSchema);
    const hasValue = Object.prototype.hasOwnProperty.call(value, inputKey);
    const fieldLabel = label.length === 0 ? inputKey : `${label}.${inputKey}`;

    if (!hasValue) {
      if (childSchema.default !== undefined) {
        Object.defineProperty(result, outputKey, {
          value: childSchema.default,
          enumerable: true,
          configurable: true,
          writable: true
        });
        continue;
      }

      if (isOptional(rawChildSchema)) {
        continue;
      }

      errors.push({ path: fieldLabel, message: `Missing required parameter "${fieldLabel}".` });
      continue;
    }

    Object.defineProperty(result, outputKey, {
      value: validateSchemaValue(rawChildSchema, value[inputKey], casing, fieldLabel, errors),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return result;
}

function validateToolArguments(
  schema: ObjectSchema<any>,
  argumentsValue: Record<string, unknown> | undefined,
  casing: Casing
): Record<string, unknown> {
  const errors: ValidationError[] = [];
  const result = validateObjectSchema(schema, argumentsValue ?? {}, casing, "", errors);
  throwValidationErrors(errors);
  return result;
}

function serializeResultValue(
  schema: AnySchema,
  value: unknown,
  casing: Casing,
  label: string,
  errors: ValidationError[]
): unknown {
  const unwrappedSchema = unwrapOptional(schema);

  if (value === null && unwrappedSchema.nullable === true) {
    return null;
  }

  switch (unwrappedSchema.kind) {
    case "object":
      return serializeResultObject(unwrappedSchema, value, casing, label, errors);

    case "array":
      if (!Array.isArray(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an array, got ${describeReceived(value)}.`
        });
        return value;
      }
      return value.map((item, index) =>
        serializeResultValue(unwrappedSchema.item, item, casing, `${label}[${index}]`, errors)
      );

    case "record":
      if (!isPlainObject(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
        });
        return value;
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
          key,
          serializeResultValue(unwrappedSchema.value, item, casing, `${label}.${key}`, errors)
        ])
      );

    case "oneOf": {
      if (!isPlainObject(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
        });
        return value;
      }
      const discriminator = value[unwrappedSchema.discriminator];
      const branch =
        typeof discriminator === "string" ? unwrappedSchema.branches[discriminator] : undefined;
      if (branch === undefined) {
        const branchNames = Object.keys(unwrappedSchema.branches);
        errors.push({
          path:
            label.length === 0
              ? unwrappedSchema.discriminator
              : `${label}.${unwrappedSchema.discriminator}`,
          message: `Invalid value for "${label.length === 0 ? unwrappedSchema.discriminator : `${label}.${unwrappedSchema.discriminator}`}". Expected one of: ${branchNames.join(", ")}, got ${describeReceived(discriminator)}.`
        });
        return value;
      }
      const { [unwrappedSchema.discriminator]: ignoredDiscriminator, ...branchValue } = value;
      void ignoredDiscriminator;
      return {
        [formatSegment(unwrappedSchema.discriminator, casing)]: discriminator,
        ...serializeResultObject(branch, branchValue, casing, label, errors)
      };
    }

    case "union": {
      if (!isPlainObject(value)) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
        });
        return value;
      }
      const branch = unwrappedSchema.branches.find((candidate) =>
        Object.keys(candidate.shape).every(
          (key) =>
            candidate.shape[key]?.kind === "optional" ||
            Object.prototype.hasOwnProperty.call(value, key)
        )
      );
      if (branch === undefined) {
        errors.push({
          path: label,
          message: `Invalid value for "${label}". Expected one union branch, got ${describeReceived(value)}.`
        });
        return value;
      }
      return serializeResultObject(branch, value, casing, label, errors);
    }

    default:
      return validateSchemaValue(schema, value, casing, label, errors);
  }
}

function serializeResultObject(
  schema: ObjectSchema<any>,
  value: unknown,
  casing: Casing,
  label: string,
  errors: ValidationError[]
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    errors.push({
      path: label,
      message: `Invalid value for "${label}". Expected an object, got ${describeReceived(value)}.`
    });
    return {};
  }

  const result: Record<string, unknown> = {};
  const expectedKeys = new Set(Object.keys(schema.shape));

  for (const key of Object.keys(value)) {
    if (!expectedKeys.has(key) && schema.additionalProperties !== true) {
      const fieldLabel = label.length === 0 ? key : `${label}.${key}`;
      errors.push({
        path: fieldLabel,
        message: `Unexpected result field "${fieldLabel}". ${formatAvailableList(
          [...expectedKeys].map((expectedKey) =>
            label.length === 0 ? expectedKey : `${label}.${expectedKey}`
          )
        )}`
      });
    }
  }

  for (const [sourceKey, rawChildSchema] of Object.entries(schema.shape) as Array<
    [string, AnySchema]
  >) {
    const childSchema = unwrapOptional(rawChildSchema);
    const hasValue = Object.prototype.hasOwnProperty.call(value, sourceKey);
    const wireKey = formatSegment(sourceKey, casing);
    const fieldLabel = label.length === 0 ? sourceKey : `${label}.${sourceKey}`;

    if (!hasValue) {
      if (childSchema.default !== undefined) {
        Object.defineProperty(result, wireKey, {
          value: childSchema.default,
          enumerable: true,
          configurable: true,
          writable: true
        });
        continue;
      }

      if (isOptional(rawChildSchema)) {
        continue;
      }

      errors.push({ path: fieldLabel, message: `Missing required result field "${fieldLabel}".` });
      continue;
    }

    Object.defineProperty(result, wireKey, {
      value: serializeResultValue(rawChildSchema, value[sourceKey], casing, fieldLabel, errors),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  if (schema.additionalProperties === true) {
    for (const key of Object.keys(value)) {
      if (!expectedKeys.has(key)) {
        Object.defineProperty(result, key, {
          value: value[key],
          enumerable: true,
          configurable: true,
          writable: true
        });
      }
    }
  }

  return result;
}

function validateCommandResult(
  schema: ObjectSchema<any>,
  value: unknown,
  casing: Casing
): Record<string, unknown> {
  const errors: ValidationError[] = [];
  const result = serializeResultObject(schema, value, casing, "", errors);
  throwResultValidationErrors(errors);
  return result;
}

function throwResultValidationErrors(errors: readonly ValidationError[]): void {
  if (errors.length === 0) {
    return;
  }

  if (errors.length === 1) {
    throw new ToolError(
      JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
      errors[0]?.message ?? "Invalid command result."
    );
  }

  const rendered = errors.slice(0, 10).map((error) => `  - ${error.path}: ${error.message}`);
  const remaining = errors.length - rendered.length;

  if (remaining > 0) {
    rendered.push(`  ... and ${remaining} more`);
  }

  throw new ToolError(
    JSON_RPC_ERROR_CODES.INTERNAL_ERROR,
    `${errors.length} result errors:\n${rendered.join("\n")}`
  );
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

  if (typeof result === "string" || typeof result === "number" || typeof result === "boolean") {
    return [{ type: "text", text: String(result) }];
  }

  if (result === null) {
    return [{ type: "text", text: "null" }];
  }

  if (isContentBlock(result)) {
    return [result];
  }

  const fallbackValue = result;
  const fallbackText = JSON.stringify(fallbackValue);
  return [{ type: "text", text: fallbackText }];
}

function toToolError(error: unknown, reportPath?: string): ToolError {
  if (error instanceof ToolError) {
    return error;
  }

  if (isHttpErrorLike(error)) {
    const code =
      error.response.status >= 400 && error.response.status < 500
        ? JSON_RPC_ERROR_CODES.INVALID_PARAMS
        : JSON_RPC_ERROR_CODES.INTERNAL_ERROR;
    const envelope = createHttpErrorEnvelope(error, reportPath);
    return new ToolError(code, envelope.message, envelope);
  }

  if (error instanceof UserError) {
    return new ToolError(JSON_RPC_ERROR_CODES.INVALID_PARAMS, error.message);
  }

  if (error instanceof Error) {
    return new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR, error.message);
  }

  return new ToolError(JSON_RPC_ERROR_CODES.INTERNAL_ERROR, String(error));
}

function createResolvedMCPServer<TServices extends object = Record<string, unknown>>(
  root: Group<TServices>,
  options: RunMCPOptions<TServices>
): CmdkitServer {
  const casing = options.casing ?? "snake";
  const services = (options.services ?? {}) as TServices;
  const runtimeOptions = options.humanInLoop ?? {};
  const runtimeFetch = options.fetch ?? globalThis.fetch;
  const servicesWithBuiltIns = {
    ...services,
    runtimeOptions,
    root
  } as TServices;
  validateServices(services as Record<string, unknown>);

  const tools = enumerateTools(
    root,
    casing,
    options.tools,
    options.omitRootToolNamePrefix ?? false
  );
  const version = resolveMCPVersion(options.version);
  const server = createServer({
    name: options.name,
    version,
    validateToolArguments: false
  });

  for (const tool of tools) {
    const handler = async (argumentsValue: Record<string, unknown>) => {
      let params: unknown;
      let secrets: Record<string, string | undefined> | undefined;
      try {
        secrets = resolveCommandSecrets(tool.command);
        const baseContext = {
          ...servicesWithBuiltIns,
          secrets,
          fetch: runtimeFetch,
          fs: createFs(),
          env: createEnv(),
          progress(): void {
            return undefined;
          }
        };

        await assertCommandRequirements(tool.command, { ...baseContext, params: undefined });

        params = validateToolArguments(tool.command.params, argumentsValue, casing);
        const result = await invokeWithHumanInLoop(
          tool.command,
          {
            ...baseContext,
            params
          } as Parameters<typeof tool.command.handler>[0],
          runtimeOptions,
          tool.commandPath
        );

        if (isHumanInLoopPending(result)) {
          return renderPendingApproval(result);
        }

        if (tool.resultSchema !== undefined) {
          const structuredContent = validateCommandResult(tool.resultSchema, result, casing);
          return {
            content: [{ type: "text", text: JSON.stringify(structuredContent) }],
            structuredContent
          };
        }

        return toToolContent(result);
      } catch (error) {
        if (error instanceof ApprovalDeclinedError) {
          return renderDeclinedApproval(error);
        }

        const report = await writeErrorReport({
          command: tool.command,
          commandPath: tool.commandPath,
          env: process.env,
          error,
          errorReports: options.errorReports,
          params,
          projectRoot: options.projectRoot,
          secrets
        });
        throw toToolError(error, report?.displayPath);
      }
    };

    if (tool.outputSchema === undefined) {
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema as TypedSchema<Record<string, unknown>>,
        handler as ToolHandler<Record<string, unknown>>
      );
    } else {
      server.tool(
        tool.name,
        tool.description,
        tool.inputSchema as TypedSchema<Record<string, unknown>>,
        handler as ToolHandler<Record<string, unknown>, Record<string, unknown>>,
        tool.outputSchema as TypedSchema<Record<string, unknown>>
      );
    }
  }

  return {
    ...server,
    connect(transport: SDKTransport): Promise<void> {
      return server.connectSDK(transport);
    }
  };
}

function resolveMCPVersion(version: string | undefined): string {
  const resolvedVersion = version ?? findEntrypointPackageMetadata(process.argv[1])?.version;

  if (resolvedVersion === undefined) {
    throw new Error(
      'MCP server version is required. Pass version: "x.y.z" to createMCPServer / runMCP, or run toolcraft from a project whose package.json defines "version".'
    );
  }

  return resolvedVersion;
}

function createDeferredMCPServer<TServices extends object = Record<string, unknown>>(
  root: Group<TServices>,
  options: RunMCPOptions<TServices>
): CmdkitServer {
  let serverPromise: Promise<CmdkitServer> | undefined;

  const resolveServer = (): Promise<CmdkitServer> => {
    serverPromise ??= (async () => {
      await resolveMcpProxies(root, { projectRoot: options.projectRoot });
      return createResolvedMCPServer(root, options);
    })();

    return serverPromise;
  };

  return new Proxy(
    {
      listen(): Promise<void> {
        return resolveServer().then((server) => server.listen());
      },
      connect(transport: SDKTransport): Promise<void> {
        return resolveServer().then((server) => server.connect(transport));
      }
    } as CmdkitServer,
    {
      get(target, property, receiver) {
        if (property === "then") {
          return resolveServer().then.bind(resolveServer());
        }

        return Reflect.get(target, property, receiver);
      }
    }
  );
}

export function createMCPServer<TServices extends object = Record<string, unknown>>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunMCPOptions<TServices>
): CmdkitServer {
  const normalizedRoot = normalizeRoots(roots);
  const root = options.approvals === true ? mergeApprovalsGroup(normalizedRoot) : normalizedRoot;

  if (!hasMcpProxyGroups(root)) {
    return createResolvedMCPServer(root, options);
  }

  return createDeferredMCPServer(root, options);
}

export async function runMCP<TServices extends object = Record<string, unknown>>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunMCPOptions<TServices>
): Promise<void> {
  enableSourceMaps();
  const normalizedRoot = normalizeRoots(roots);
  const root = options.approvals === true ? mergeApprovalsGroup(normalizedRoot) : normalizedRoot;
  await resolveMcpProxies(root, { projectRoot: options.projectRoot });
  const server = createResolvedMCPServer(root, options);
  await server.listen();
}
