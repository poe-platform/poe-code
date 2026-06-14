import path from "node:path";
import { parse } from "yaml";
import { S, validate } from "toolcraft-schema";
import type { Diagnostic } from "./diagnostics.js";
import { DIAGNOSTIC_CODES, createDiagnostic } from "./diagnostics.js";

export const SUPPORTED_TOOLCRAFT_EDITION = "2026-05-16";

export type ToolcraftHttpMethod =
  | "get"
  | "post"
  | "put"
  | "patch"
  | "delete"
  | "head"
  | "options";

export interface ToolcraftMethodConfig {
  method: ToolcraftHttpMethod;
  path: string;
  pagination?: string;
  idempotent?: boolean;
}

export interface ToolcraftResourceConfig {
  methods?: Record<string, ToolcraftMethodConfig>;
  subresources?: Record<string, ToolcraftResourceConfig>;
}

export interface ToolcraftConfig {
  edition: string;
  environments?: Record<string, string>;
  client_settings?: {
    idempotency_header?: string;
    auth?: Record<string, { env?: string }>;
  };
  pagination?: Record<
    string,
    {
      request: Record<string, string>;
      response: Record<string, string>;
    }
  >;
  retries?: {
    max?: number;
    backoff?: "exponential";
    retry_on?: number[];
  };
  resources?: Record<string, ToolcraftResourceConfig>;
  readme?: {
    examples?: Record<string, Array<{ title: string; params: Record<string, unknown> }>>;
  };
  unspecified_endpoints?: string[];
}

export interface ReadToolcraftConfigOptions {
  cwd?: string;
  fs?: {
    readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  };
}

export interface ToolcraftConfigResult {
  config?: ToolcraftConfig;
  diagnostics: Diagnostic[];
}

const configSchema = S.Object(
  {
    edition: S.Optional(S.String()),
    environments: S.Optional(S.Record(S.String())),
    client_settings: S.Optional(
      S.Object(
        {
          idempotency_header: S.Optional(S.String()),
          auth: S.Optional(
            S.Record(
              S.Object(
                {
                  env: S.Optional(S.String())
                },
                { additionalProperties: false }
              )
            )
          )
        },
        { additionalProperties: false }
      )
    ),
    pagination: S.Optional(
      S.Record(
        S.Object(
          {
            request: S.Record(S.String()),
            response: S.Record(S.String())
          },
          { additionalProperties: false }
        )
      )
    ),
    retries: S.Optional(
      S.Object(
        {
          max: S.Optional(S.Number({ jsonType: "integer", minimum: 0 })),
          backoff: S.Optional(S.Enum(["exponential"])),
          retry_on: S.Optional(S.Array(S.Number({ jsonType: "integer", minimum: 100, maximum: 599 })))
        },
        { additionalProperties: false }
      )
    ),
    resources: S.Optional(S.Json()),
    readme: S.Optional(S.Json()),
    unspecified_endpoints: S.Optional(S.Array(S.String()))
  },
  { additionalProperties: false }
);

export async function readToolcraftConfig(
  filePath: string,
  options: ReadToolcraftConfigOptions = {}
): Promise<ToolcraftConfigResult> {
  const fs = options.fs ?? (await import("node:fs/promises"));
  const resolvedPath = path.resolve(options.cwd ?? process.cwd(), filePath);
  const source = await fs.readFile(resolvedPath, "utf8");
  const parsed = parseToolcraftYaml(source);
  return validateToolcraftConfig(parsed);
}

function parseToolcraftYaml(source: string): unknown {
  try {
    return parse(source) as unknown;
  } catch {
    return parse(quoteMethodShorthandValues(source)) as unknown;
  }
}

function quoteMethodShorthandValues(source: string): string {
  let methodsIndent: number | undefined;

  return source
    .split("\n")
    .map((line) => {
      const trimmed = line.trim();
      if (trimmed.length === 0) {
        return line;
      }

      const indent = countLeadingSpaces(line);
      if (methodsIndent !== undefined && indent <= methodsIndent) {
        methodsIndent = undefined;
      }

      if (trimmed === "methods:") {
        methodsIndent = indent;
        return line;
      }

      if (methodsIndent === undefined) {
        return line;
      }

      const separatorIndex = line.indexOf(":");
      if (separatorIndex < 0) {
        return line;
      }

      const value = line.slice(separatorIndex + 1).trim();
      if (
        !value.includes("{") ||
        value.startsWith("{") ||
        value.startsWith("\"") ||
        value.startsWith("'")
      ) {
        return line;
      }

      return `${line.slice(0, separatorIndex + 1)} ${JSON.stringify(value)}`;
    })
    .join("\n");
}

function countLeadingSpaces(value: string): number {
  let count = 0;
  for (const character of value) {
    if (character !== " ") {
      break;
    }
    count += 1;
  }
  return count;
}

export function validateToolcraftConfig(value: unknown): ToolcraftConfigResult {
  const result = validate(configSchema, value);
  const diagnostics: Diagnostic[] = [];

  if (!isPlainObject(value) || typeof value.edition !== "string") {
    diagnostics.push(
      createDiagnostic({
        code: DIAGNOSTIC_CODES.invalidEdition,
        severity: "error",
        location: "edition",
        message: `toolcraft.yml must set edition: ${SUPPORTED_TOOLCRAFT_EDITION}.`
      })
    );
  } else if (value.edition !== SUPPORTED_TOOLCRAFT_EDITION) {
    diagnostics.push(
      createDiagnostic({
        code: DIAGNOSTIC_CODES.invalidEdition,
        severity: "error",
        location: "edition",
        message: `Unsupported edition ${JSON.stringify(value.edition)}. Expected ${SUPPORTED_TOOLCRAFT_EDITION}.`
      })
    );
  }

  if (!result.ok) {
    diagnostics.push(
      ...result.issues.map((issue) =>
        createDiagnostic({
          code: DIAGNOSTIC_CODES.invalidConfig,
          severity: "error",
          location: issue.path.join("."),
          message: issue.message
        })
      )
    );
  }

  if (diagnostics.length > 0 || !result.ok) {
    return { diagnostics };
  }

  return {
    config: normalizeToolcraftConfig(result.value),
    diagnostics
  };
}

export function mergeToolcraftConfig(
  base: Partial<ToolcraftConfig>,
  override: Partial<ToolcraftConfig>
): Partial<ToolcraftConfig> {
  return deepMerge(base, override) as Partial<ToolcraftConfig>;
}

function normalizeToolcraftConfig(value: Record<string, unknown>): ToolcraftConfig {
  return {
    ...(value as unknown as ToolcraftConfig),
    resources: normalizeResources(value.resources),
    readme: normalizeReadme(value.readme)
  };
}

function normalizeResources(value: unknown): Record<string, ToolcraftResourceConfig> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value).map(([name, resource]) => [name, normalizeResource(resource)])
  );
}

function normalizeResource(value: unknown): ToolcraftResourceConfig {
  if (!isPlainObject(value)) {
    return {};
  }

  return {
    methods: normalizeMethods(value.methods),
    subresources: normalizeResources(value.subresources)
  };
}

function normalizeMethods(value: unknown): Record<string, ToolcraftMethodConfig> | undefined {
  if (!isPlainObject(value)) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([name, method]) => [name, normalizeMethod(method)] as const)
      .filter((entry): entry is readonly [string, ToolcraftMethodConfig] => entry[1] !== undefined)
  );
}

function normalizeMethod(value: unknown): ToolcraftMethodConfig | undefined {
  if (typeof value === "string") {
    return parseMethodShorthand(value);
  }

  if (!isPlainObject(value)) {
    return undefined;
  }

  const method = value.method;
  const requestPath = value.path;
  if (!isHttpMethod(method) || typeof requestPath !== "string") {
    return undefined;
  }

  return {
    method,
    path: requestPath,
    ...(typeof value.pagination === "string" ? { pagination: value.pagination } : {}),
    ...(typeof value.idempotent === "boolean" ? { idempotent: value.idempotent } : {})
  };
}

function parseMethodShorthand(value: string): ToolcraftMethodConfig | undefined {
  const parts = value.trim().split(" ").filter((part) => part.length > 0);
  const method = parts[0];
  const requestPath = parts[1];

  if (!isHttpMethod(method) || requestPath === undefined) {
    return undefined;
  }

  const optionsText = parts.slice(2).join(" ");
  const options = parseInlineOptions(optionsText);
  return {
    method,
    path: requestPath,
    ...(typeof options.pagination === "string" ? { pagination: options.pagination } : {}),
    ...(typeof options.idempotent === "boolean" ? { idempotent: options.idempotent } : {})
  };
}

function parseInlineOptions(value: string): Record<string, unknown> {
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    return {};
  }

  const body = trimmed.slice(1, -1).trim();
  if (body.length === 0) {
    return {};
  }

  const entries: Array<[string, unknown]> = [];
  for (const pair of body.split(",")) {
    const separatorIndex = pair.indexOf(":");
    if (separatorIndex < 0) {
      continue;
    }

    const key = pair.slice(0, separatorIndex).trim();
    const rawValue = pair.slice(separatorIndex + 1).trim();
    entries.push([key, parseInlineScalar(rawValue)]);
  }

  return Object.fromEntries(entries);
}

function parseInlineScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}

function normalizeReadme(value: unknown): ToolcraftConfig["readme"] {
  if (!isPlainObject(value) || !isPlainObject(value.examples)) {
    return undefined;
  }

  const examples = Object.fromEntries(
    Object.entries(value.examples)
      .filter((entry): entry is [string, unknown[]] => Array.isArray(entry[1]))
      .map(([key, entries]) => [
        key,
        entries
          .filter(isPlainObject)
          .map((entry) => ({
            title: typeof entry.title === "string" ? entry.title : "Example",
            params: isPlainObject(entry.params) ? entry.params : {}
          }))
      ])
  );

  return { examples };
}

function isHttpMethod(value: unknown): value is ToolcraftHttpMethod {
  return (
    value === "get" ||
    value === "post" ||
    value === "put" ||
    value === "patch" ||
    value === "delete" ||
    value === "head" ||
    value === "options"
  );
}

function deepMerge(left: unknown, right: unknown): unknown {
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return cloneMergeValue(right);
  }

  const merged: Record<string, unknown> = { ...left };
  for (const [key, value] of Object.entries(right)) {
    merged[key] = key in merged ? deepMerge(merged[key], value) : cloneMergeValue(value);
  }
  return merged;
}

function cloneMergeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return [...value];
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, cloneMergeValue(entry)]));
  }

  return value;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
