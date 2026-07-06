import { isDeepStrictEqual } from "node:util";
import type { AnySchema, ObjectSchema } from "toolcraft-schema";
import {
  McpClient,
  McpError,
  ERROR_INVALID_PARAMS,
  createSdkTestPair,
  type McpClientConnection
} from "tiny-mcp-client";
import { runCLI } from "../cli.js";
import type { Command, Group, HandlerFs, Scope } from "../index.js";
import { UserError } from "../index.js";
import { createMCPServer } from "../mcp.js";
import { filterSchemaForScope } from "../schema-scope.js";
import { createSDK } from "../sdk.js";

export interface SurfaceOutcome {
  ok: boolean;
  value: unknown;
  error: unknown;
}

export interface ParityResult {
  sdk: SurfaceOutcome;
  mcp: SurfaceOutcome;
  cli: SurfaceOutcome;
  agree: boolean;
  diff?: string;
}

export interface ParityOptions<TServices extends object> {
  services: TServices;
  env?: Record<string, string>;
  fs: HandlerFs;
  fetch: typeof globalThis.fetch;
  apiVersion?: string;
}

export interface ParityCommand {
  command: Command<any, any, any, any>;
  path: string[];
}

class SurfaceScopeError extends Error {
  constructor(surface: Scope, path: string[]) {
    super(`Command "${path.join(" ")}" is filtered out of the ${surface} surface.`);
    this.name = "SurfaceScopeError";
  }
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

function formatName(value: string, casing: "camel" | "kebab" | "snake"): string {
  const words = splitWords(value);
  if (casing === "camel") {
    return words
      .map((word, index) =>
        index === 0 ? word : `${word.slice(0, 1).toUpperCase()}${word.slice(1)}`
      )
      .join("");
  }
  return words.join(casing === "kebab" ? "-" : "_");
}

function unwrapOptional(schema: AnySchema): AnySchema {
  return schema.kind === "optional" ? unwrapOptional(schema.inner) : schema;
}

function mapUnknownMCPObject(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [formatName(key, "snake"), child])
  );
}

function filterParams(
  schema: ObjectSchema<any>,
  params: Record<string, unknown>,
  surface: Scope
): Record<string, unknown> {
  const filtered = filterSchemaForScope(schema, surface);
  if (filtered?.kind !== "object") {
    return {};
  }

  return Object.fromEntries(
    Object.entries(filtered.shape).flatMap(([key, childSchema]) => {
      const value = params[key];
      if (value === undefined) {
        return [];
      }
      const unwrapped = unwrapOptional(childSchema);
      if (
        unwrapped.kind === "object" &&
        typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
      ) {
        return [[key, filterParams(unwrapped, value as Record<string, unknown>, surface)]];
      }
      return [[key, value]];
    })
  );
}

function mapMCPValue(schema: AnySchema, value: unknown): unknown {
  const unwrapped = unwrapOptional(schema);
  if (value === null || value === undefined) {
    return value;
  }

  switch (unwrapped.kind) {
    case "array":
      return Array.isArray(value) ? value.map((item) => mapMCPValue(unwrapped.item, item)) : value;
    case "object": {
      if (typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => {
          const childSchema = unwrapped.shape[key];
          return [
            formatName(key, "snake"),
            childSchema === undefined ? child : mapMCPValue(childSchema, child)
          ];
        })
      );
    }
    case "record":
      return typeof value === "object" && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).map(([key, child]) => [key, mapMCPValue(unwrapped.value, child)])
          )
        : value;
    case "oneOf": {
      if (typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      const objectValue = value as Record<string, unknown>;
      const discriminator = objectValue[unwrapped.discriminator];
      const branch =
        typeof discriminator === "string" ? unwrapped.branches[discriminator] : undefined;
      return branch === undefined
        ? mapUnknownMCPObject(objectValue)
        : mapMCPValue(branch, objectValue);
    }
    case "union": {
      if (typeof value !== "object" || Array.isArray(value)) {
        return value;
      }
      const objectValue = value as Record<string, unknown>;
      const branch = unwrapped.branches.find((candidate) =>
        Object.keys(candidate.shape).every(
          (key) =>
            candidate.shape[key]?.kind === "optional" ||
            Object.prototype.hasOwnProperty.call(objectValue, key)
        )
      );
      return branch === undefined
        ? mapUnknownMCPObject(objectValue)
        : mapMCPValue(branch, objectValue);
    }
    case "boolean":
    case "enum":
    case "json":
    case "number":
    case "string":
      return value;
  }
}

function success(value: unknown): SurfaceOutcome {
  return { ok: true, value, error: undefined };
}

function failure(error: unknown): SurfaceOutcome {
  return { ok: false, value: undefined, error };
}

async function runSDK(
  root: Group<any>,
  resolved: ParityCommand,
  params: Record<string, unknown>,
  options: ParityOptions<any>
): Promise<SurfaceOutcome> {
  if (!resolved.command.scope.includes("sdk")) {
    return failure(new SurfaceScopeError("sdk", resolved.path));
  }

  try {
    let member: unknown = createSDK(root, options);
    for (const segment of resolved.path) {
      member = (member as Record<string, unknown>)[formatName(segment, "camel")];
    }
    if (typeof member !== "function") {
      throw new Error(`SDK command "${resolved.path.join(".")}" is not callable.`);
    }
    return success(await member(filterParams(resolved.command.params, params, "sdk")));
  } catch (error) {
    return failure(error);
  }
}

function parseMcpValue(
  result: {
    structuredContent?: unknown;
    content: Array<{ type: string; text?: string }>;
  },
  reference?: SurfaceOutcome
): unknown {
  if (result.structuredContent !== undefined) {
    return result.structuredContent;
  }

  const text = result.content
    .filter((item) => item.type === "text" && item.text !== undefined)
    .map((item) => item.text)
    .join("\n");
  if (text.length === 0) {
    return undefined;
  }
  if (reference?.ok === true && isDeepStrictEqual(text, reference.value)) {
    return text;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

async function runMCP(
  root: Group<any>,
  resolved: ParityCommand,
  params: Record<string, unknown>,
  options: ParityOptions<any>,
  reference?: SurfaceOutcome
): Promise<SurfaceOutcome> {
  if (!resolved.command.scope.includes("mcp")) {
    return failure(new SurfaceScopeError("mcp", resolved.path));
  }

  const server = createMCPServer(root, {
    ...options,
    name: `${root.name}-parity`,
    version: "0.0.0",
    casing: "snake"
  });
  const client = new McpClient({
    clientInfo: { name: "toolcraft-parity", version: "0.0.0" }
  });
  const pair = await createSdkTestPair(server, () => client as unknown as McpClientConnection);

  try {
    const toolName = [root.name, ...resolved.path]
      .map((segment) => formatName(segment, "snake"))
      .join("__");
    const argumentsValue = mapMCPValue(
      resolved.command.params,
      filterParams(resolved.command.params, params, "mcp")
    ) as Record<string, unknown>;
    const result = await client.callTool({ name: toolName, arguments: argumentsValue });
    return success(parseMcpValue(result, reference));
  } catch (error) {
    if (error instanceof McpError && error.code === ERROR_INVALID_PARAMS) {
      return failure(new UserError(error.message));
    }
    return failure(error);
  } finally {
    await pair.cleanup();
  }
}

function valueAtPath(value: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, segment) =>
      typeof current === "object" && current !== null
        ? (current as Record<string, unknown>)[segment]
        : undefined,
    value
  );
}

function appendCLIValue(argv: string[], flag: string, value: unknown): void {
  if (typeof value === "boolean") {
    argv.push(value ? flag : `--no-${flag.slice(2)}`);
    return;
  }
  if (Array.isArray(value)) {
    argv.push(flag, ...value.map((item) => String(item)));
    return;
  }
  argv.push(flag, typeof value === "object" ? JSON.stringify(value) : String(value));
}

function appendCLIFlags(
  argv: string[],
  schema: ObjectSchema<any>,
  params: Record<string, unknown>,
  positionals: Set<string>,
  sourcePath: string[] = [],
  flagPath: string[] = []
): void {
  for (const [key, rawSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const nextSourcePath = [...sourcePath, key];
    const nextFlagPath = [...flagPath, formatName(key, "kebab")];
    const displayPath = nextSourcePath.join(".");
    const value = params[key];
    if (value === undefined || positionals.has(displayPath)) {
      continue;
    }

    const childSchema = unwrapOptional(rawSchema);
    if (
      childSchema.kind === "object" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      appendCLIFlags(
        argv,
        childSchema,
        value as Record<string, unknown>,
        positionals,
        nextSourcePath,
        nextFlagPath
      );
      continue;
    }

    if (
      childSchema.kind === "record" &&
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value)
    ) {
      for (const [recordKey, recordValue] of Object.entries(value)) {
        appendCLIValue(argv, `--${[...nextFlagPath, recordKey].join(".")}`, recordValue);
      }
      continue;
    }

    appendCLIValue(argv, `--${nextFlagPath.join(".")}`, value);
  }
}

function buildCLIArgv(
  root: Group<any>,
  resolved: ParityCommand,
  params: Record<string, unknown>
): string[] {
  const visibleParams = filterParams(resolved.command.params, params, "cli");
  const argv = ["node", root.name, ...resolved.path.map((segment) => formatName(segment, "kebab"))];
  for (const positional of resolved.command.positional) {
    const value = valueAtPath(visibleParams, positional.split("."));
    if (Array.isArray(value)) {
      argv.push(...value.map((item) => String(item)));
    } else if (value !== undefined) {
      argv.push(String(value));
    }
  }
  appendCLIFlags(
    argv,
    filterSchemaForScope(resolved.command.params, "cli") as ObjectSchema<any>,
    visibleParams,
    new Set(resolved.command.positional)
  );
  argv.push("--output", "json", "--debug");
  return argv;
}

function parseCLIValue(entries: string[], reference?: SurfaceOutcome): unknown {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry === undefined) {
      continue;
    }
    try {
      const parsed = JSON.parse(entry) as unknown;
      if (reference?.ok !== true || isDeepStrictEqual(parsed, reference.value)) {
        return parsed;
      }
      if (
        typeof parsed === "object" &&
        parsed !== null &&
        !Array.isArray(parsed) &&
        Object.keys(parsed).length === 1 &&
        Object.prototype.hasOwnProperty.call(parsed, "result") &&
        isDeepStrictEqual((parsed as { result: unknown }).result, reference.value)
      ) {
        return reference.value;
      }
      if (
        (reference.value === null || reference.value === undefined) &&
        isDeepStrictEqual(parsed, { ok: true })
      ) {
        return reference.value;
      }
      return parsed;
    } catch {
      continue;
    }
  }
  return entries.at(-1);
}

function parseCLIError(entries: string[]): UserError {
  const message = entries.at(-1) ?? "CLI command failed.";
  const lines = message.split("\n");
  const lastLine = lines.at(-1) ?? "";
  if (lastLine.startsWith("Run ") && lastLine.endsWith(" --help for usage.")) {
    lines.pop();
  }
  return new UserError(lines.join("\n"));
}

async function runCLISurface(
  root: Group<any>,
  resolved: ParityCommand,
  params: Record<string, unknown>,
  options: ParityOptions<any>,
  reference?: SurfaceOutcome
): Promise<SurfaceOutcome> {
  if (!resolved.command.scope.includes("cli")) {
    return failure(new SurfaceScopeError("cli", resolved.path));
  }

  const entries: string[] = [];
  const previousExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await runCLI(root, {
      ...options,
      argv: buildCLIArgv(root, resolved, params),
      controls: { debug: true, output: true },
      outputEmitter: (entry) => entries.push(entry)
    });
    if (process.exitCode !== undefined && process.exitCode !== 0) {
      return failure(parseCLIError(entries));
    }
    return success(parseCLIValue(entries, reference));
  } catch (error) {
    return failure(error);
  } finally {
    process.exitCode = previousExitCode;
  }
}

function errorIdentity(error: unknown): { name: string; message: string } {
  if (error instanceof Error) {
    return { name: error.constructor.name, message: error.message };
  }
  return { name: typeof error, message: String(error) };
}

function outcomesAgree(left: SurfaceOutcome, right: SurfaceOutcome): boolean {
  if (left.ok !== right.ok) {
    return false;
  }
  if (left.ok) {
    return isDeepStrictEqual(left.value, right.value);
  }
  return isDeepStrictEqual(errorIdentity(left.error), errorIdentity(right.error));
}

function describeOutcome(surface: Scope, outcome: SurfaceOutcome): string {
  if (outcome.ok) {
    return `${surface}: ok ${JSON.stringify(outcome.value)}`;
  }
  const error = errorIdentity(outcome.error);
  return `${surface}: error ${error.name}: ${error.message}`;
}

export async function runParity<TServices extends object>(
  root: Group<any>,
  resolved: ParityCommand,
  params: Record<string, unknown>,
  options: ParityOptions<TServices>
): Promise<ParityResult> {
  const sdk = await runSDK(root, resolved, params, options);
  const mcp = await runMCP(root, resolved, params, options, sdk);
  const cli = await runCLISurface(root, resolved, params, options, sdk);
  const agree = outcomesAgree(sdk, mcp) && outcomesAgree(sdk, cli);

  return {
    sdk,
    mcp,
    cli,
    agree,
    ...(agree
      ? {}
      : {
          diff: [
            `Surface outcomes differ for "${resolved.path.join(" ")}".`,
            describeOutcome("sdk", sdk),
            describeOutcome("mcp", mcp),
            describeOutcome("cli", cli)
          ].join("\n")
        })
  };
}
