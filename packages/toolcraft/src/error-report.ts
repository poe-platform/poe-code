import { mkdir, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { CommanderError } from "commander";
import type { AnySchema } from "toolcraft-schema";
import type { Command, SecretDeclarations } from "./index.js";
import { ApprovalDeclinedError } from "./human-in-loop/types.js";
import { findPackageMetadata } from "./package-metadata.js";
import { findProjectRoot } from "./project-root.js";
import { isSensitiveName, redactHttpBody, redactHttpHeaderValue } from "./redaction.js";
import { UserError } from "./user-error.js";

const ERROR_REPORTS_ENV = "TOOLCRAFT_ERROR_REPORTS";

export type ErrorReportsOption = boolean | { dir?: string };

export interface ErrorReportContext {
  argv?: readonly string[];
  command?: Command<any, any, any, any>;
  commandPath?: string;
  env?: Record<string, string | undefined>;
  error: unknown;
  errorReports?: ErrorReportsOption;
  params?: unknown;
  projectRoot?: string;
  secrets?: Record<string, string | undefined>;
  version?: string;
}

export interface ErrorReportResult {
  absolutePath: string;
  displayPath: string;
}

export type ErrorReportRenderContext = Omit<
  ErrorReportContext,
  "errorReports" | "projectRoot"
>;

export interface ErrorReportRenderResult {
  content: string;
  redactedKeys: string[];
}

interface HttpErrorLike {
  name: "HttpError";
  message: string;
  request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: unknown;
  };
  response: {
    status: number;
    statusText: string;
    headers: Record<string, string>;
    body: unknown;
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function unwrapOptional(schema: AnySchema): AnySchema {
  if (schema.kind === "optional") {
    return unwrapOptional(schema.inner);
  }

  return schema;
}

function hasHttpContext(error: unknown): error is HttpErrorLike {
  return (
    error instanceof Error &&
    error.name === "HttpError" &&
    isPlainObject((error as { request?: unknown }).request) &&
    isPlainObject((error as { response?: unknown }).response)
  );
}

function isSkippedError(error: unknown): boolean {
  if (error instanceof ApprovalDeclinedError) {
    return true;
  }

  if (
    error instanceof CommanderError &&
    (error.code === "commander.helpDisplayed" || error.code === "commander.version")
  ) {
    return true;
  }

  return error instanceof UserError && error.cause === undefined && !hasHttpContext(error);
}

function reportsEnabled(
  option: ErrorReportsOption | undefined,
  env: Record<string, string | undefined>
): boolean {
  if (env[ERROR_REPORTS_ENV] === "1") {
    return true;
  }

  return option !== undefined && option !== false;
}

function resolveReportDir(option: ErrorReportsOption | undefined, projectRoot: string): string {
  const configuredDir = typeof option === "object" ? option.dir : undefined;

  if (configuredDir === undefined || configuredDir.length === 0) {
    return path.join(projectRoot, ".toolcraft", "errors");
  }

  return path.isAbsolute(configuredDir) ? configuredDir : path.join(projectRoot, configuredDir);
}

function reportDirMustStayWithinProject(option: ErrorReportsOption | undefined): boolean {
  const configuredDir = typeof option === "object" ? option.dir : undefined;
  return configuredDir === undefined || configuredDir.length === 0 || !path.isAbsolute(configuredDir);
}

function isWithinDirectory(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!path.isAbsolute(relative) && relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

async function assertReportDirWithinProject(projectRoot: string, reportDir: string): Promise<void> {
  if (!isWithinDirectory(path.resolve(projectRoot), path.resolve(reportDir))) {
    throw new Error("Error report directory resolves outside project root.");
  }

  const [canonicalProjectRoot, canonicalReportDir] = await Promise.all([
    realpath(projectRoot),
    realpath(reportDir)
  ]);

  if (!isWithinDirectory(canonicalProjectRoot, canonicalReportDir)) {
    throw new Error("Error report directory resolves outside project root.");
  }
}

function resolveProjectRoot(projectRoot: string | undefined): string {
  if (projectRoot !== undefined) {
    return projectRoot;
  }

  return findProjectRoot() ?? os.tmpdir();
}

function formatTimestamp(date: Date): string {
  const isoMinute = date.toISOString().slice(0, 16);
  const colonIndex = isoMinute.indexOf(":");

  if (colonIndex === -1) {
    return isoMinute;
  }

  return `${isoMinute.slice(0, colonIndex)}${isoMinute.slice(colonIndex + 1)}`;
}

function slugifyCommandPath(commandPath: string | undefined): string {
  const source = commandPath === undefined || commandPath.length === 0 ? "root" : commandPath;
  let output = "";
  let previousWasDash = false;

  for (const char of source) {
    const lower = char.toLowerCase();
    const isWord = (lower >= "a" && lower <= "z") || (lower >= "0" && lower <= "9");

    if (isWord) {
      output += lower;
      previousWasDash = false;
      continue;
    }

    if (!previousWasDash) {
      output += "-";
      previousWasDash = true;
    }
  }

  while (output.startsWith("-")) {
    output = output.slice(1);
  }

  while (output.endsWith("-")) {
    output = output.slice(0, -1);
  }

  return output.length === 0 ? "root" : output;
}

function relativeDisplayPath(projectRoot: string, absolutePath: string): string {
  const relative = path.relative(projectRoot, absolutePath);
  return relative.length === 0 || relative.startsWith("..") ? absolutePath : relative;
}

function redactValue(value: string | undefined): string {
  if (value === undefined) {
    return "<unset>";
  }

  return `<set, ${value.length} chars>`;
}

function collectStringLeaves(value: unknown, output: Set<string>): void {
  if (typeof value === "string") {
    if (value.length > 0) {
      output.add(value);
    }
    return;
  }

  if (Array.isArray(value)) {
    for (const entry of value) {
      collectStringLeaves(entry, output);
    }
    return;
  }

  if (isPlainObject(value)) {
    for (const entry of Object.values(value)) {
      collectStringLeaves(entry, output);
    }
  }
}

function schemaSecretValue(schema: AnySchema): boolean | undefined {
  const unwrapped = unwrapOptional(schema);

  if (unwrapped.kind === "string" || unwrapped.kind === "number") {
    return (unwrapped as { secret?: boolean }).secret;
  }

  return undefined;
}

function shouldRedactParam(name: string, schema: AnySchema): boolean {
  const secret = schemaSecretValue(schema);

  if (secret !== undefined) {
    return secret;
  }

  return isSensitiveName(name);
}

function redactParamsValue(value: unknown, schema: AnySchema, name: string): unknown {
  if (shouldRedactParam(name, schema)) {
    return "<redacted>";
  }

  const unwrapped = unwrapOptional(schema);

  if (unwrapped.kind === "object" && isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, childValue]) => {
        const childSchema = unwrapped.shape[key];
        return [
          key,
          childSchema === undefined ? childValue : redactParamsValue(childValue, childSchema, key)
        ];
      })
    );
  }

  if (unwrapped.kind === "array" && Array.isArray(value)) {
    return value.map((entry) => redactParamsValue(entry, unwrapped.item, name));
  }

  return value;
}

function redactParams(params: unknown, command: Command<any, any, any, any> | undefined): unknown {
  if (command === undefined) {
    return params;
  }

  return redactParamsValue(params, command.params, "");
}

function collectSensitiveParamValues(
  value: unknown,
  schema: AnySchema,
  name: string,
  output: Set<string>
): void {
  if (shouldRedactParam(name, schema)) {
    collectStringLeaves(value, output);
    return;
  }

  const unwrapped = unwrapOptional(schema);

  if (unwrapped.kind === "object" && isPlainObject(value)) {
    for (const [key, childValue] of Object.entries(value)) {
      const childSchema = unwrapped.shape[key];
      if (childSchema !== undefined) {
        collectSensitiveParamValues(childValue, childSchema, key, output);
      }
    }
    return;
  }

  if (unwrapped.kind === "array" && Array.isArray(value)) {
    for (const entry of value) {
      collectSensitiveParamValues(entry, unwrapped.item, name, output);
    }
  }
}

function createReportStringRedactor(
  context: ErrorReportRenderContext,
  env: Record<string, string | undefined>
): (value: string) => string {
  const values = new Set<string>();

  for (const value of Object.values(context.secrets ?? {})) {
    if (value !== undefined && value.length > 0) {
      values.add(value);
    }
  }

  for (const [name, secret] of Object.entries(context.command?.secrets ?? {})) {
    const value = context.secrets?.[name] ?? env[secret.env];
    if (value !== undefined && value.length > 0) {
      values.add(value);
    }
  }

  if (context.command !== undefined) {
    collectSensitiveParamValues(context.params, context.command.params, "", values);
  }

  const orderedValues = [...values].sort((left, right) => right.length - left.length);

  return (value: string): string => {
    let redacted = value;
    for (const secretValue of orderedValues) {
      redacted = redacted.split(secretValue).join("<redacted>");
    }
    return redacted;
  };
}

function commandSecretEnvNames(secrets: SecretDeclarations | undefined): string[] {
  if (secrets === undefined) {
    return [];
  }

  return Object.values(secrets).map((secret) => secret.env);
}

function redactArgv(
  argv: readonly string[] | undefined,
  options: {
    command?: Command<any, any, any, any>;
    secrets?: Record<string, string | undefined>;
  }
): string[] {
  if (argv === undefined) {
    return [];
  }

  const secretValues = new Set(
    Object.values(options.secrets ?? {}).filter(
      (value): value is string => value !== undefined && value.length > 0
    )
  );
  const secretNames = new Set([
    ...Object.keys(options.secrets ?? {}),
    ...commandSecretEnvNames(options.command?.secrets)
  ]);
  const output: string[] = [];
  let redactNext = false;

  for (const arg of argv) {
    if (redactNext) {
      output.push("<redacted>");
      redactNext = false;
      continue;
    }

    const equalsIndex = arg.indexOf("=");
    const optionName = equalsIndex === -1 ? arg : arg.slice(0, equalsIndex);
    const normalizedOptionName = optionName.replaceAll("-", "");
    const sensitiveByName =
      isSensitiveName(normalizedOptionName) ||
      [...secretNames].some((name) =>
        normalizedOptionName.toLowerCase().includes(name.toLowerCase())
      );

    if (equalsIndex !== -1 && sensitiveByName) {
      output.push(`${optionName}=<redacted>`);
      continue;
    }

    if (arg.startsWith("-") && sensitiveByName) {
      output.push(arg);
      redactNext = true;
      continue;
    }

    let redactedArg = arg;
    for (const secretValue of secretValues) {
      redactedArg = redactedArg.split(secretValue).join("<redacted>");
    }
    output.push(redactedArg);
  }

  return output;
}

function stableJson(value: unknown): string {
  return JSON.stringify(value, null, 2) ?? "undefined";
}

function redactStructuredErrorField(
  name: string,
  value: unknown,
  redactString: (value: string) => string
): unknown {
  if (typeof value === "string") {
    const redactedHeaderValue = redactHttpHeaderValue(name, value);
    if (redactedHeaderValue !== value) {
      return redactedHeaderValue;
    }

    if (isSensitiveName(name)) {
      return "<redacted>";
    }

    return redactString(value);
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactStructuredErrorField(name, entry, redactString));
  }

  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [
        key,
        redactStructuredErrorField(key, entry, redactString)
      ])
    );
  }

  return value;
}

function ownStructuredFields(
  error: Error,
  redactString: (value: string) => string
): Record<string, unknown> {
  const fields: Record<string, unknown> = {};

  for (const key of Object.keys(error)) {
    if (key === "name" || key === "message" || key === "stack" || key === "cause") {
      continue;
    }

    Object.defineProperty(fields, key, {
      value: redactStructuredErrorField(
        key,
        (error as unknown as Record<string, unknown>)[key],
        redactString
      ),
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return fields;
}

function formatStackChain(error: unknown, redactString: (value: string) => string): string {
  const lines: string[] = [];
  let current: unknown = error;
  let index = 0;

  while (current !== undefined) {
    if (current instanceof Error) {
      const stack = current.stack ?? String(current);
      lines.push(redactString(index === 0 ? stack : `Caused by: ${stack}`));
      current = current.cause;
    } else {
      const message = String(current);
      lines.push(redactString(index === 0 ? message : `Caused by: ${message}`));
      current = undefined;
    }

    index += 1;
  }

  return lines.join("\n");
}

function formatHeaderValue(
  name: string,
  value: string,
  redactString: (value: string) => string
): string {
  return redactString(redactHttpHeaderValue(name, value));
}

function formatHeaders(
  headers: Record<string, string>,
  redactString: (value: string) => string
): string {
  return Object.entries(headers)
    .map(([name, value]) => `${name}: ${formatHeaderValue(name, value, redactString)}`)
    .join("\n");
}

function formatBody(body: unknown, redactString: (value: string) => string): string {
  const redactedBody = redactHttpBody(body);

  if (typeof redactedBody === "string") {
    return redactString(redactedBody);
  }

  return redactString(stableJson(redactedBody));
}

function formatHttpTranscript(
  error: HttpErrorLike,
  redactString: (value: string) => string
): string {
  const requestLines = [
    `${error.request.method} ${error.request.url}`,
    formatHeaders(error.request.headers, redactString)
  ].filter((line) => line.length > 0);

  if (error.request.body !== undefined) {
    requestLines.push("", formatBody(error.request.body, redactString));
  }

  return [
    "Request:",
    ...requestLines,
    "",
    "Response:",
    `${error.response.status} ${error.response.statusText}`,
    formatHeaders(error.response.headers, redactString),
    "",
    formatBody(error.response.body, redactString)
  ].join("\n");
}

function resolveToolcraftVersion(version: string | undefined): string {
  return (
    version ??
    findPackageMetadata(new URL("./error-report.ts", import.meta.url))?.version ??
    "unknown"
  );
}

function buildReport(context: ErrorReportRenderContext): string {
  const env = context.env ?? process.env;
  const error = context.error;
  const redactString = createReportStringRedactor(context, env);
  const errorName = error instanceof Error ? error.name : typeof error;
  const errorMessage = redactString(error instanceof Error ? error.message : String(error));
  const structuredFields = error instanceof Error ? ownStructuredFields(error, redactString) : {};
  const secretLines = Object.entries(context.command?.secrets ?? {}).map(([name, secret]) => {
    const value = context.secrets?.[name] ?? env[secret.env];
    return `${secret.env}=${redactValue(value)}`;
  });
  const lines = [
    "Toolcraft Error Report",
    "",
    "Runtime",
    `toolcraft version: ${resolveToolcraftVersion(context.version)}`,
    `node version: ${process.version}`,
    `platform: ${process.platform} ${process.arch}`,
    "",
    "Argv",
    redactString(
      stableJson(redactArgv(context.argv, { command: context.command, secrets: context.secrets }))
    ),
    "",
    "Resolved Secrets",
    ...(secretLines.length === 0 ? ["<none>"] : secretLines),
    "",
    "Command Path",
    context.commandPath === undefined || context.commandPath.length === 0
      ? "root"
      : context.commandPath,
    "",
    "Parsed Params",
    redactString(stableJson(redactParams(context.params, context.command))),
    "",
    "Error",
    `name: ${errorName}`,
    `message: ${errorMessage}`,
    "structured fields:",
    redactString(stableJson(structuredFields)),
    "",
    "Stack",
    formatStackChain(error, redactString)
  ];

  if (hasHttpContext(error)) {
    lines.push("", "HTTP Transcript", formatHttpTranscript(error, redactString));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * Renders the exact redacted content used by `writeErrorReport` without checking report enablement
 * or writing to the filesystem. `redactedKeys` lists every environment variable declared by the
 * command's secrets in declaration order, including variables that are currently unset.
 */
export function renderErrorReport(
  context: ErrorReportRenderContext
): ErrorReportRenderResult {
  return {
    content: buildReport(context),
    redactedKeys: commandSecretEnvNames(context.command?.secrets)
  };
}

export async function writeErrorReport(
  context: ErrorReportContext
): Promise<ErrorReportResult | undefined> {
  const env = context.env ?? process.env;

  if (!reportsEnabled(context.errorReports, env) || isSkippedError(context.error)) {
    return undefined;
  }

  const projectRoot = resolveProjectRoot(context.projectRoot);
  const reportDir = resolveReportDir(context.errorReports, projectRoot);
  const fileName = `${formatTimestamp(new Date())}-${slugifyCommandPath(context.commandPath)}-${randomUUID()}.log`;
  const absolutePath = path.join(reportDir, fileName);

  await mkdir(reportDir, { recursive: true });
  if (reportDirMustStayWithinProject(context.errorReports)) {
    await assertReportDirWithinProject(projectRoot, reportDir);
  }
  await writeFile(absolutePath, renderErrorReport(context).content);

  return {
    absolutePath,
    displayPath: relativeDisplayPath(projectRoot, absolutePath)
  };
}

export { hasHttpContext };
