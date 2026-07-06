import "./node-require-shim.js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  Command as CommanderCommand,
  CommanderError,
  InvalidArgumentError,
  Option
} from "commander";
import type {
  AnySchema,
  ArraySchema,
  CliMissingParameterContext,
  EnumSchema,
  JsonValueSchema,
  ObjectSchema,
  RecordSchema
} from "toolcraft-schema";
import { validate as validateSchema } from "toolcraft-schema";
import {
  cancel,
  configureTheme,
  confirm,
  createLogger,
  formatCommandList,
  formatOptionList,
  getTheme,
  helpFormatterPlain,
  isCancel,
  note,
  promptText,
  renderTable,
  resetOutputFormatCache,
  select,
  text
} from "toolcraft-design";
import type {
  Command,
  CommandRequirementOptions,
  Group,
  HandlerContext,
  HandlerEnv,
  HandlerFs,
  DiagnosticLogEvent,
  LogLevel,
  RuntimeLoggerInput,
  SecretDeclarations,
  SecretDefinition,
  Scope
} from "./index.js";
import {
  ApprovalDeclinedError,
  UserError,
  assertCommandRequirements,
  getCommandSourcePath,
  hasMcpProxyConfig,
  resolveCommandSecrets
} from "./index.js";
import { hasOwnErrorCode } from "./error-codes.js";
import { writeErrorReport, type ErrorReportsOption } from "./error-report.js";
import type { HumanInLoopPending, HumanInLoopRuntimeOptions } from "./human-in-loop/types.js";
import { getExpectedNumberDescription, isValidNumberSchemaValue } from "./number-schema.js";
import { findEntrypointPackageMetadata } from "./package-metadata.js";
import { redactHttpBody, redactHttpHeaderValue } from "./redaction.js";
import { createRuntimeLogger, isLogLevel, LOG_LEVELS } from "./runtime-logging.js";
import { summarizeHttpError } from "./api-error-summary.js";
import { renderResult } from "./renderer.js";
import type { OutputMode } from "./renderer.js";
import { renderSourceSnippet } from "./source-snippet.js";
import { enableSourceMaps, formatDebugStack, type DebugStackMode } from "./stack-trim.js";
import { suggest } from "./suggest.js";
import { throwValidationErrors, type ValidationError } from "./validation-errors.js";
import { RESERVED_SERVICE_NAMES, createEnv, createFs, validateServices } from "./runtime/io.js";
import { createManagedStream } from "./stream.js";

export { renderErrorReport } from "./error-report.js";
export type { ErrorReportRenderContext, ErrorReportRenderResult } from "./error-report.js";

configureTheme({ brand: "blue", label: "Toolcraft" });

export { configureTheme };

const NULL_OPTION_VALUE = Symbol("toolcraft.cli.null");
const optionalModulePaths = {
  approvals: "./human-in-loop/approvals-commands.js",
  humanInLoop: "./human-in-loop/gate.js",
  mcpProxy: "./mcp-proxy.js"
} as const;

function importOptionalModule<T>(specifier: string): Promise<T> {
  return import(specifier) as Promise<T>;
}

type Casing = "kebab" | "snake";
type ScalarSchema = Extract<AnySchema, { kind: "string" | "number" | "boolean" | "enum" }>;
type FieldSchema = ScalarSchema | ArraySchema<any> | JsonValueSchema;

interface ResolvedFlags {
  json?: boolean;
  preset?: string;
  yes?: boolean;
  output?: OutputMode;
  debug?: DebugStackMode | boolean;
  logLevel?: LogLevel;
  verbose?: boolean;
}

interface FieldDefinition {
  id: string;
  path: string[];
  displayPath: string;
  optionAttribute: string;
  commanderOptionAttribute: string;
  optionFlag: string;
  longAliases: string[];
  shortFlag?: string;
  schema: FieldSchema;
  description?: string;
  optional: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  requiredWhenActive: boolean;
  global?: boolean;
  synthetic?: boolean;
  variantId?: string;
  variantBranchId?: string;
  positionalIndex?: number;
  variadicPosition?: boolean;
}

interface DynamicFieldDefinition {
  id: string;
  path: string[];
  displayPath: string;
  optionPath: string[];
  optionPathDisplay: string;
  optionFlag: string;
  description?: string;
  optional: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  requiredWhenActive: boolean;
  schema: RecordSchema<any> | ArraySchema<ObjectSchema<any>>;
  variantId?: string;
  variantBranchId?: string;
}

interface VariantBranchDefinition {
  branchId: string;
  dynamicFieldIds: string[];
  fieldIds: string[];
  requiredDynamicFieldIds: string[];
  requiredFieldIds: string[];
}

interface VariantDefinition {
  id: string;
  controlDisplayPath: string;
  controlFieldId: string;
  optional: boolean;
  branches: VariantBranchDefinition[];
}

interface CollectedCliSchema {
  dynamicFields: DynamicFieldDefinition[];
  fields: FieldDefinition[];
  variants: VariantDefinition[];
}

interface ExecutionState<TServices extends object> {
  command: Command<TServices, any, any, any>;
  commandPath: string;
  casing: Casing;
  dynamicFields: DynamicFieldDefinition[];
  fields: FieldDefinition[];
  positionalValues: unknown[];
  presetsEnabled: boolean;
  rawArgv: string[];
  actionCommand: CommanderCommand;
  variants: VariantDefinition[];
}

interface FixtureFetchRequest {
  method?: string;
  url: string;
}

interface FixtureFetchResponse {
  body?: unknown;
  headers?: Record<string, string>;
  status?: number;
}

interface FixtureFetchEntry {
  request: FixtureFetchRequest;
  response: FixtureFetchResponse;
}

interface FixtureScenario {
  name: string;
  services?: Record<string, unknown>;
}

interface ResolvedFixtureRuntime<TServices extends object> {
  env: HandlerEnv;
  fetch: typeof globalThis.fetch;
  fs: HandlerFs;
  isFixture: boolean;
  requirementOptions: CommandRequirementOptions;
  secrets: Record<string, string | undefined>;
  services: TServices;
}

interface ResolvedHelpTarget<TServices extends object> {
  breadcrumb: string[];
  node: Command<TServices, any, any, any> | Group<TServices>;
}

interface HelpCommandRow {
  description: string;
  name: string;
}

interface HelpOptionRow {
  description: string;
  flags: string;
}

interface JsonHelpOption {
  name: string;
  flags: string[];
  type: string;
  description?: string;
  required: boolean;
  default?: unknown;
  positional?: boolean;
}

export interface CLIControls {
  debug?: boolean;
  logLevel?: boolean;
  output?: boolean;
  verbose?: boolean;
  yes?: boolean;
}

export interface RunCLIOptions<TServices extends object = Record<string, unknown>> {
  apiVersion?: string;
  approvals?: boolean;
  argv?: readonly string[];
  casing?: Casing;
  controls?: CLIControls;
  env?: Record<string, string>;
  fetch?: typeof globalThis.fetch;
  fs?: HandlerFs;
  humanInLoop?: HumanInLoopRuntimeOptions;
  logLevel?: LogLevel;
  logger?: RuntimeLoggerInput;
  outputEmitter?: (entry: string) => void;
  promptInput?: NodeJS.ReadableStream;
  promptOutput?: NodeJS.WritableStream;
  projectRoot?: string;
  rootDisplayName?: string;
  rootUsageName?: string;
  services?: TServices;
  version?: string;
  presets?: boolean;
  errorReports?: ErrorReportsOption;
}

export interface CLICommandTreeSnapshotOption {
  name: string;
  flags: string[];
  type: string;
  required: boolean;
  hidden: boolean;
  description?: string;
  default?: unknown;
  positional?: boolean;
  global?: boolean;
  dynamic?: boolean;
}

export interface CLICommandTreeSnapshotCommand {
  kind: "command";
  name: string;
  path: string[];
  aliases: string[];
  hidden: boolean;
  default: boolean;
  description?: string;
  options: CLICommandTreeSnapshotOption[];
}

export interface CLICommandTreeSnapshotGroup {
  kind: "group";
  name: string;
  path: string[];
  aliases: string[];
  hidden: false;
  default: boolean;
  description?: string;
  children: CLICommandTreeSnapshotNode[];
}

export type CLICommandTreeSnapshotNode =
  | CLICommandTreeSnapshotCommand
  | CLICommandTreeSnapshotGroup;

export interface CLICommandTreeSnapshot {
  schemaVersion: 1;
  globalOptions: CLICommandTreeSnapshotOption[];
  root: CLICommandTreeSnapshotGroup;
}

export interface CLICommandTreeSnapshotOptions {
  approvals?: boolean;
  argv?: readonly string[];
  casing?: Casing;
  controls?: CLIControls;
  presets?: boolean;
  version?: string;
}

/**
 * Returns the resolved CLI command surface as deterministic plain data.
 *
 * Schema version 1 is independent of human-facing help layout. Nodes and options retain
 * declaration order, paths exclude the root name, non-CLI nodes are omitted, hidden commands
 * remain present, and Toolcraft-controlled global options are reported separately. A future
 * incompatible shape change will increment `schemaVersion`.
 */
export async function createCLICommandTreeSnapshot<TServices extends object>(
  roots: Group<TServices> | Group<TServices>[],
  options: CLICommandTreeSnapshotOptions = {}
): Promise<CLICommandTreeSnapshot> {
  const argv = [...(options.argv ?? ["node", "toolcraft"])];
  const normalizedRoot = normalizeRoots(roots, argv);
  const root =
    options.approvals === true
      ? (
          await importOptionalModule<typeof import("./human-in-loop/approvals-commands.js")>(
            optionalModulePaths.approvals
          )
        ).mergeApprovalsGroup(normalizedRoot)
      : normalizedRoot;
  const controls = resolveCLIControls(options.controls);
  const presetsEnabled = options.presets === true;
  const globalLongOptionFlags = getGlobalLongOptionFlags(
    presetsEnabled,
    options.version !== undefined,
    controls
  );

  return {
    schemaVersion: 1,
    globalOptions: createGlobalSnapshotOptions(
      presetsEnabled,
      options.version !== undefined,
      controls
    ),
    root: createSnapshotGroup(root, options.casing ?? "kebab", globalLongOptionFlags, [], false)
  };
}

function inferProgramName(argv: string[]): string {
  const entrypoint = argv[1];

  if (typeof entrypoint !== "string" || entrypoint.length === 0) {
    return "toolcraft";
  }

  const parsed = path.parse(entrypoint);
  return parsed.name.length > 0 ? parsed.name : "toolcraft";
}

function normalizeRoots<TServices extends object>(
  roots: Group<TServices> | Group<TServices>[],
  argv: string[]
): Group<TServices> {
  if (!Array.isArray(roots)) {
    return roots;
  }

  return {
    kind: "group",
    name: inferProgramName(argv),
    aliases: [],
    secrets: {},
    children: roots
  };
}

const HELP_FLAGS = new Set(["--help", "-h"]);

function unwrapOptional(schema: AnySchema): AnySchema {
  if (schema.kind === "optional") {
    return unwrapOptional(schema.inner);
  }

  return schema;
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
  const separator = casing === "snake" ? "_" : "-";
  return splitWords(segment).join(separator);
}

function toOptionFlag(path: string[], casing: Casing): string {
  return `--${path.map((segment) => formatSegment(segment, casing)).join(".")}`;
}

function toOptionAttribute(path: string[], casing: Casing): string {
  return path
    .map((segment) => {
      const formatted = formatSegment(segment, casing);

      if (casing === "snake") {
        return formatted;
      }

      const words = formatted.split("-");
      return words
        .map((word, index) =>
          index === 0 ? word : `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`
        )
        .join("");
    })
    .join(".");
}

function toDisplayPath(path: string[]): string {
  return path.join(".");
}

function toUnionKindControlPath(path: string[]): string[] {
  if (path.length === 0) {
    return ["kind"];
  }

  const head = path.slice(0, -1);
  const tail = path[path.length - 1] ?? "";
  return [...head, `${tail}Kind`];
}

function toUnionKindDisplayPath(path: string[]): string {
  if (path.length === 0) {
    return "kind";
  }

  const head = path.slice(0, -1);
  const tail = path[path.length - 1] ?? "";
  return [...head, `${tail}-kind`].join(".");
}

function createSyntheticEnumSchema(values: string[]): EnumSchema<[string, ...string[]]> {
  if (values.length === 0) {
    throw new Error("Synthetic enum schema requires at least one value.");
  }

  return {
    kind: "enum",
    values: values as [string, ...string[]]
  };
}

function getRequiredBranchFingerprint(branch: ObjectSchema<any>, casing: Casing): string {
  const requiredKeys = (Object.entries(branch.shape) as Array<[string, AnySchema]>)
    .filter(([, schema]) => schema.kind !== "optional")
    .map(([key]) => formatSegment(key, casing))
    .sort();

  return requiredKeys.join("+");
}

function collectFields(
  schema: ObjectSchema<any>,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>,
  path: string[] = [],
  inheritedOptional = false,
  variantContext?: {
    branchId: string;
    id: string;
  }
): CollectedCliSchema {
  const collected: CollectedCliSchema = {
    dynamicFields: [],
    fields: [],
    variants: []
  };

  for (const [key, rawChildSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const nextPath = [...path, key];
    const runtimeOptional = inheritedOptional || rawChildSchema.kind === "optional";
    const childSchema = unwrapOptional(rawChildSchema);
    const requiredWhenActive =
      rawChildSchema.kind !== "optional" && childSchema.default === undefined;

    if (childSchema.kind === "object") {
      const nested = collectFields(
        childSchema,
        casing,
        globalLongOptionFlags,
        nextPath,
        runtimeOptional,
        variantContext
      );
      collected.dynamicFields.push(...nested.dynamicFields);
      collected.fields.push(...nested.fields);
      collected.variants.push(...nested.variants);
      continue;
    }

    if (childSchema.kind === "oneOf") {
      const variantId = `${toDisplayPath(nextPath)}:oneOf`;
      const branchIds = Object.keys(childSchema.branches);
      const controlField: FieldDefinition = {
        id: toDisplayPath([...nextPath, childSchema.discriminator]),
        path: [...nextPath, childSchema.discriminator],
        displayPath: toDisplayPath([...nextPath, childSchema.discriminator]),
        optionAttribute: toOptionAttribute([...nextPath, childSchema.discriminator], casing),
        commanderOptionAttribute: toCommanderOptionAttribute(
          [...nextPath, childSchema.discriminator],
          casing,
          globalLongOptionFlags
        ),
        optionFlag: toOptionFlag([...nextPath, childSchema.discriminator], casing),
        longAliases: [],
        shortFlag: undefined,
        schema: createSyntheticEnumSchema(branchIds),
        description: childSchema.description,
        optional: runtimeOptional,
        hasDefault: false,
        defaultValue: undefined,
        requiredWhenActive
      };
      collected.fields.push(controlField);

      const branches: VariantBranchDefinition[] = [];

      for (const [branchId, branchSchema] of Object.entries(childSchema.branches)) {
        const branch = collectFields(branchSchema, casing, globalLongOptionFlags, nextPath, true, {
          id: variantId,
          branchId
        });
        collected.dynamicFields.push(...branch.dynamicFields);
        collected.fields.push(...branch.fields);
        collected.variants.push(...branch.variants);
        branches.push({
          branchId,
          dynamicFieldIds: branch.dynamicFields.map((field) => field.id),
          fieldIds: branch.fields.map((field) => field.id),
          requiredDynamicFieldIds: branch.dynamicFields
            .filter((field) => field.requiredWhenActive)
            .map((field) => field.id),
          requiredFieldIds: branch.fields
            .filter((field) => field.requiredWhenActive)
            .map((field) => field.id)
        });
      }

      collected.variants.push({
        id: variantId,
        controlDisplayPath: controlField.displayPath,
        controlFieldId: controlField.id,
        optional: runtimeOptional,
        branches
      });
      continue;
    }

    if (childSchema.kind === "union") {
      const variantId = `${toDisplayPath(nextPath)}:union`;
      const controlPath = toUnionKindControlPath(nextPath);
      const controlDisplayPath = toUnionKindDisplayPath(nextPath);
      const branchIds = childSchema.branches.map((branch) =>
        getRequiredBranchFingerprint(branch, casing)
      );
      const controlField: FieldDefinition = {
        id: controlDisplayPath,
        path: controlPath,
        displayPath: controlDisplayPath,
        optionAttribute: toOptionAttribute(controlPath, casing),
        commanderOptionAttribute: toCommanderOptionAttribute(
          controlPath,
          casing,
          globalLongOptionFlags
        ),
        optionFlag: toOptionFlag(controlPath, casing),
        longAliases: [],
        shortFlag: undefined,
        schema: createSyntheticEnumSchema(branchIds),
        description: childSchema.description,
        optional: runtimeOptional,
        hasDefault: false,
        defaultValue: undefined,
        requiredWhenActive,
        synthetic: true
      };
      collected.fields.push(controlField);

      const branches: VariantBranchDefinition[] = [];

      childSchema.branches.forEach((branchSchema, index) => {
        const branchId = branchIds[index] ?? "";
        const branch = collectFields(branchSchema, casing, globalLongOptionFlags, nextPath, true, {
          id: variantId,
          branchId
        });
        collected.dynamicFields.push(...branch.dynamicFields);
        collected.fields.push(...branch.fields);
        collected.variants.push(...branch.variants);
        branches.push({
          branchId,
          dynamicFieldIds: branch.dynamicFields.map((field) => field.id),
          fieldIds: branch.fields.map((field) => field.id),
          requiredDynamicFieldIds: branch.dynamicFields
            .filter((field) => field.requiredWhenActive)
            .map((field) => field.id),
          requiredFieldIds: branch.fields
            .filter((field) => field.requiredWhenActive)
            .map((field) => field.id)
        });
      });

      collected.variants.push({
        id: variantId,
        controlDisplayPath,
        controlFieldId: controlField.id,
        optional: runtimeOptional,
        branches
      });
      continue;
    }

    if (childSchema.kind === "record") {
      collected.dynamicFields.push({
        id: toDisplayPath(nextPath),
        path: nextPath,
        displayPath: toDisplayPath(nextPath),
        optionPath: nextPath,
        optionPathDisplay: `${toDisplayPath(nextPath)}.<key>`,
        optionFlag: `${toOptionFlag(nextPath, casing)}.<key>`,
        description: childSchema.description,
        optional: runtimeOptional,
        hasDefault: childSchema.default !== undefined,
        defaultValue: childSchema.default,
        requiredWhenActive,
        schema: childSchema,
        variantId: variantContext?.id,
        variantBranchId: variantContext?.branchId
      });
      continue;
    }

    if (childSchema.kind === "array" && unwrapOptional(childSchema.item).kind === "object") {
      collected.dynamicFields.push({
        id: toDisplayPath(nextPath),
        path: nextPath,
        displayPath: toDisplayPath(nextPath),
        optionPath: nextPath,
        optionPathDisplay: `${toDisplayPath(nextPath)}.<index>`,
        optionFlag: `${toOptionFlag(nextPath, casing)}.<index>`,
        description: childSchema.description,
        optional: runtimeOptional,
        hasDefault: childSchema.default !== undefined,
        defaultValue: childSchema.default,
        requiredWhenActive,
        schema: childSchema as ArraySchema<ObjectSchema<any>>,
        variantId: variantContext?.id,
        variantBranchId: variantContext?.branchId
      });
      continue;
    }

    collected.fields.push({
      id: toDisplayPath(nextPath),
      path: nextPath,
      displayPath: toDisplayPath(nextPath),
      optionAttribute: toOptionAttribute(nextPath, casing),
      commanderOptionAttribute: toCommanderOptionAttribute(nextPath, casing, globalLongOptionFlags),
      optionFlag: toOptionFlag(nextPath, casing),
      longAliases: [...(childSchema.cliAliases ?? [])].map((alias) =>
        alias.startsWith("--") ? alias : `--${alias}`
      ),
      shortFlag: childSchema.short,
      schema: childSchema as FieldSchema,
      description: childSchema.cliDescription ?? childSchema.description,
      optional: runtimeOptional,
      hasDefault: childSchema.default !== undefined,
      defaultValue: childSchema.default,
      requiredWhenActive,
      global: childSchema.global === true ? true : undefined,
      variantId: variantContext?.id,
      variantBranchId: variantContext?.branchId
    });
  }

  return collected;
}

function toCommanderOptionAttribute(
  path: string[],
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>
): string {
  const optionAttribute = toOptionAttribute(path, casing);
  const optionFlag = toOptionFlag(path, casing);

  if (!globalLongOptionFlags.has(optionFlag)) {
    return optionAttribute;
  }

  return `param_${optionAttribute}`;
}

function assignPositionals(fields: FieldDefinition[], positional: string[]): FieldDefinition[] {
  if (positional.length === 0) {
    return fields;
  }

  const byPath = new Map(fields.map((field) => [field.displayPath, field]));
  let variadicPositionSeen = false;

  positional.forEach((name, index) => {
    const field = byPath.get(name);

    if (field === undefined) {
      throw new UserError(`Positional parameter "${name}" does not exist in params.`);
    }

    if (field.schema.kind === "array") {
      if (index !== positional.length - 1) {
        throw new UserError(`Positional array parameter "${name}" must be the last positional.`);
      }

      variadicPositionSeen = true;
    }

    if (variadicPositionSeen && field.schema.kind !== "array") {
      throw new UserError(`Positional parameter "${name}" cannot appear after a positional array.`);
    }

    field.positionalIndex = index;
    field.variadicPosition = field.schema.kind === "array";
  });

  return fields;
}

function formatOptionFlags(
  field: FieldDefinition,
  globalLongOptionFlags: ReadonlySet<string>
): string {
  const collidesWithGlobalFlag = globalLongOptionFlags.has(field.optionFlag);

  if (collidesWithGlobalFlag) {
    if (field.shortFlag === undefined) {
      throw new UserError(
        `Parameter "${field.displayPath}" uses reserved CLI flag "${field.optionFlag}". Add a short flag or rename the parameter.`
      );
    }

    return `-${field.shortFlag}`;
  }

  if (field.shortFlag === undefined) {
    return [field.optionFlag, ...field.longAliases].join(", ");
  }

  return [`-${field.shortFlag}`, field.optionFlag, ...field.longAliases].join(", ");
}

function formatPositionalToken(field: FieldDefinition): string {
  const optionalPositional = field.optional || field.hasDefault;

  if (field.variadicPosition === true) {
    return optionalPositional ? `[${field.displayPath}...]` : `<${field.displayPath}...>`;
  }

  return optionalPositional ? `[${field.displayPath}]` : `<${field.displayPath}>`;
}

function parseBooleanText(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new InvalidArgumentError(
    `Invalid value for "${label}". Expected true or false, got ${describeReceived(value)}.`
  );
}

function parseEnumValue(
  value: string,
  values: ReadonlyArray<string | number | boolean>,
  label: string
): string | number | boolean {
  const match = values.find((candidate) => String(candidate) === value);

  if (match === undefined) {
    const suggestions = suggest(
      value,
      values.map((candidate) => String(candidate))
    );
    const suggestionLine =
      suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?\n` : " ";
    throw new InvalidArgumentError(
      `Invalid value for "${label}".${suggestionLine}Expected one of: ${values.map((candidate) => String(candidate)).join(", ")}, got ${describeReceived(value)}.`
    );
  }

  return match;
}

function validateStringPattern(
  value: string,
  schema: Extract<ScalarSchema, { kind: "string" }>,
  label: string
): string {
  if (schema.minLength !== undefined && value.length < schema.minLength) {
    throw new UserError(
      `Invalid value for "${label}". Expected a string with length at least ${schema.minLength}, got string with length ${value.length}.`
    );
  }

  if (schema.maxLength !== undefined && value.length > schema.maxLength) {
    throw new UserError(
      `Invalid value for "${label}". Expected a string with length at most ${schema.maxLength}, got string with length ${value.length}.`
    );
  }

  if (schema.pattern !== undefined && !matchesStringPattern(value, schema.pattern)) {
    throw new UserError(
      `Invalid value for "${label}": "${value}" does not match pattern "${schema.pattern}".`
    );
  }

  return value;
}

function matchesStringPattern(value: string, pattern: string): boolean {
  return new RegExp(pattern).test(value);
}

function parseJsonText(value: string, label: string): unknown {
  try {
    return JSON.parse(value);
  } catch (error) {
    throw new InvalidArgumentError(
      `Invalid value for "${label}". Expected valid JSON, got ${describeReceived(value)} (parser: ${getErrorMessage(error)}).`
    );
  }
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function formatJsonParseUserErrorMessage(
  label: string,
  filePath: string,
  source: string,
  error: unknown,
  options: { quotePath: boolean }
): string {
  const location = getJsonParseErrorLocation(error, source);
  const message =
    location === null
      ? getErrorMessage(error)
      : removeNativeJsonParseLocation(getErrorMessage(error), location);
  const positionText =
    location === null ? "" : ` at line ${location.line} column ${location.column}`;
  const formattedPath = options.quotePath ? `"${filePath}"` : filePath;
  const snippet =
    location === null
      ? ""
      : `\n${renderSourceSnippet({
          source,
          line: location.line,
          column: location.column,
          filePath
        })}`;

  return `${label} ${formattedPath} is not valid JSON: ${message}${positionText}.${snippet}`;
}

function removeNativeJsonParseLocation(
  message: string,
  location: { line: number; column: number }
): string {
  const nativeSuffix = ` (line ${location.line} column ${location.column})`;

  return message.endsWith(nativeSuffix) ? message.slice(0, -nativeSuffix.length) : message;
}

function getJsonParseErrorLocation(
  error: unknown,
  source: string
): { line: number; column: number } | null {
  const causeLocation = getJsonParseCauseLocation(error);

  if (causeLocation !== null) {
    return causeLocation;
  }

  const directPosition = getNumericProperty(error, "position");

  if (directPosition !== null) {
    return getSourceOffsetLocation(source, directPosition);
  }

  const messagePosition = getJsonParseMessagePosition(getErrorMessage(error));

  if (messagePosition !== null) {
    return getSourceOffsetLocation(source, messagePosition);
  }

  return null;
}

function getJsonParseCauseLocation(error: unknown): { line: number; column: number } | null {
  if (typeof error !== "object" || error === null || !hasOwnProperty(error, "cause")) {
    return null;
  }

  const cause = error.cause;
  const line = getNumericProperty(cause, "line");
  const column = getNumericProperty(cause, "column") ?? getNumericProperty(cause, "col");

  if (line === null || column === null) {
    return null;
  }

  return { line, column };
}

function getNumericProperty(value: unknown, key: string): number | null {
  if (typeof value !== "object" || value === null || !hasOwnProperty(value, key)) {
    return null;
  }

  const propertyValue = value[key];

  return typeof propertyValue === "number" && Number.isFinite(propertyValue) ? propertyValue : null;
}

function getJsonParseMessagePosition(message: string): number | null {
  const marker = " at position ";
  const markerIndex = message.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const startIndex = markerIndex + marker.length;
  let endIndex = startIndex;

  while (endIndex < message.length && isAsciiDigit(message[endIndex] ?? "")) {
    endIndex += 1;
  }

  if (endIndex === startIndex) {
    return null;
  }

  return Number.parseInt(message.slice(startIndex, endIndex), 10);
}

function getSourceOffsetLocation(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let column = 1;
  const boundedOffset = Math.max(0, Math.floor(offset));

  for (let index = 0; index < boundedOffset && index < source.length; index += 1) {
    if (source[index] === "\n") {
      line += 1;
      column = 1;
      continue;
    }

    column += 1;
  }

  return { line, column };
}

function isAsciiDigit(value: string): boolean {
  return value >= "0" && value <= "9";
}

function formatAvailableList(values: Iterable<string>): string {
  return `Available: ${[...values].sort().join(", ")}.`;
}

function normalizeCommanderOptionValue(value: unknown): unknown {
  return value === NULL_OPTION_VALUE ? null : value;
}

function parseScalarValue(
  value: string,
  schema: ScalarSchema,
  label: string
): string | number | boolean {
  if (value === "null" && schema.nullable === true) {
    return null as unknown as string | number | boolean;
  }

  switch (schema.kind) {
    case "string":
      return validateStringPattern(value, schema, label);

    case "number": {
      const parsed = Number(value);
      if (!isValidNumberSchemaValue(parsed, schema)) {
        throw new InvalidArgumentError(
          `Invalid value for "${label}". Expected ${getExpectedNumberDescription(schema)}, got ${describeReceived(value)}.`
        );
      }
      return parsed;
    }

    case "boolean":
      return parseBooleanText(value, label);

    case "enum":
      return parseEnumValue(value, schema.values, label);
  }

  throw new UserError(
    `Unsupported CLI schema kind. ${formatAvailableList(["boolean", "enum", "number", "string"])}`
  );
}

function splitArrayInput(value: string): string[] {
  const items: string[] = [];
  let current = "";

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index] ?? "";

    if (char === ",") {
      const trimmed = current.trim();
      if (trimmed.length > 0) {
        items.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const trimmed = current.trim();
  if (trimmed.length > 0) {
    items.push(trimmed);
  }

  return items;
}

function parseArrayValue(value: string, schema: ArraySchema<any>, label: string): unknown[] {
  if (value === "null" && schema.nullable === true) {
    return null as unknown as unknown[];
  }

  const itemSchema = unwrapOptional(schema.item);

  if (itemSchema.kind === "array" || itemSchema.kind === "object") {
    throw new UserError(`Array parameter "${label}" must use scalar items.`);
  }

  return splitArrayInput(value).map((item) =>
    parseScalarValue(item, itemSchema as ScalarSchema, label)
  );
}

function isNegativeNumericArrayToken(token: string, schema: ArraySchema<any>): boolean {
  if (!token.startsWith("-") || token.startsWith("--")) {
    return false;
  }

  const itemSchema = unwrapOptional(schema.item);
  if (itemSchema.kind !== "number") {
    return false;
  }

  const items = splitArrayInput(token);
  return (
    items.length > 0 && items.every((item) => isValidNumberSchemaValue(Number(item), itemSchema))
  );
}

function isNextArrayOptionToken(token: string, schema: ArraySchema<any>): boolean {
  return token.startsWith("-") && !isNegativeNumericArrayToken(token, schema);
}

function validateArrayBounds(value: unknown[], schema: ArraySchema<any>, label: string): void {
  if (schema.minItems !== undefined && value.length < schema.minItems) {
    throw new UserError(
      `Invalid value for "${label}". Expected an array with at least ${schema.minItems} items, got array(${value.length}).`
    );
  }

  if (schema.maxItems !== undefined && value.length > schema.maxItems) {
    throw new UserError(
      `Invalid value for "${label}". Expected an array with at most ${schema.maxItems} items, got array(${value.length}).`
    );
  }
}

function createOption(
  field: FieldDefinition,
  globalLongOptionFlags: ReadonlySet<string>
): Option[] {
  const flags = formatOptionFlags(field, globalLongOptionFlags);
  const collidesWithGlobalFlag = globalLongOptionFlags.has(field.optionFlag);

  if (field.schema.kind === "boolean") {
    if (collidesWithGlobalFlag) {
      return [createCommanderOption(flags, field.description, field)];
    }

    const mainOption = createCommanderOption(`${flags} [value]`, field.description, field);
    mainOption.preset(true);
    // Commander v14 passes the preset value through argParser too, so guard with typeof check
    mainOption.argParser((value: string | boolean) => (typeof value === "boolean" ? value : value));

    return [
      mainOption,
      createCommanderOption(`--no-${field.optionFlag.slice(2)}`, field.description, field)
    ];
  }

  if (field.schema.kind === "array") {
    return [
      createCommanderOption(`${flags} <value...>`, field.description, field).argParser(
        (value: string, previous: string[] = []) => [...previous, value]
      )
    ];
  }

  if (field.schema.kind === "json") {
    return [createCommanderOption(`${flags} <json>`, field.description, field)];
  }

  const option = createCommanderOption(`${flags} <value>`, field.description, field);
  return [option];
}

interface ResolvedCLIControls {
  debug: boolean;
  logLevel: boolean;
  output: boolean;
  verbose: boolean;
  yes: boolean;
}

function resolveCLIControls(controls: CLIControls | undefined): ResolvedCLIControls {
  return {
    debug: controls?.debug === true,
    logLevel: controls?.logLevel === true,
    output: controls?.output === true,
    verbose: controls?.verbose === true,
    yes: controls?.yes === true
  };
}

function getGlobalLongOptionFlags(
  presetsEnabled: boolean,
  versionEnabled: boolean,
  controls: ResolvedCLIControls
): ReadonlySet<string> {
  const flags: string[] = [];

  if (presetsEnabled) {
    flags.push("--preset");
  }
  if (controls.yes) {
    flags.push("--yes");
  }
  if (controls.output) {
    flags.push("--output");
  }
  if (controls.debug) {
    flags.push("--debug");
  }
  if (controls.logLevel) {
    flags.push("--log-level");
  }
  if (controls.verbose) {
    flags.push("--verbose");
  }

  if (versionEnabled) {
    flags.push("--version");
  }

  return new Set(flags);
}

function validateUniqueOptionFlags(
  fields: FieldDefinition[],
  globalLongOptionFlags: ReadonlySet<string>
): void {
  const fieldsByFlag = new Map<string, FieldDefinition>();

  for (const field of fields) {
    if (field.positionalIndex !== undefined) {
      continue;
    }

    for (const flag of [field.optionFlag, ...field.longAliases]) {
      if (globalLongOptionFlags.has(flag)) {
        if (flag === field.optionFlag && field.shortFlag !== undefined) {
          continue;
        }

        throw new UserError(
          `Parameter "${field.displayPath}" uses reserved CLI flag "${flag}". Add a short flag or rename the parameter.`
        );
      }

      const existing = fieldsByFlag.get(flag);
      if (existing !== undefined) {
        throw new UserError(
          `Parameters "${existing.displayPath}" and "${field.displayPath}" use conflicting CLI flag "${flag}".`
        );
      }

      fieldsByFlag.set(flag, field);
    }
  }
}

function createCommanderOption(
  flags: string,
  description: string | undefined,
  field: FieldDefinition
): Option {
  const option = new Option(flags, description);

  if (field.commanderOptionAttribute !== field.optionAttribute || field.longAliases.length > 0) {
    option.attributeName = () => field.commanderOptionAttribute;
  }

  return option;
}

function hasHelpFlag(argv: string[]): boolean {
  return argv.some((token) => HELP_FLAGS.has(token));
}

function normalizeVerboseAlias(argv: string[]): string[] {
  return argv.map((token) => (token === "-v" ? "--verbose" : token));
}

function resolveHelpOutput(argv: string[]): OutputMode {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--output") {
      const value = argv[index + 1];
      if (value === "rich" || value === "md" || value === "json") {
        return value;
      }
      if (value === "markdown") {
        return "md";
      }
      continue;
    }

    if (token.startsWith("--output=")) {
      const value = token.slice("--output=".length);
      if (value === "rich" || value === "md" || value === "json") {
        return value;
      }
      if (value === "markdown") {
        return "md";
      }
    }
  }

  return "rich";
}

function isNodeVisibleInScope<TServices extends object>(
  node: Command<TServices, any, any, any> | Group<TServices>,
  scope: Scope
): boolean {
  if (node.kind === "command") {
    return node.scope.includes(scope);
  }

  return (
    getVisibleChildren(node, scope).length > 0 ||
    Boolean(node.default && node.default.scope.includes(scope)) ||
    node.scope === undefined ||
    node.scope.includes(scope)
  );
}

function getVisibleChildren<TServices extends object>(
  group: Group<TServices>,
  scope: Scope
): Array<Command<TServices, any, any, any> | Group<TServices>> {
  return group.children.filter((child) => isNodeVisibleInScope(child, scope));
}

function getHelpChildren<TServices extends object>(
  group: Group<TServices>,
  scope: Scope
): Array<Command<TServices, any, any, any> | Group<TServices>> {
  return getVisibleChildren(group, scope).filter((child) => {
    if (child.kind === "command") {
      return child.hidden !== true;
    }

    return true;
  });
}

function findVisibleChild<TServices extends object>(
  group: Group<TServices>,
  token: string,
  scope: Scope
): Command<TServices, any, any, any> | Group<TServices> | undefined {
  return getVisibleChildren(group, scope).find(
    (child) => child.name === token || child.aliases.includes(token)
  );
}

function resolveHelpTarget<TServices extends object>(
  root: Group<TServices>,
  argv: string[],
  scope: Scope,
  rootUsageName: string,
  rootDisplayName?: string
): ResolvedHelpTarget<TServices> {
  const breadcrumb = [rootDisplayName ?? root.name];
  let current: Command<TServices, any, any, any> | Group<TServices> = root;

  for (const token of argv.slice(2)) {
    if (token.startsWith("-") || token === "help") {
      break;
    }

    if (current.kind !== "group") {
      break;
    }

    const child: Command<TServices, any, any, any> | Group<TServices> | undefined =
      findVisibleChild(current, token, scope);
    if (child === undefined) {
      throw new UserError(
        formatUnknownHelpCommandMessage(current, token, scope, rootUsageName, breadcrumb)
      );
    }

    breadcrumb.push(child.name);
    current = child;
  }

  return {
    breadcrumb,
    node: current
  };
}

function formatUnknownHelpCommandMessage<TServices extends object>(
  group: Group<TServices>,
  input: string,
  scope: Scope,
  rootUsageName: string,
  breadcrumb: string[]
): string {
  const suggestions = suggest(
    input,
    getHelpChildren(group, scope).map((child) => child.name)
  );
  const commandPath = breadcrumb.slice(1).join(" ");
  const helpTarget = commandPath.length === 0 ? rootUsageName : `${rootUsageName} ${commandPath}`;

  return `${formatSuggestionMessage(`Unknown command "${input}".`, suggestions)}\nRun ${helpTarget} --help for usage.`;
}

function formatHelpFieldFlags(
  field: FieldDefinition,
  globalLongOptionFlags: ReadonlySet<string>
): string {
  if (field.positionalIndex !== undefined) {
    return formatPositionalToken(field);
  }

  if (field.schema.kind === "boolean") {
    if (field.defaultValue === true) {
      return `--no-${field.optionFlag.slice(2)}`;
    }

    return formatOptionFlags(field, globalLongOptionFlags);
  }

  return `${formatOptionFlags(field, globalLongOptionFlags)} <${describeHelpValueToken(
    field.schema,
    {
      displayPath: field.displayPath,
      optionFlag: field.optionFlag
    }
  )}>`;
}

function appendHelpMetadata(description: string, metadata: string[]): string {
  if (metadata.length === 0) {
    return description;
  }

  if (description.length === 0) {
    return `(${metadata.join(", ")})`;
  }

  return `${description} (${metadata.join(", ")})`;
}

function formatHelpFieldDescription(field: FieldDefinition): string {
  const description = field.description ?? field.displayPath;
  const metadata: string[] = [];

  if (field.schema.kind === "enum" && field.schema.values.length <= 8) {
    const values = field.schema.values.map((value) => String(value)).join(", ");
    if (values.length <= 120) {
      metadata.push(`values: ${values}`);
    }
  }

  if (!field.optional && !field.hasDefault) {
    metadata.push("required");
  }

  if (field.hasDefault) {
    metadata.push(`default: ${formatResolvedValue(field.defaultValue)}`);
  }

  return appendHelpMetadata(description, metadata);
}

function describeKnownStringFormat(format: string | undefined): string | undefined {
  switch (format) {
    case "date":
      return "date";

    case "date-time":
      return "datetime";

    case "uri":
      return "url";

    case "email":
      return "email";

    default:
      return undefined;
  }
}

function describeKnownStringPattern(pattern: string | undefined): string | undefined {
  if (pattern === undefined) {
    return undefined;
  }

  if (pattern === "^\\d{4}-\\d{2}-\\d{2}$") {
    return "YYYY-MM-DD";
  }

  if (pattern.startsWith("^\\d{4}-\\d{2}-\\d{2}T")) {
    return "YYYY-MM-DDTHH:MM:SS";
  }

  return undefined;
}

function stripLongOptionPrefix(optionFlag: string): string {
  return optionFlag.startsWith("--") ? optionFlag.slice(2) : optionFlag;
}

function getLastSegment(value: string, separator: string): string {
  const segments = value.split(separator);
  return segments[segments.length - 1] ?? value;
}

function matchesFieldNameSuffix(name: string, suffix: string): boolean {
  const lowerName = name.toLowerCase();
  const lowerSuffix = suffix.toLowerCase();

  return (
    lowerName === lowerSuffix ||
    name.endsWith(suffix) ||
    lowerName.endsWith(`-${lowerSuffix}`) ||
    lowerName.endsWith(`_${lowerSuffix}`)
  );
}

function describeFieldNameValueToken(displayPath: string, optionFlag: string): string | undefined {
  const displayName = getLastSegment(displayPath, ".");
  const optionName = getLastSegment(stripLongOptionPrefix(optionFlag), ".");
  const candidates = [displayName, optionName];
  const suffixTokens = [
    ["Path", "path"],
    ["Paths", "path"],
    ["File", "path"],
    ["Files", "path"],
    ["Url", "url"],
    ["Email", "email"],
    ["Name", "name"],
    ["Id", "id"]
  ] as const;

  for (const [suffix, token] of suffixTokens) {
    if (candidates.some((candidate) => matchesFieldNameSuffix(candidate, suffix))) {
      return token;
    }
  }

  return undefined;
}

function describeHelpValueToken(
  schema: FieldSchema,
  field: {
    displayPath: string;
    optionFlag: string;
  }
): string {
  if (schema.kind === "array") {
    const itemSchema = unwrapOptional(schema.item);

    if (itemSchema.kind === "array" || itemSchema.kind === "object") {
      return "value...";
    }

    return `${describeHelpValueToken(itemSchema as FieldSchema, field)}...`;
  }

  if (schema.kind === "json") {
    return "json";
  }

  if (schema.kind === "string") {
    const metadataToken =
      describeKnownStringFormat(schema.format) ?? describeKnownStringPattern(schema.pattern);

    if (metadataToken !== undefined) {
      return metadataToken;
    }
  }

  if (schema.kind === "enum") {
    return "value";
  }

  return describeFieldNameValueToken(field.displayPath, field.optionFlag) ?? "value";
}

function formatCompactEnumSignatureToken(schema: FieldSchema): string | undefined {
  if (schema.kind !== "enum" || schema.values.length < 2 || schema.values.length > 3) {
    return undefined;
  }

  const tokens = schema.values.map((value) => String(value));
  const compact = tokens.every(
    (token) =>
      token.length > 0 &&
      token.length <= 24 &&
      token.trim() === token &&
      !token.includes("|") &&
      !token.includes("\t") &&
      !token.includes("\n") &&
      !token.includes("\r") &&
      !token.includes(" ")
  );

  return compact ? tokens.join("|") : undefined;
}

function formatCommandParameterFieldFlags(
  field: FieldDefinition,
  globalLongOptionFlags: ReadonlySet<string>
): string {
  if (field.positionalIndex !== undefined || field.schema.kind === "boolean") {
    return formatHelpFieldFlags(field, globalLongOptionFlags);
  }

  const enumToken = formatCompactEnumSignatureToken(field.schema);
  if (enumToken !== undefined) {
    return `${formatOptionFlags(field, globalLongOptionFlags)} ${enumToken}`;
  }

  return formatHelpFieldFlags(field, globalLongOptionFlags);
}

function describeDynamicFieldType(field: DynamicFieldDefinition): string {
  if (field.schema.kind === "record") {
    const valueSchema = unwrapOptional(field.schema.value);

    if (valueSchema.kind === "json") {
      return "json";
    }

    if (valueSchema.kind === "array") {
      return describeHelpValueToken(valueSchema as FieldSchema, {
        displayPath: field.optionPathDisplay,
        optionFlag: field.optionFlag
      });
    }

    if (valueSchema.kind === "object") {
      return "value";
    }

    return describeHelpValueToken(valueSchema as FieldSchema, {
      displayPath: field.optionPathDisplay,
      optionFlag: field.optionFlag
    });
  }

  return "value";
}

function formatDynamicHelpMetadata(field: DynamicFieldDefinition): string[] {
  const metadata: string[] = [];

  if (!field.optional && !field.hasDefault) {
    metadata.push("required");
  }

  if (field.hasDefault) {
    metadata.push(`default: ${formatResolvedValue(field.defaultValue)}`);
  }

  return metadata;
}

function collectDynamicObjectHelpRows(
  schema: ObjectSchema<any>,
  casing: Casing,
  optionPrefix: string,
  displayPrefix: string,
  metadata: string[]
): HelpOptionRow[] {
  const rows: HelpOptionRow[] = [];

  for (const [key, rawChildSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const childSchema = unwrapOptional(rawChildSchema);
    const optionFlag = `${optionPrefix}.${formatSegment(key, casing)}`;
    const displayPath = `${displayPrefix}.${key}`;
    const description = childSchema.description ?? displayPath;

    if (childSchema.kind === "object") {
      rows.push(
        ...collectDynamicObjectHelpRows(childSchema, casing, optionFlag, displayPath, metadata)
      );
      continue;
    }

    if (childSchema.kind === "record") {
      rows.push({
        flags: `${optionFlag}.<key> <${describeDynamicFieldType({
          ...({
            id: displayPath,
            path: [],
            displayPath,
            optionPath: [],
            optionPathDisplay: `${displayPath}.<key>`,
            optionFlag: `${optionFlag}.<key>`,
            optional: false,
            hasDefault: false,
            defaultValue: undefined,
            requiredWhenActive: false,
            schema: childSchema
          } satisfies DynamicFieldDefinition)
        })}>`,
        description: appendHelpMetadata(description, metadata)
      });
      continue;
    }

    if (childSchema.kind === "array" && unwrapOptional(childSchema.item).kind === "object") {
      rows.push(
        ...collectDynamicObjectHelpRows(
          unwrapOptional(childSchema.item) as ObjectSchema<any>,
          casing,
          `${optionFlag}.<index>`,
          `${displayPath}.<index>`,
          metadata
        )
      );
      continue;
    }

    rows.push({
      flags:
        childSchema.kind === "boolean"
          ? childSchema.default === true
            ? `--no-${optionFlag.slice(2)}`
            : optionFlag
          : `${optionFlag} <${describeHelpValueToken(childSchema as FieldSchema, {
              displayPath,
              optionFlag
            })}>`,
      description: appendHelpMetadata(description, metadata)
    });
  }

  return rows;
}

function formatDynamicHelpFields(field: DynamicFieldDefinition, casing: Casing): HelpOptionRow[] {
  const metadata = formatDynamicHelpMetadata(field);

  if (field.schema.kind === "record") {
    const valueSchema = unwrapOptional(field.schema.value);
    if (valueSchema.kind === "object") {
      return collectDynamicObjectHelpRows(
        valueSchema,
        casing,
        `${field.optionFlag}`,
        `${field.optionPathDisplay}`,
        metadata
      );
    }
  }

  if (field.schema.kind === "array") {
    const itemSchema = unwrapOptional(field.schema.item);
    if (itemSchema.kind === "object") {
      return collectDynamicObjectHelpRows(
        itemSchema,
        casing,
        `${field.optionFlag}`,
        `${field.optionPathDisplay}`,
        metadata
      );
    }
  }

  return [
    {
      flags: `${field.optionFlag} <${describeDynamicFieldType(field)}>`,
      description: appendHelpMetadata(field.description ?? field.optionPathDisplay, metadata)
    }
  ];
}

function formatSecretRows(secrets: SecretDeclarations): HelpOptionRow[] {
  return Object.values(secrets).map((secret) => ({
    flags: secret.env,
    description: formatSecretDescription(secret)
  }));
}

function formatSecretDescription(secret: SecretDefinition): string {
  if (secret.description !== undefined && secret.description.length > 0) {
    return secret.description;
  }

  return secret.optional === true ? "Optional secret" : "Required secret";
}

function formatExampleValue(value: unknown): string {
  if (typeof value === "string" && value.length > 0 && !value.includes(" ")) {
    return value;
  }

  return JSON.stringify(value);
}

function formatExampleCommand(
  breadcrumb: string[],
  rootUsageName: string,
  params: Record<string, unknown>
): string {
  const commandPath = buildUsageLine(breadcrumb, rootUsageName, "");
  const flags = Object.entries(params).map(([key, value]) => {
    const flag = `--${key}`;
    return typeof value === "boolean"
      ? value
        ? flag
        : `--no-${key}`
      : `${flag} ${formatExampleValue(value)}`;
  });

  return [commandPath, ...flags].filter((token) => token.length > 0).join(" ");
}

function formatExampleRows(
  examples: Command<any, any, any, any>["examples"],
  breadcrumb: string[],
  rootUsageName: string
): string[] {
  return examples.map(
    (example) =>
      `${example.title}\n  ${formatExampleCommand(breadcrumb, rootUsageName, example.params)}`
  );
}

function wrapOptionalCommandParameterToken(token: string, optional: boolean): string {
  return optional ? `[${token}]` : token;
}

function formatCommandDynamicParameterTokens(
  field: DynamicFieldDefinition,
  casing: Casing
): string[] {
  const optional = field.optional || field.hasDefault;
  return formatDynamicHelpFields(field, casing).map((row) =>
    wrapOptionalCommandParameterToken(row.flags, optional)
  );
}

function formatCommandParameterTokens<TServices extends object>(
  command: Command<TServices, any, any, any>,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>
): string[] {
  const collected = collectFields(command.params, casing, globalLongOptionFlags);
  const fields = assignPositionals(collected.fields, command.positional);

  return fields
    .filter((field) => field.global !== true)
    .map((field) =>
      wrapOptionalCommandParameterToken(
        formatCommandParameterFieldFlags(field, globalLongOptionFlags),
        field.positionalIndex === undefined && (field.optional || field.hasDefault)
      )
    )
    .concat(
      collected.dynamicFields.flatMap((field) => formatCommandDynamicParameterTokens(field, casing))
    );
}

function formatCommandRowName<TServices extends object>(
  node: Command<TServices, any, any, any> | Group<TServices>,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>
): string {
  const baseName =
    node.aliases.length === 0 ? node.name : `${node.name} (${node.aliases.join(", ")})`;
  const parameterTokens =
    node.kind === "command"
      ? formatCommandParameterTokens(node, casing, globalLongOptionFlags)
      : [];
  const name = parameterTokens.length === 0 ? baseName : `${baseName} ${parameterTokens.join(" ")}`;
  return name;
}

function formatCommandRows<TServices extends object>(
  group: Group<TServices>,
  scope: Scope,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>
): HelpCommandRow[] {
  return getHelpChildren(group, scope).map((child) => ({
    name: formatCommandRowName(child, casing, globalLongOptionFlags),
    description: child.description ?? ""
  }));
}

function formatGlobalOptionsLine(ctx: {
  controls: ResolvedCLIControls;
  showVersion: boolean;
  presetsEnabled: boolean;
}): string {
  const flags: string[] = [];

  if (ctx.presetsEnabled) {
    flags.push("--preset <path>");
  }

  if (ctx.controls.yes) {
    flags.push("--yes");
  }
  if (ctx.controls.output) {
    flags.push("--output <format>");
  }
  if (ctx.controls.verbose) {
    flags.push("-v, --verbose");
  }

  if (ctx.showVersion) {
    flags.push("--version");
  }

  return flags.length > 0 ? `${text.section("Options:")} ${flags.join("  ")}` : "";
}

function formatLeafGlobalOptionsLine(ctx: { controls: ResolvedCLIControls }): string {
  return ctx.controls.verbose ? `${text.section("Options:")} -v, --verbose` : "";
}

function collectSchemaGlobalFieldRows<TServices extends object>(
  group: Group<TServices>,
  scope: Scope,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>
): HelpOptionRow[] {
  const seen = new Map<string, HelpOptionRow>();

  const visit = (node: Command<TServices, any, any, any> | Group<TServices>): void => {
    if (node.kind === "command") {
      const collected = collectFields(node.params, casing, globalLongOptionFlags);
      for (const field of collected.fields) {
        if (field.global !== true) {
          continue;
        }

        if (globalLongOptionFlags.has(field.optionFlag)) {
          continue;
        }

        const dedupeKey = `${field.optionFlag}|${field.shortFlag ?? ""}`;
        if (seen.has(dedupeKey)) {
          continue;
        }

        seen.set(dedupeKey, {
          flags: formatHelpFieldFlags(field, globalLongOptionFlags),
          description: formatHelpFieldDescription(field)
        });
      }
      return;
    }

    for (const child of getHelpChildren(node, scope)) {
      visit(child);
    }
  };

  visit(group);
  return [...seen.values()];
}

function renderHelpSections(sections: string[]): string {
  return sections.filter((section) => section.length > 0).join("\n\n");
}

function formatHelpCommandList(rows: HelpCommandRow[]): string {
  return process.stdout.isTTY !== true
    ? helpFormatterPlain.formatCommandList(rows)
    : formatCommandList(rows);
}

function formatHelpOptionList(rows: HelpOptionRow[]): string {
  return process.stdout.isTTY !== true
    ? helpFormatterPlain.formatOptionList(rows)
    : formatOptionList(rows);
}

function buildUsageLine(breadcrumb: string[], rootUsageName: string, suffix: string): string {
  const visibleBreadcrumb = breadcrumb.filter((segment) => segment.length > 0);
  const usageBreadcrumb =
    breadcrumb[0] === "" ? [rootUsageName, ...visibleBreadcrumb] : visibleBreadcrumb;
  const subPath = usageBreadcrumb.slice(1).join(" ");
  const tokens = [rootUsageName, subPath, suffix].filter((segment) => segment.length > 0);
  return tokens.join(" ");
}

function formatGroupUsageSuffix<TServices extends object>(
  group: Group<TServices>,
  scope: Scope,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>
): string {
  if (
    group.default !== undefined &&
    group.default.hidden === true &&
    group.default.scope.includes(scope)
  ) {
    const parameterTokens = formatCommandParameterTokens(
      group.default,
      casing,
      globalLongOptionFlags
    );
    return ["[command]", "[OPTIONS]", ...parameterTokens].join(" ");
  }

  return "[command] [OPTIONS]";
}

function renderGroupHelp<TServices extends object>(
  group: Group<TServices>,
  breadcrumb: string[],
  scope: Scope,
  casing: Casing,
  globalOptions: {
    controls: ResolvedCLIControls;
    showVersion: boolean;
    presetsEnabled: boolean;
  },
  rootUsageName: string,
  isRoot: boolean
): string {
  const sections: string[] = [];
  const globalLongOptionFlags = getGlobalLongOptionFlags(
    globalOptions.presetsEnabled,
    globalOptions.showVersion,
    globalOptions.controls
  );
  const commandRows = formatCommandRows(group, scope, casing, globalLongOptionFlags);

  if (commandRows.length > 0) {
    sections.push(`${text.sectionHeader("Commands")}\n${formatHelpCommandList(commandRows)}`);
  }

  if (isRoot) {
    const schemaGlobalRows = collectSchemaGlobalFieldRows(
      group,
      scope,
      casing,
      globalLongOptionFlags
    );
    const builtInLine = formatGlobalOptionsLine(globalOptions);

    if (schemaGlobalRows.length > 0) {
      sections.push(
        `${text.sectionHeader("Options")}\n${formatHelpOptionList(schemaGlobalRows)}\n${builtInLine}`
      );
    } else {
      sections.push(builtInLine);
    }
  }

  return renderHelpDocument({
    breadcrumb,
    rootUsageName,
    usageLine: buildUsageLine(
      breadcrumb,
      rootUsageName,
      formatGroupUsageSuffix(group, scope, casing, globalLongOptionFlags)
    ),
    description: group.description,
    requiresAuth: group.requires?.auth === true,
    sections
  });
}

function renderLeafHelp<TServices extends object>(
  command: Command<TServices, any, any, any>,
  breadcrumb: string[],
  casing: Casing,
  globalOptions: {
    controls: ResolvedCLIControls;
    showVersion: boolean;
    presetsEnabled: boolean;
  },
  rootUsageName: string
): string {
  const sections: string[] = [];
  const globalLongOptionFlags = getGlobalLongOptionFlags(
    globalOptions.presetsEnabled,
    globalOptions.showVersion,
    globalOptions.controls
  );
  const collected = collectFields(command.params, casing, globalLongOptionFlags);
  const fields = assignPositionals(collected.fields, command.positional);
  const optionRows = fields
    .filter((field) => field.global !== true)
    .map((field) => ({
      flags: formatHelpFieldFlags(field, globalLongOptionFlags),
      description: formatHelpFieldDescription(field)
    }))
    .concat(collected.dynamicFields.flatMap((field) => formatDynamicHelpFields(field, casing)));

  if (optionRows.length > 0) {
    sections.push(`${text.sectionHeader("Options")}\n${formatHelpOptionList(optionRows)}`);
  }

  const builtInLine = formatLeafGlobalOptionsLine(globalOptions);
  if (builtInLine.length > 0) {
    sections.push(builtInLine);
  }

  const secretRows = formatSecretRows(command.secrets);
  if (secretRows.length > 0) {
    sections.push(
      `${text.sectionHeader("Secrets (environment)")}\n${formatHelpOptionList(secretRows)}`
    );
  }

  if (command.examples.length > 0) {
    sections.push(
      `${text.sectionHeader("Examples")}\n${formatExampleRows(command.examples, breadcrumb, rootUsageName).join("\n")}`
    );
  }

  const positionalFields = fields.filter((f) => f.positionalIndex !== undefined);
  const usageSuffix =
    positionalFields.length > 0
      ? `[OPTIONS] ${positionalFields.map(formatPositionalToken).join(" ")}`
      : "[OPTIONS]";

  return renderHelpDocument({
    breadcrumb,
    rootUsageName,
    usageLine: buildUsageLine(breadcrumb, rootUsageName, usageSuffix),
    description: command.description,
    requiresAuth: command.requires?.auth === true,
    sections
  });
}

function renderJsonHelp<TServices extends object>(
  target: ResolvedHelpTarget<TServices>,
  root: Group<TServices>,
  casing: Casing,
  globalOptions: {
    controls: ResolvedCLIControls;
    showVersion: boolean;
    presetsEnabled: boolean;
  },
  rootUsageName: string
): string {
  const globalLongOptionFlags = getGlobalLongOptionFlags(
    globalOptions.presetsEnabled,
    globalOptions.showVersion,
    globalOptions.controls
  );
  const node = target.node;

  if (node.kind === "group") {
    const commandRows = formatCommandRows(node, "cli", casing, globalLongOptionFlags);
    const isRoot = node === root;
    return `${JSON.stringify(
      {
        schemaVersion: 1,
        kind: "group",
        name: target.breadcrumb.at(-1) ?? rootUsageName,
        path: target.breadcrumb.filter((segment) => segment.length > 0),
        usage: buildUsageLine(
          target.breadcrumb,
          rootUsageName,
          formatGroupUsageSuffix(node, "cli", casing, globalLongOptionFlags)
        ),
        ...(node.description === undefined ? {} : { description: node.description }),
        commands: commandRows.map((row) => ({ name: row.name, description: row.description })),
        options: isRoot
          ? collectSchemaGlobalFieldRows(node, "cli", casing, globalLongOptionFlags).map((row) => ({
              name: row.flags.split(/[ ,]+/)[0]?.replace(/^--/, "") ?? row.flags,
              flags: row.flags.split(", "),
              type: "unknown",
              description: row.description,
              required: false
            }))
          : []
      },
      null,
      2
    )}\n`;
  }

  const collected = collectFields(node.params, casing, globalLongOptionFlags);
  const fields = assignPositionals(collected.fields, node.positional);
  const positionalFields = fields.filter((field) => field.positionalIndex !== undefined);
  const usageSuffix =
    positionalFields.length > 0
      ? `[OPTIONS] ${positionalFields.map(formatPositionalToken).join(" ")}`
      : "[OPTIONS]";

  return `${JSON.stringify(
    {
      schemaVersion: 1,
      kind: "command",
      name: node.name,
      path: target.breadcrumb.filter((segment) => segment.length > 0),
      usage: buildUsageLine(target.breadcrumb, rootUsageName, usageSuffix),
      ...(node.description === undefined ? {} : { description: node.description }),
      options: fields
        .filter((field) => field.global !== true)
        .map((field) => formatJsonHelpOption(field, globalLongOptionFlags)),
      secrets: Object.entries(node.secrets).map(([name, secret]) => ({
        name,
        env: secret.env,
        required: secret.optional !== true,
        ...(secret.description === undefined ? {} : { description: secret.description })
      })),
      examples: node.examples
    },
    null,
    2
  )}\n`;
}

function formatJsonHelpOption(
  field: FieldDefinition,
  globalLongOptionFlags: ReadonlySet<string>
): JsonHelpOption {
  return {
    name: field.displayPath,
    flags: formatHelpFieldFlags(field, globalLongOptionFlags).split(", "),
    type: formatJsonHelpSchemaType(field.schema),
    ...(field.description === undefined ? {} : { description: field.description }),
    required: field.requiredWhenActive,
    ...(field.hasDefault ? { default: field.defaultValue } : {}),
    ...(field.positionalIndex === undefined ? {} : { positional: true })
  };
}

function formatJsonHelpSchemaType(schema: FieldSchema): string {
  if (schema.kind === "enum") {
    return "enum";
  }

  if (schema.kind === "array") {
    return "array";
  }

  if (schema.kind === "json") {
    return "json";
  }

  return schema.kind;
}

function renderHelpDocument(input: {
  breadcrumb: string[];
  rootUsageName: string;
  usageLine: string;
  description?: string;
  requiresAuth: boolean;
  sections: string[];
}): string {
  const title =
    input.breadcrumb.filter((segment) => segment.length > 0).join(" ") || input.rootUsageName;
  const description = input.description ?? "";
  const sentenceEndIndex = description.indexOf(". ");
  const headingDescription =
    sentenceEndIndex === -1 ? description : description.slice(0, sentenceEndIndex + 1);
  const remainingDescription =
    sentenceEndIndex === -1 ? "" : description.slice(sentenceEndIndex + 2);
  const heading = headingDescription.length > 0 ? `${title} — ${headingDescription}` : title;
  const lines = [text.heading(heading), ""];

  if (remainingDescription.length > 0) {
    lines.push(remainingDescription, "");
  }

  lines.push(`Usage: ${text.usageCommand(input.usageLine)}`, "");

  if (input.requiresAuth) {
    lines.push("Requires: authentication");
  }

  if (input.requiresAuth) {
    lines.push("");
  }

  lines.push(renderHelpSections(input.sections));

  return `${lines.join("\n").trimEnd()}\n`;
}

async function renderGeneratedHelp<TServices extends object>(
  root: Group<TServices>,
  argv: string[],
  options: RunCLIOptions<TServices>
): Promise<void> {
  const output = resolveHelpOutput(argv);
  const casing = options.casing ?? "kebab";
  const rootUsageName = options.rootUsageName ?? inferProgramName(argv);
  const target = resolveHelpTarget(root, argv, "cli", rootUsageName, options.rootDisplayName);
  const controls = resolveCLIControls(options.controls);

  if (output === "json") {
    process.stdout.write(
      renderJsonHelp(
        target,
        root,
        casing,
        {
          controls,
          showVersion: options.version !== undefined,
          presetsEnabled: options.presets === true
        },
        rootUsageName
      )
    );
    return;
  }

  await withOutputFormat(output, async () => {
    const rendered =
      target.node.kind === "group"
        ? renderGroupHelp(
            target.node,
            target.breadcrumb,
            "cli",
            casing,
            {
              controls,
              showVersion: options.version !== undefined,
              presetsEnabled: options.presets === true
            },
            rootUsageName,
            target.node === root
          )
        : renderLeafHelp(
            target.node,
            target.breadcrumb,
            casing,
            {
              controls,
              showVersion: options.version !== undefined,
              presetsEnabled: options.presets === true
            },
            rootUsageName
          );

    process.stdout.write(rendered);
  });
}

function createNodeCommand<TServices extends object>(
  node: Command<TServices, any, any, any> | Group<TServices>,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>,
  execute: (state: ExecutionState<TServices>) => Promise<void>,
  presetsEnabled: boolean,
  controls: ResolvedCLIControls,
  pathSegments: string[] = []
): CommanderCommand | null {
  const nextPathSegments = [...pathSegments, node.name];

  if (node.kind === "command") {
    if (!node.scope.includes("cli")) {
      return null;
    }

    const command = new CommanderCommand(node.name);
    Reflect.set(command, "_toolcraftHidden", node.hidden);
    Reflect.set(command, "_toolcraftOriginalName", node.name);
    const collected = collectFields(node.params, casing, globalLongOptionFlags);
    const fields = assignPositionals(collected.fields, node.positional);
    validateUniqueOptionFlags(fields, globalLongOptionFlags);

    if (node.description !== undefined) {
      command.description(node.description);
    }

    node.aliases.forEach((alias) => command.alias(alias));
    command.addHelpCommand(false);
    addGlobalOptions(command, presetsEnabled, controls);
    command.allowExcessArguments(true);

    if (collected.dynamicFields.length > 0) {
      command.allowUnknownOption(true);
    }

    for (const field of fields) {
      if (field.positionalIndex !== undefined) {
        command.argument(formatPositionalToken(field));
        continue;
      }

      for (const option of createOption(field, globalLongOptionFlags)) {
        command.addOption(option);
      }
    }

    command.action(async (...args: unknown[]) => {
      const actionCommand = args[args.length - 1] as CommanderCommand;
      const positionalValues = args.slice(0, -2);

      await execute({
        command: node,
        commandPath: nextPathSegments.join("."),
        casing,
        dynamicFields: collected.dynamicFields,
        fields,
        positionalValues,
        presetsEnabled,
        rawArgv: actionCommand.args,
        actionCommand,
        variants: collected.variants
      });
    });

    return command;
  }

  if (!isNodeVisibleInScope(node, "cli")) {
    return null;
  }

  const reservedChildNames = node.children
    .filter((child) => !isNodeVisibleInScope(child, "cli"))
    .flatMap((child) => getNodeCommandNames(child));
  const visibleChildren = node.children
    .map((child) =>
      createNodeCommand(
        child,
        casing,
        globalLongOptionFlags,
        execute,
        presetsEnabled,
        controls,
        nextPathSegments
      )
    )
    .filter((child): child is CommanderCommand => child !== null);

  const group = new CommanderCommand(node.name);
  Reflect.set(group, "_toolcraftReservedChildNames", reservedChildNames);

  if (node.description !== undefined) {
    group.description(node.description);
  }

  node.aliases.forEach((alias) => group.alias(alias));
  group.addHelpCommand(false);
  addGlobalOptions(group, presetsEnabled, controls);
  const childNames = new Set(visibleChildren.map((child) => child.name()));
  for (const child of visibleChildren) {
    const isDefaultChild =
      node.default !== undefined &&
      node.default.scope.includes("cli") &&
      (child.name() === node.default.name || child.aliases().includes(node.default.name));

    addCommanderChild(group, child, isDefaultChild, childNames);
  }

  return group;
}

function addCommanderChild(
  parent: CommanderCommand,
  child: CommanderCommand,
  isDefault: boolean,
  siblingNames: ReadonlySet<string>
): void {
  if (isDefault && (child.name().length === 0 || isToolcraftHiddenCommander(child))) {
    let internalName = "__toolcraft_default__";
    let suffix = 2;

    while (siblingNames.has(internalName)) {
      internalName = `__toolcraft_default_${suffix}`;
      suffix += 1;
    }

    child.name(internalName);
    Reflect.set(
      parent,
      "_toolcraftHiddenDefaultNames",
      getToolcraftHiddenDefaultNames(parent).concat([
        ...new Set(
          [Reflect.get(child, "_toolcraftOriginalName"), ...child.aliases()].filter(
            (name): name is string => typeof name === "string" && name.length > 0
          )
        )
      ])
    );
    parent.addCommand(child, { hidden: true, isDefault: true });
    return;
  }

  const options = {
    ...(isDefault ? { isDefault: true } : {}),
    ...(isToolcraftHiddenCommander(child) ? { hidden: true } : {})
  };
  parent.addCommand(child, Object.keys(options).length > 0 ? options : undefined);
}

function isToolcraftHiddenCommander(command: CommanderCommand): boolean {
  return Reflect.get(command, "_toolcraftHidden") === true;
}

function getToolcraftHiddenDefaultNames(command: CommanderCommand): string[] {
  const value = Reflect.get(command, "_toolcraftHiddenDefaultNames");
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getToolcraftReservedChildNames(command: CommanderCommand): string[] {
  const value = Reflect.get(command, "_toolcraftReservedChildNames");
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function getNodeCommandNames<TServices extends object>(
  node: Command<TServices, any, any, any> | Group<TServices>
): string[] {
  return [node.name, ...node.aliases].filter((name) => name.length > 0);
}

function createGlobalSnapshotOptions(
  presetsEnabled: boolean,
  versionEnabled: boolean,
  controls: ResolvedCLIControls
): CLICommandTreeSnapshotOption[] {
  const options: CLICommandTreeSnapshotOption[] = [
    {
      name: "help",
      flags: ["-h", "--help"],
      type: "boolean",
      required: false,
      hidden: false,
      description: "Display help for command."
    }
  ];

  if (presetsEnabled) {
    options.push({
      name: "preset",
      flags: ["--preset"],
      type: "string",
      required: false,
      hidden: true,
      description: "Load parameter defaults from a JSON file."
    });
  }
  if (controls.yes) {
    options.push({
      name: "yes",
      flags: ["--yes"],
      type: "boolean",
      required: false,
      hidden: true,
      description: "Accept defaults and skip prompts."
    });
  }
  if (controls.output) {
    options.push({
      name: "output",
      flags: ["--output"],
      type: "enum",
      required: false,
      hidden: true,
      description: "Output format."
    });
  }
  if (controls.debug) {
    options.push({
      name: "debug",
      flags: ["--debug"],
      type: "enum",
      required: false,
      hidden: true,
      description: "Print stack traces for unexpected errors."
    });
  }
  if (controls.logLevel) {
    options.push({
      name: "logLevel",
      flags: ["--log-level"],
      type: "enum",
      required: false,
      hidden: true,
      description: "Set runtime diagnostic log level."
    });
  }
  if (controls.verbose) {
    options.push({
      name: "verbose",
      flags: ["-v", "--verbose"],
      type: "boolean",
      required: false,
      hidden: true,
      description: "Print detailed runtime diagnostics."
    });
  }
  if (versionEnabled) {
    options.push({
      name: "version",
      flags: ["--version"],
      type: "boolean",
      required: false,
      hidden: false,
      description: "Output the version number."
    });
  }

  return options;
}

function createSnapshotGroup<TServices extends object>(
  group: Group<TServices>,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>,
  pathSegments: string[],
  isDefault: boolean
): CLICommandTreeSnapshotGroup {
  const children = group.children
    .filter((child) => isNodeVisibleInScope(child, "cli"))
    .map((child) =>
      createSnapshotNode(
        child,
        casing,
        globalLongOptionFlags,
        [...pathSegments, child.name],
        group.default === child
      )
    );

  return {
    kind: "group",
    name: group.name,
    path: pathSegments,
    aliases: [...group.aliases],
    hidden: false,
    default: isDefault,
    ...(group.description === undefined ? {} : { description: group.description }),
    children
  };
}

function createSnapshotNode<TServices extends object>(
  node: Command<TServices, any, any, any> | Group<TServices>,
  casing: Casing,
  globalLongOptionFlags: ReadonlySet<string>,
  pathSegments: string[],
  isDefault: boolean
): CLICommandTreeSnapshotNode {
  if (node.kind === "group") {
    return createSnapshotGroup(node, casing, globalLongOptionFlags, pathSegments, isDefault);
  }

  const collected = collectFields(node.params, casing, globalLongOptionFlags);
  const fields = assignPositionals(collected.fields, node.positional);
  validateUniqueOptionFlags(fields, globalLongOptionFlags);

  return {
    kind: "command",
    name: node.name,
    path: pathSegments,
    aliases: [...node.aliases],
    hidden: node.hidden,
    default: isDefault,
    ...(node.description === undefined ? {} : { description: node.description }),
    options: [
      ...fields.map((field) => createFieldSnapshotOption(field, globalLongOptionFlags)),
      ...collected.dynamicFields.flatMap((field) => createDynamicSnapshotOptions(field, casing))
    ]
  };
}

function createFieldSnapshotOption(
  field: FieldDefinition,
  globalLongOptionFlags: ReadonlySet<string>
): CLICommandTreeSnapshotOption {
  return {
    name: field.displayPath,
    flags: formatHelpFieldFlags(field, globalLongOptionFlags).split(", "),
    type: formatJsonHelpSchemaType(field.schema),
    required: field.requiredWhenActive,
    hidden: false,
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.hasDefault ? { default: field.defaultValue } : {}),
    ...(field.positionalIndex === undefined ? {} : { positional: true }),
    ...(field.global === true ? { global: true } : {})
  };
}

function createDynamicSnapshotOptions(
  field: DynamicFieldDefinition,
  casing: Casing
): CLICommandTreeSnapshotOption[] {
  return formatDynamicHelpFields(field, casing).map((row) => ({
    name: field.displayPath,
    flags: [row.flags],
    type: describeDynamicFieldType(field),
    required: field.requiredWhenActive,
    hidden: false,
    ...(field.description === undefined ? {} : { description: field.description }),
    ...(field.hasDefault ? { default: field.defaultValue } : {}),
    dynamic: true
  }));
}

function addGlobalOptions(
  command: CommanderCommand,
  presetsEnabled: boolean,
  controls: ResolvedCLIControls
): void {
  const options: Option[] = [];

  if (presetsEnabled) {
    options.push(new Option("--preset <path>", "Load parameter defaults from a JSON file."));
  }

  if (controls.yes) {
    options.push(new Option("--yes", "Accept defaults and skip prompts."));
  }
  if (controls.output) {
    options.push(
      new Option("--output <format>", "Output format.").argParser((value: string) => {
        if (value === "rich" || value === "md" || value === "json") {
          return value;
        }

        if (value === "markdown") {
          return "md";
        }

        throw new InvalidArgumentError(
          formatInvalidEnumMessage("--output", value, ["rich", "md", "markdown", "json"], {
            candidates: ["rich", "markdown", "json"],
            threshold: 3
          })
        );
      })
    );
  }
  if (controls.debug) {
    options.push(
      new Option("--debug [mode]", "Print stack traces for unexpected errors.")
        .preset("trim")
        .argParser(parseDebugStackMode)
    );
  }
  if (controls.logLevel) {
    options.push(
      new Option("--log-level <level>", "Set runtime diagnostic log level.").argParser(
        parseLogLevel
      )
    );
  }
  if (controls.verbose) {
    options.push(new Option("--verbose", "Print detailed runtime diagnostics."));
  }

  for (const option of options) {
    option.hideHelp(true);
    command.addOption(option);
  }
}

function parseDebugStackMode(value: string | boolean): DebugStackMode {
  if (value === true || value === "trim") {
    return "trim";
  }

  if (value === "raw") {
    return "raw";
  }

  throw new InvalidArgumentError(
    formatInvalidEnumMessage("--debug", String(value), ["raw"], { candidates: ["raw"] })
  );
}

function parseLogLevel(value: string): LogLevel {
  if (isLogLevel(value)) {
    return value;
  }

  throw new InvalidArgumentError(
    formatInvalidEnumMessage("--log-level", value, [...LOG_LEVELS], {
      candidates: ["warn", "debug", "trace"],
      threshold: 3
    })
  );
}

function writeCLIDiagnosticEvent(event: DiagnosticLogEvent): void {
  const transcript = event.data?.transcript;
  if (typeof transcript === "string") {
    process.stderr.write(transcript);
    return;
  }

  if (event.category === "progress" || event.level === "trace") {
    return;
  }

  process.stderr.write(`${event.message}\n`);
}

function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] ?? "";
    const existing = Object.prototype.hasOwnProperty.call(cursor, segment)
      ? cursor[segment]
      : undefined;

    if (typeof existing === "object" && existing !== null) {
      cursor = existing as Record<string, unknown>;
      continue;
    }

    const next: Record<string, unknown> = {};
    Object.defineProperty(cursor, segment, {
      value: next,
      enumerable: true,
      configurable: true,
      writable: true
    });
    cursor = next;
  }

  const leaf = path[path.length - 1];
  if (leaf !== undefined) {
    Object.defineProperty(cursor, leaf, {
      value,
      enumerable: true,
      configurable: true,
      writable: true
    });
  }
}

function formatResolvedValue(value: unknown): string {
  if (Array.isArray(value)) {
    return value.map((item) => String(item)).join(", ");
  }

  if (typeof value === "string") {
    return value;
  }

  return JSON.stringify(value);
}

function fieldPromptLabel(field: FieldDefinition): string {
  return field.positionalIndex === undefined ? field.optionFlag : `<${field.displayPath}>`;
}

function enumOptionLabel(schema: Extract<FieldSchema, { kind: "enum" }>, value: unknown): string {
  const key = String(value);

  if (schema.labels === undefined || !Object.prototype.hasOwnProperty.call(schema.labels, key)) {
    return key;
  }

  return schema.labels[key] ?? key;
}

interface PromptStreams {
  input?: NodeJS.ReadableStream;
  output?: NodeJS.WritableStream;
}

function withPromptStreams<T extends object>(options: T, streams: PromptStreams): T & PromptStreams {
  return {
    ...options,
    ...(streams.input === undefined ? {} : { input: streams.input }),
    ...(streams.output === undefined ? {} : { output: streams.output })
  };
}

function throwPromptCancellation(): never {
  cancel("Operation cancelled.");
  throw new UserError("Operation cancelled.");
}

async function promptForField(
  field: FieldDefinition,
  streams: PromptStreams = {}
): Promise<unknown> {
  const schema = field.schema;
  if (schema.kind === "enum") {
    const options = schema.loadOptions
      ? await schema.loadOptions()
      : schema.values.map((value) => ({
          label: enumOptionLabel(schema, value),
          value
        }));
    const selected = await select(
      withPromptStreams(
        {
          message: field.description ?? fieldPromptLabel(field),
          options,
          initialValue: field.hasDefault ? field.defaultValue : undefined
        },
        streams
      )
    );

    if (isCancel(selected)) {
      throwPromptCancellation();
    }

    return selected;
  }

  if (field.schema.kind === "boolean") {
    const selected = await confirm(
      withPromptStreams(
        {
          message: fieldPromptLabel(field),
          initialValue: field.hasDefault ? Boolean(field.defaultValue) : undefined
        },
        streams
      )
    );

    if (isCancel(selected)) {
      throwPromptCancellation();
    }

    return selected;
  }

  const entered = await promptText(
    withPromptStreams(
      {
        message: fieldPromptLabel(field),
        initialValue:
          field.hasDefault && field.defaultValue !== undefined
            ? formatResolvedValue(field.defaultValue)
            : undefined
      },
      streams
    )
  );

  if (isCancel(entered)) {
    throwPromptCancellation();
  }

  if (typeof entered !== "string") {
    throw new UserError(`Missing required parameter "${field.displayPath}".`);
  }

  if (entered.trim().length === 0 && field.hasDefault) {
    return field.defaultValue;
  }

  if (field.schema.kind === "array") {
    return parseArrayValue(entered, field.schema, field.displayPath);
  }

  if (field.schema.kind === "json") {
    if (entered === "null" && field.schema.nullable === true) {
      return null;
    }

    return parseJsonText(entered, field.displayPath);
  }

  return parseScalarValue(entered, field.schema as ScalarSchema, field.displayPath);
}

function resolveOutput(resolvedFlags: ResolvedFlags): OutputMode {
  if (resolvedFlags.json === true) {
    return "json";
  }

  if (resolvedFlags.output !== undefined) {
    return resolvedFlags.output;
  }

  return "rich";
}

function resolveOutputFromArgv(argv: readonly string[]): OutputMode {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--json") {
      return "json";
    }
    if (token === "--md" || token === "--markdown") {
      return "md";
    }
    if (token === "--output") {
      const value = argv[index + 1];
      if (value === "rich" || value === "md" || value === "json") {
        return value;
      }
      if (value === "markdown") {
        return "md";
      }
      continue;
    }
    if (token.startsWith("--output=")) {
      const value = token.slice("--output=".length);
      if (value === "rich" || value === "md" || value === "json") {
        return value;
      }
      if (value === "markdown") {
        return "md";
      }
    }
  }

  return "rich";
}

const DESIGN_SYSTEM_OUTPUT_BY_MODE = {
  rich: "terminal",
  md: "markdown",
  json: "json"
} as const satisfies Record<OutputMode, "terminal" | "markdown" | "json">;

function toDesignSystemOutput(output: OutputMode): "terminal" | "markdown" | "json" {
  return DESIGN_SYSTEM_OUTPUT_BY_MODE[output];
}

async function withOutputFormat<T>(output: OutputMode, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OUTPUT_FORMAT;
  process.env.OUTPUT_FORMAT = toDesignSystemOutput(output);
  resetOutputFormatCache();

  try {
    return await fn();
  } finally {
    if (previous === undefined) {
      delete process.env.OUTPUT_FORMAT;
    } else {
      process.env.OUTPUT_FORMAT = previous;
    }
    resetOutputFormatCache();
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasFieldValue(value: unknown): boolean {
  return value !== undefined;
}

function hasNestedField(fields: FieldDefinition[], path: string[]): boolean {
  return fields.some(
    (field) =>
      path.length < field.path.length &&
      path.every((segment, index) => field.path[index] === segment)
  );
}

function describeExpectedPresetValue(schema: FieldSchema): string {
  if (schema.kind === "array") {
    return "an array";
  }

  if (schema.kind === "number") {
    return getExpectedNumberDescription(schema);
  }

  if (schema.kind === "json") {
    return "valid JSON";
  }

  if (schema.kind === "enum") {
    return `one of: ${schema.values.map((value) => JSON.stringify(value)).join(", ")}`;
  }

  return `a ${schema.kind}`;
}

function validatePresetScalarValue(
  value: unknown,
  schema: ScalarSchema,
  fieldPath: string,
  presetPath: string
): string | number | boolean | null {
  if (value === null && schema.nullable === true) {
    return null;
  }

  switch (schema.kind) {
    case "string":
      if (typeof value !== "string") {
        break;
      }
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        throw new UserError(
          `Preset file "${presetPath}" has an invalid value for "${fieldPath}". Expected a string with length at least ${schema.minLength}, got string with length ${value.length}.`
        );
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        throw new UserError(
          `Preset file "${presetPath}" has an invalid value for "${fieldPath}". Expected a string with length at most ${schema.maxLength}, got string with length ${value.length}.`
        );
      }
      if (schema.pattern !== undefined && !matchesStringPattern(value, schema.pattern)) {
        throw new UserError(
          `Preset file "${presetPath}" has an invalid value for "${fieldPath}": "${value}" does not match pattern "${schema.pattern}".`
        );
      }
      return value;

    case "number":
      if (!isValidNumberSchemaValue(value, schema)) {
        break;
      }
      return value;

    case "boolean":
      if (typeof value !== "boolean") {
        break;
      }
      return value;

    case "enum": {
      const match = schema.values.find((candidate) => Object.is(candidate, value));
      if (match !== undefined) {
        return match;
      }
      break;
    }
  }

  throw new UserError(
    `Preset file "${presetPath}" has an invalid value for "${fieldPath}". Expected ${describeExpectedPresetValue(schema)}, got ${describeReceived(value)}.`
  );
}

function validatePresetFieldValue(
  value: unknown,
  field: FieldDefinition,
  presetPath: string
): unknown {
  if (field.schema.kind === "json") {
    return value;
  }

  if (field.schema.kind !== "array") {
    return validatePresetScalarValue(
      value,
      field.schema as ScalarSchema,
      field.displayPath,
      presetPath
    );
  }

  const itemSchema = unwrapOptional(field.schema.item);

  if (itemSchema.kind === "array" || itemSchema.kind === "object") {
    throw new UserError(`Array parameter "${field.displayPath}" must use scalar items.`);
  }

  if (!Array.isArray(value)) {
    throw new UserError(
      `Preset file "${presetPath}" has an invalid value for "${field.displayPath}". Expected an array, got ${describeReceived(value)}.`
    );
  }

  if (field.schema.minItems !== undefined && value.length < field.schema.minItems) {
    throw new UserError(
      `Preset file "${presetPath}" has an invalid value for "${field.displayPath}". Expected an array with at least ${field.schema.minItems} items, got array(${value.length}).`
    );
  }

  if (field.schema.maxItems !== undefined && value.length > field.schema.maxItems) {
    throw new UserError(
      `Preset file "${presetPath}" has an invalid value for "${field.displayPath}". Expected an array with at most ${field.schema.maxItems} items, got array(${value.length}).`
    );
  }

  return value.map((item) =>
    validatePresetScalarValue(item, itemSchema as ScalarSchema, field.displayPath, presetPath)
  );
}

async function loadPresetValues(
  fields: FieldDefinition[],
  presetPath: string
): Promise<Record<string, unknown>> {
  let rawPreset: string;

  try {
    rawPreset = await readFile(presetPath, {
      encoding: "utf8"
    });
  } catch (error) {
    if (hasOwnErrorCode(error, "ENOENT")) {
      throw new UserError(`Preset file "${presetPath}" was not found.`);
    }

    const message =
      error instanceof Error && error.message.length > 0 ? error.message : "Unknown read error.";
    throw new UserError(`Preset file "${presetPath}" could not be read: ${message}`);
  }

  let parsedPreset: unknown;

  try {
    parsedPreset = JSON.parse(rawPreset);
  } catch (error) {
    throw new UserError(
      formatJsonParseUserErrorMessage("Preset file", presetPath, rawPreset, error, {
        quotePath: true
      }),
      { cause: error }
    );
  }

  if (!isPlainObject(parsedPreset)) {
    throw new UserError(`Preset file "${presetPath}" must contain a JSON object.`);
  }

  const fieldByPath = new Map(fields.map((field) => [field.displayPath, field]));
  const presetValues: Record<string, unknown> = {};

  function visitObject(current: Record<string, unknown>, path: string[]): void {
    for (const [key, value] of Object.entries(current)) {
      const nextPath = [...path, key];
      const displayPath = toDisplayPath(nextPath);
      const field = fieldByPath.get(displayPath);

      if (field !== undefined) {
        presetValues[field.optionAttribute] = validatePresetFieldValue(value, field, presetPath);
        continue;
      }

      if (!hasNestedField(fields, nextPath)) {
        throw new UserError(
          `Preset file "${presetPath}" contains unknown parameter "${displayPath}".`
        );
      }

      if (!isPlainObject(value)) {
        throw new UserError(
          `Preset file "${presetPath}" has an invalid value for "${displayPath}". Expected an object, got ${describeReceived(value)}.`
        );
      }

      visitObject(value, nextPath);
    }
  }

  visitObject(parsedPreset, []);
  return presetValues;
}

function isNumericFixtureSelector(value: string): boolean {
  if (value.length === 0) {
    return false;
  }

  for (const char of value) {
    if (char < "0" || char > "9") {
      return false;
    }
  }

  return true;
}

function normalizeHttpMethod(value: string | undefined): string {
  return (value ?? "GET").toUpperCase();
}

function isReadLikeMethod(name: string): boolean {
  const normalized = name.toLowerCase();

  return (
    normalized === "get" ||
    normalized === "head" ||
    normalized === "options" ||
    normalized.startsWith("read") ||
    normalized.startsWith("get") ||
    normalized.startsWith("find") ||
    normalized.startsWith("list") ||
    normalized.startsWith("load") ||
    normalized.startsWith("fetch") ||
    normalized.startsWith("query") ||
    normalized.startsWith("exists") ||
    normalized.startsWith("has")
  );
}

function isWriteLikeMethod(name: string): boolean {
  const normalized = name.toLowerCase();

  return (
    normalized === "post" ||
    normalized === "put" ||
    normalized === "patch" ||
    normalized === "delete" ||
    normalized.startsWith("write") ||
    normalized.startsWith("set") ||
    normalized.startsWith("save") ||
    normalized.startsWith("create") ||
    normalized.startsWith("update") ||
    normalized.startsWith("delete") ||
    normalized.startsWith("remove") ||
    normalized.startsWith("insert")
  );
}

function matchesFixtureValue(expected: unknown, actual: unknown): boolean {
  if (typeof expected === "string" && typeof actual === "string" && expected.endsWith("%")) {
    return actual.startsWith(expected.slice(0, -1));
  }

  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || expected.length !== actual.length) {
      return false;
    }

    return expected.every((item, index) => matchesFixtureValue(item, actual[index]));
  }

  if (isPlainObject(expected)) {
    if (!isPlainObject(actual)) {
      return false;
    }

    return Object.entries(expected).every(([key, value]) =>
      matchesFixtureValue(value, actual[key])
    );
  }

  return Object.is(expected, actual);
}

function getFetchUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function createFixtureResponse(response: FixtureFetchResponse): Response {
  const status = response.status ?? 200;
  const headers = new Headers(response.headers);

  if (response.body === undefined) {
    return new Response(null, {
      status,
      headers
    });
  }

  if (typeof response.body === "string") {
    return new Response(response.body, {
      status,
      headers
    });
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Response(JSON.stringify(response.body), {
    status,
    headers
  });
}

function createFixtureFetch(entries: FixtureFetchEntry[] | undefined): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = normalizeHttpMethod(
      init?.method ?? (input instanceof Request ? input.method : undefined)
    );
    const url = getFetchUrl(input);
    const match = entries?.find((entry) => {
      const requestMethod = normalizeHttpMethod(entry.request.method);
      return requestMethod === method && entry.request.url === url;
    });

    if (match !== undefined) {
      return createFixtureResponse(match.response);
    }

    if (isReadLikeMethod(method)) {
      return null as unknown as Response;
    }

    return new Response(null, {
      status: 204
    });
  };
}

function createFixtureFs(definition: unknown): HandlerFs {
  const fsDefinition = isPlainObject(definition) ? definition : {};
  const readFileEntries = isPlainObject(fsDefinition.readFile) ? fsDefinition.readFile : {};
  const existsEntries = isPlainObject(fsDefinition.exists) ? fsDefinition.exists : {};

  return {
    readFile: async (filePath: string) => {
      if (Object.prototype.hasOwnProperty.call(readFileEntries, filePath)) {
        return String(readFileEntries[filePath]);
      }

      return null as unknown as string;
    },
    writeFile: async () => undefined,
    exists: async (filePath: string) => {
      if (Object.prototype.hasOwnProperty.call(existsEntries, filePath)) {
        return Boolean(existsEntries[filePath]);
      }

      return Object.prototype.hasOwnProperty.call(readFileEntries, filePath);
    },
    lstat: async () => ({ isSymbolicLink: () => false }),
    rename: async () => undefined,
    unlink: async () => undefined
  };
}

function resolveFixtureMethodResult(
  methodName: string,
  definition: unknown,
  args: unknown[]
): Promise<unknown> {
  if (Array.isArray(definition)) {
    for (const entry of definition) {
      if (!isPlainObject(entry)) {
        continue;
      }

      const explicitMatcher = isPlainObject(entry.request) ? entry.request : undefined;
      const matcher =
        explicitMatcher ??
        Object.fromEntries(
          Object.entries(entry).filter(
            ([key]) => key !== "result" && key !== "response" && key !== "error"
          )
        );

      const firstArg = args[0];
      let matched = false;

      if (Array.isArray(matcher.args)) {
        matched = matchesFixtureValue(matcher.args, args);
      } else if (Object.keys(matcher).length === 0) {
        matched = true;
      } else if (isPlainObject(firstArg)) {
        matched = matchesFixtureValue(matcher, firstArg);
      } else if (args.length === 1 && Object.keys(matcher).length === 1) {
        const [[, expectedValue]] = Object.entries(matcher);
        matched = matchesFixtureValue(expectedValue, firstArg);
      }

      if (!matched) {
        continue;
      }

      if (entry.error !== undefined) {
        throw new Error(String(entry.error));
      }

      if (Object.prototype.hasOwnProperty.call(entry, "result")) {
        return Promise.resolve(entry.result);
      }

      if (Object.prototype.hasOwnProperty.call(entry, "response")) {
        return Promise.resolve(entry.response);
      }

      return Promise.resolve(null);
    }
  }

  if (isPlainObject(definition)) {
    const firstArg = args[0];

    if (
      typeof firstArg === "string" &&
      Object.prototype.hasOwnProperty.call(definition, firstArg)
    ) {
      return Promise.resolve(definition[firstArg]);
    }
  }

  if (isWriteLikeMethod(methodName)) {
    return Promise.resolve(undefined);
  }

  return Promise.resolve(null);
}

function createFixtureService(definition: unknown): Record<string, unknown> {
  const methods = isPlainObject(definition) ? definition : {};

  return new Proxy(
    {},
    {
      get(_target, property) {
        if (property === "then") {
          return undefined;
        }

        const methodName = String(property);
        return async (...args: unknown[]) =>
          resolveFixtureMethodResult(methodName, methods[methodName], args);
      }
    }
  );
}

function resolveFixturePath(commandPath: string): string {
  const parsed = path.parse(commandPath);
  return path.join(parsed.dir, `${parsed.name}.fixture.json`);
}

function selectFixtureScenario(
  scenarios: FixtureScenario[],
  selector: string,
  fixturePath: string
): FixtureScenario {
  if (isNumericFixtureSelector(selector)) {
    const index = Number(selector) - 1;
    const scenario = scenarios[index];

    if (scenario === undefined) {
      throw new UserError(
        `Fixture scenario index ${selector} is out of range. Available scenarios: ${scenarios.length}.`
      );
    }

    return scenario;
  }

  const scenario = scenarios.find((entry) => entry.name === selector);

  if (scenario === undefined) {
    const names = scenarios
      .map((entry) => entry.name)
      .filter((name): name is string => typeof name === "string" && name.length > 0);
    const available =
      names.length === 0
        ? `No fixtures are declared in ${fixturePath}.`
        : formatAvailableList(names);
    throw new UserError(`Fixture scenario "${selector}" was not found. ${available}`);
  }

  return scenario;
}

async function loadFixtureScenario(
  command: Command<any, any, any, any>,
  selector: string
): Promise<FixtureScenario> {
  const commandPath = getCommandSourcePath(command);

  if (commandPath === undefined) {
    throw new UserError(
      `Fixture mode could not determine the source file for command "${command.name}".`
    );
  }

  const fixturePath = resolveFixturePath(commandPath);
  let rawFixture: string;

  try {
    rawFixture = await readFile(fixturePath, {
      encoding: "utf8"
    });
  } catch {
    throw new UserError(
      `Fixture file not found for command "${command.name}". Expected ${fixturePath}.`
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawFixture);
  } catch (error) {
    throw new UserError(
      formatJsonParseUserErrorMessage("Fixture file", fixturePath, rawFixture, error, {
        quotePath: false
      }),
      { cause: error }
    );
  }

  if (!Array.isArray(parsed)) {
    throw new UserError(`Fixture file ${fixturePath} must contain a JSON array of scenarios.`);
  }

  return selectFixtureScenario(parsed as FixtureScenario[], selector, fixturePath);
}

function resolveFixtureSecrets(command: Command<any, any, any, any>): Record<string, string> {
  return Object.fromEntries(Object.keys(command.secrets).map((name) => [name, "fixture-secret"]));
}

function createFixtureEnvValues(
  command: Command<any, any, any, any>
): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {
    ...process.env,
    POE_API_KEY: process.env.POE_API_KEY ?? "fixture-secret"
  };

  for (const secret of Object.values(command.secrets)) {
    values[secret.env] = values[secret.env] ?? "fixture-secret";
  }

  return values;
}

async function resolveFixtureRuntime<TServices extends object>(
  command: Command<TServices, any, any, any>,
  services: TServices,
  requirementOptions: CommandRequirementOptions,
  runtimeFetch: typeof globalThis.fetch,
  runtimeEnv?: Record<string, string>,
  runtimeFs?: HandlerFs
): Promise<ResolvedFixtureRuntime<TServices>> {
  const selector = process.env.TOOLCRAFT_FIXTURE;

  if (selector === undefined || selector.length === 0) {
    return {
      env: createEnv(runtimeEnv),
      fetch: runtimeFetch,
      fs: createFs(runtimeFs),
      isFixture: false,
      requirementOptions,
      secrets: resolveCommandSecrets(command, runtimeEnv),
      services
    };
  }

  const scenario = await loadFixtureScenario(command, selector);
  const scenarioServices = isPlainObject(scenario.services) ? scenario.services : {};
  const customServiceNames = new Set([
    ...Object.keys(services as Record<string, unknown>),
    ...Object.keys(scenarioServices).filter((name) => !RESERVED_SERVICE_NAMES.has(name))
  ]);
  const fixtureServices = Object.fromEntries(
    [...customServiceNames].map((name) => [name, createFixtureService(scenarioServices[name])])
  ) as TServices;
  const fixtureEnvValues = createFixtureEnvValues(command);

  return {
    env: createEnv(fixtureEnvValues),
    fetch: createFixtureFetch(scenarioServices.fetch as FixtureFetchEntry[] | undefined),
    fs: createFixtureFs(scenarioServices.fs),
    isFixture: true,
    requirementOptions: {
      ...requirementOptions,
      env: fixtureEnvValues
    },
    secrets: resolveFixtureSecrets(command),
    services: fixtureServices
  };
}

function writeRichHeader(title: string): void {
  const padding = Math.max(12, 34 - title.length);
  process.stdout.write(`── ${title} ${"─".repeat(padding)}\n`);
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

function renderHumanInLoopPending(pending: HumanInLoopPending): void {
  process.stdout.write(
    `✓ Queued for human approval (id: ${pending.approvalId})\n` +
      `  Message: ${pending.message}\n` +
      `  Track:   toolcraft approvals show ${pending.approvalId}\n`
  );
}

function renderApprovalDeclined(error: ApprovalDeclinedError): void {
  const logger = createLogger();
  logger.error(error.message);
  process.exitCode = 1;
}

type CliErrorPattern =
  | {
      kind: "usage";
      message: string;
      rootUsageName: string;
      commandPath: string;
    }
  | {
      kind: "runtime-user";
      message: string;
    }
  | {
      kind: "definition";
      error: Error;
      debugStackMode: DebugStackMode | undefined;
    }
  | {
      kind: "toolcraft-bug";
      error: Error;
      debugStackMode: DebugStackMode | undefined;
    }
  | {
      kind: "unexpected";
      message: string;
      stack: string | undefined;
      debugStackMode: DebugStackMode | undefined;
    };

function renderCliErrorPattern(
  pattern: CliErrorPattern,
  outputEmitter?: (entry: string) => void
): void {
  const logger = createLogger(outputEmitter);

  if (pattern.kind === "usage") {
    logger.error(
      appendUsagePointer(pattern.message, {
        rootUsageName: pattern.rootUsageName,
        commandPath: pattern.commandPath
      })
    );
    process.exitCode = 1;
    return;
  }

  if (pattern.kind === "runtime-user") {
    logger.error(pattern.message);
    process.exitCode = 1;
    return;
  }

  if (pattern.kind === "definition") {
    logger.error(
      `Command definition error: ${pattern.error.message}\n` +
        "This is a bug in the generated command definition, not in your command arguments.\n" +
        "Run with --debug for a stack trace."
    );
    if (pattern.debugStackMode !== undefined && pattern.error.stack) {
      process.stderr.write(`${formatDebugStack(pattern.error.stack, pattern.debugStackMode)}\n`);
    }
    process.exitCode = 1;
    return;
  }

  if (pattern.kind === "toolcraft-bug") {
    logger.error(
      `toolcraft hit an internal invariant: ${pattern.error.message}\n` +
        `This is a bug in toolcraft or in the command definition; ` +
        `it cannot be worked around by changing argv. ` +
        `Re-run with --debug for a stack trace and file an issue.`
    );
    if (pattern.debugStackMode !== undefined && pattern.error.stack) {
      process.stderr.write(`${formatDebugStack(pattern.error.stack, pattern.debugStackMode)}\n`);
    }
    process.exitCode = 1;
    return;
  }

  logger.error(
    pattern.debugStackMode !== undefined
      ? pattern.message
      : `${pattern.message} Use --debug for a stack trace.`
  );
  if (pattern.debugStackMode !== undefined && pattern.stack !== undefined) {
    process.stderr.write(`${formatDebugStack(pattern.stack, pattern.debugStackMode)}\n`);
  }
  process.exitCode = 1;
}

function getNestedValue(target: Record<string, unknown>, path: string[]): unknown {
  return path.reduce<unknown>(
    (current, segment) =>
      current !== null && typeof current === "object"
        ? (current as Record<string, unknown>)[segment]
        : undefined,
    target
  );
}

function parseFieldInputValue(value: string, schema: FieldSchema, label: string): unknown {
  if (schema.kind === "array") {
    return parseArrayValue(value, schema, label);
  }

  if (schema.kind === "json") {
    if (value === "null" && schema.nullable === true) {
      return null;
    }

    return parseJsonText(value, label);
  }

  return parseScalarValue(value, schema, label);
}

function parseOptionFieldValue(
  field: FieldDefinition,
  value: unknown,
  errors: ValidationError[]
): { ok: true; value: unknown } | { ok: false } {
  try {
    if (value === null) {
      return { ok: true, value };
    }

    if (field.schema.kind === "array" && Array.isArray(value)) {
      const parsedValues: unknown[] = [];

      for (const item of value) {
        const parsed = parseArrayValue(String(item), field.schema, field.displayPath);
        if (parsed === null) {
          return { ok: true, value: null };
        }

        parsedValues.push(...parsed);
      }

      validateArrayBounds(parsedValues, field.schema, field.displayPath);
      return { ok: true, value: parsedValues };
    }

    if (typeof value !== "string") {
      return { ok: true, value };
    }

    const parsedValue = parseFieldInputValue(value, field.schema, field.displayPath);
    if (field.schema.kind === "array" && Array.isArray(parsedValue)) {
      validateArrayBounds(parsedValue, field.schema, field.displayPath);
    }

    return { ok: true, value: parsedValue };
  } catch (error) {
    if (error instanceof UserError || error instanceof InvalidArgumentError) {
      errors.push({
        path: field.displayPath,
        message: error.message
      });
      return { ok: false };
    }

    throw error;
  }
}

function consumeFieldValue(
  args: string[],
  index: number,
  schema: FieldSchema,
  label: string,
  inlineValue?: string
): {
  nextIndex: number;
  value: unknown;
} {
  if (schema.kind === "boolean") {
    if (inlineValue !== undefined) {
      return {
        nextIndex: index,
        value: parseScalarValue(inlineValue, schema, label)
      };
    }

    const next = args[index + 1];
    if (next === "true" || next === "false" || (schema.nullable === true && next === "null")) {
      return {
        nextIndex: index + 1,
        value: parseScalarValue(next, schema, label)
      };
    }

    return {
      nextIndex: index,
      value: true
    };
  }

  if (inlineValue !== undefined) {
    return {
      nextIndex: index,
      value: parseFieldInputValue(inlineValue, schema, label)
    };
  }

  if (schema.kind === "array") {
    const values: unknown[] = [];
    let nextIndex = index;
    let cursor = index + 1;

    while (cursor < args.length) {
      const token = args[cursor] ?? "";
      if (isNextArrayOptionToken(token, schema)) {
        break;
      }

      const parsed = parseArrayValue(token, schema, label);
      if (parsed === null) {
        return {
          nextIndex: cursor,
          value: null
        };
      }

      values.push(...parsed);
      nextIndex = cursor;
      cursor += 1;
    }

    if (values.length === 0) {
      throw new InvalidArgumentError(`option '${label}' argument missing`);
    }

    validateArrayBounds(values, schema, label);

    return {
      nextIndex,
      value: values
    };
  }

  const next = args[index + 1];
  if (next === undefined) {
    throw new InvalidArgumentError(`option '${label}' argument missing`);
  }

  return {
    nextIndex: index + 1,
    value: parseFieldInputValue(next, schema, label)
  };
}

function resolveDynamicLeaf(
  schema: AnySchema,
  rawSegments: string[],
  casing: Casing,
  outputPath: string[] = [],
  displayPath: string[] = [],
  displayPathPrefix = ""
): {
  displayPath: string;
  path: string[];
  schema: FieldSchema;
} {
  const unwrappedSchema = unwrapOptional(schema);
  const kind = formatCliSchemaKind(unwrappedSchema.kind);

  if (rawSegments.length === 0) {
    if (
      unwrappedSchema.kind === "json" ||
      unwrappedSchema.kind === "array" ||
      unwrappedSchema.kind === "string" ||
      unwrappedSchema.kind === "number" ||
      unwrappedSchema.kind === "boolean" ||
      unwrappedSchema.kind === "enum"
    ) {
      return {
        displayPath: toDisplayPath(displayPath),
        path: outputPath,
        schema: unwrappedSchema as FieldSchema
      };
    }

    throw new UserError(
      formatUnsupportedDynamicSchemaMessage(
        kind,
        qualifyDisplayPath(displayPathPrefix, toDisplayPath(displayPath))
      )
    );
  }

  switch (unwrappedSchema.kind) {
    case "object": {
      const [head, ...rest] = rawSegments;

      for (const [key, childSchema] of Object.entries(unwrappedSchema.shape) as Array<
        [string, AnySchema]
      >) {
        if (formatSegment(key, casing) !== head) {
          continue;
        }

        return resolveDynamicLeaf(
          childSchema,
          rest,
          casing,
          [...outputPath, key],
          [...displayPath, key],
          displayPathPrefix
        );
      }

      throw new UserError(
        `Unknown parameter "${qualifyDisplayPath(
          displayPathPrefix,
          [...displayPath, head].join(".")
        )}". ${formatAvailableList(
          Object.keys(unwrappedSchema.shape).map((key) =>
            qualifyDisplayPath(
              displayPathPrefix,
              toDisplayPath([...displayPath, formatSegment(key, casing)])
            )
          )
        )}`
      );
    }

    case "record": {
      const [head, ...rest] = rawSegments;
      return resolveDynamicLeaf(
        unwrappedSchema.value,
        rest,
        casing,
        [...outputPath, head ?? ""],
        [...displayPath, head ?? ""],
        displayPathPrefix
      );
    }

    case "array": {
      const itemSchema = unwrapOptional(unwrappedSchema.item);
      if (itemSchema.kind !== "object") {
        throw new UserError(
          `Array parameter "${qualifyDisplayPath(
            displayPathPrefix,
            toDisplayPath(displayPath)
          )}" must use object items.`
        );
      }

      const [head, ...rest] = rawSegments;
      if (head === undefined || !isNumericFixtureSelector(head)) {
        throw new UserError(
          `Array parameter "${qualifyDisplayPath(
            displayPathPrefix,
            toDisplayPath(displayPath)
          )}" must use numeric indices.`
        );
      }

      return resolveDynamicLeaf(
        itemSchema,
        rest,
        casing,
        [...outputPath, head],
        [...displayPath, head],
        displayPathPrefix
      );
    }

    default:
      throw new UserError(
        `Unknown parameter "${qualifyDisplayPath(
          displayPathPrefix,
          [...displayPath, ...rawSegments].join(".")
        )}". ${formatAvailableList(
          displayPath.length === 0
            ? []
            : [qualifyDisplayPath(displayPathPrefix, toDisplayPath(displayPath))]
        )}`
      );
  }
}

function finalizeDynamicValue(
  schema: AnySchema,
  value: unknown,
  displayPath: string,
  errors: ValidationError[]
): unknown {
  const unwrappedSchema = unwrapOptional(schema);

  if (value === undefined) {
    return undefined;
  }

  if (value === null && unwrappedSchema.nullable === true) {
    return null;
  }

  switch (unwrappedSchema.kind) {
    case "string":
    case "number":
    case "boolean":
    case "enum":
    case "json":
      return value;

    case "array": {
      const itemSchema = unwrapOptional(unwrappedSchema.item);
      if (itemSchema.kind !== "object") {
        return value;
      }

      if (!isPlainObject(value)) {
        errors.push({
          path: displayPath,
          message: `Invalid value for "${displayPath}". Expected indexed object entries, got ${describeReceived(value)}.`
        });
        return value;
      }

      const entries = Object.entries(value);
      const indices = entries.map(([key]) => Number(key)).sort((left, right) => left - right);

      if (indices.some((index) => !Number.isInteger(index) || index < 0)) {
        errors.push({
          path: displayPath,
          message: `Array parameter "${displayPath}" must use numeric indices.`
        });
        return value;
      }

      for (let index = 0; index < indices.length; index += 1) {
        if (indices[index] !== index) {
          errors.push({
            path: displayPath,
            message: `Array parameter "${displayPath}" must use contiguous indices starting at 0.`
          });
          return value;
        }
      }

      return indices.map((index) =>
        finalizeDynamicValue(
          unwrappedSchema.item,
          (value as Record<string, unknown>)[String(index)],
          `${displayPath}.${index}`,
          errors
        )
      );
    }

    case "object": {
      if (!isPlainObject(value)) {
        errors.push({
          path: displayPath,
          message: `Invalid value for "${displayPath}". Expected an object, got ${describeReceived(value)}.`
        });
        return value;
      }

      const result: Record<string, unknown> = {};
      for (const [key, rawChildSchema] of Object.entries(unwrappedSchema.shape) as Array<
        [string, AnySchema]
      >) {
        const childSchema = unwrapOptional(rawChildSchema);
        const childValue = value[key];
        const childDisplayPath = displayPath.length === 0 ? key : `${displayPath}.${key}`;

        if (childValue === undefined) {
          if (childSchema.default !== undefined) {
            result[key] = childSchema.default;
            continue;
          }

          if (rawChildSchema.kind === "optional") {
            continue;
          }

          errors.push({
            path: childDisplayPath,
            message: `Missing required parameter "${childDisplayPath}".`
          });
          continue;
        }

        result[key] = finalizeDynamicValue(rawChildSchema, childValue, childDisplayPath, errors);
      }

      return result;
    }

    case "record": {
      if (!isPlainObject(value)) {
        errors.push({
          path: displayPath,
          message: `Invalid value for "${displayPath}". Expected an object, got ${describeReceived(value)}.`
        });
        return value;
      }

      return Object.fromEntries(
        Object.entries(value).map(([key, entryValue]) => [
          key,
          finalizeDynamicValue(
            unwrappedSchema.value,
            entryValue,
            displayPath.length === 0 ? key : `${displayPath}.${key}`,
            errors
          )
        ])
      );
    }

    default:
      errors.push({
        path: displayPath,
        message: formatUnsupportedDynamicSchemaMessage(
          formatCliSchemaKind(unwrappedSchema.kind),
          displayPath
        )
      });
      return value;
  }
}

function formatCliSchemaKind(kind: string): string {
  return kind === "oneOf" ? "oneof" : kind;
}

function formatUnsupportedDynamicSchemaMessage(kind: string, displayPath: string): string {
  return `Unsupported parameter type "${kind}" for "${displayPath}". Supported types: string, number, integer, boolean, array, object, enum, oneof.`;
}

function qualifyDisplayPath(prefix: string, displayPath: string): string {
  if (prefix.length === 0) {
    return displayPath;
  }

  if (displayPath.length === 0) {
    return prefix;
  }

  return `${prefix}.${displayPath}`;
}

function parseDynamicValues(
  dynamicFields: DynamicFieldDefinition[],
  rawArgv: string[],
  casing: Casing,
  errors: ValidationError[]
): {
  providedFieldIds: Set<string>;
  values: Map<string, unknown>;
} {
  const rawValues = new Map<string, Record<string, unknown>>();
  const providedFieldIds = new Set<string>();
  const sortedFields = [...dynamicFields].sort(
    (left, right) => right.optionPath.length - left.optionPath.length
  );

  for (let index = 0; index < rawArgv.length; index += 1) {
    const token = rawArgv[index] ?? "";
    if (!token.startsWith("--")) {
      continue;
    }

    const negated = token.startsWith("--no-");
    const normalized = negated ? `--${token.slice("--no-".length)}` : token;
    const equalsIndex = normalized.indexOf("=");
    const flagName = equalsIndex >= 0 ? normalized.slice(2, equalsIndex) : normalized.slice(2);
    const inlineValue = equalsIndex >= 0 ? normalized.slice(equalsIndex + 1) : undefined;
    const flagPath = flagName.split(".");
    const match = sortedFields.find((field) => {
      const optionPath = field.optionPath.map((segment) => formatSegment(segment, casing));
      return (
        flagPath.length > optionPath.length &&
        optionPath.every((segment, segmentIndex) => flagPath[segmentIndex] === segment)
      );
    });

    if (match === undefined) {
      throw new UserError(
        `Unknown parameter "${flagName}". ${formatAvailableList(
          dynamicFields.map((field) => field.optionPathDisplay)
        )}`
      );
    }

    const optionPath = match.optionPath.map((segment) => formatSegment(segment, casing));
    const remainder = flagPath.slice(optionPath.length);
    const leaf = resolveDynamicLeaf(match.schema, remainder, casing, [], [], match.displayPath);
    const rawStore = rawValues.get(match.id) ?? {};
    const label = `${match.displayPath}.${leaf.displayPath}`.replace(/^\./u, "");
    const parsed =
      negated && leaf.schema.kind === "boolean"
        ? {
            nextIndex: index,
            value: false
          }
        : consumeFieldValue(rawArgv, index, leaf.schema, label, inlineValue);

    setNestedValue(rawStore, leaf.path, parsed.value);
    rawValues.set(match.id, rawStore);
    providedFieldIds.add(match.id);
    index = parsed.nextIndex;
  }

  return {
    providedFieldIds,
    values: new Map(
      dynamicFields
        .filter((field) => rawValues.has(field.id))
        .map((field) => [
          field.id,
          finalizeDynamicValue(
            field.schema.kind === "record" ? field.schema : field.schema,
            rawValues.get(field.id),
            field.displayPath,
            errors
          )
        ])
    )
  };
}

async function enforceVariantConstraints(
  params: Record<string, unknown>,
  fields: FieldDefinition[],
  dynamicFields: DynamicFieldDefinition[],
  variants: VariantDefinition[],
  resolvedFieldValues: Map<string, unknown>,
  providedDynamicFieldIds: Set<string>,
  providedFieldIds: Set<string>,
  shouldPrompt: boolean,
  errors: ValidationError[]
): Promise<void> {
  const fieldById = new Map(fields.map((field) => [field.id, field]));
  const dynamicFieldById = new Map(dynamicFields.map((field) => [field.id, field]));
  const getAvailableBranchParameters = (branch: VariantBranchDefinition): string[] => [
    ...branch.fieldIds
      .map((fieldId) => fieldById.get(fieldId))
      .filter((field): field is FieldDefinition => field !== undefined && field.synthetic !== true)
      .map((field) => field.displayPath),
    ...branch.dynamicFieldIds
      .map((fieldId) => dynamicFieldById.get(fieldId))
      .filter((field): field is DynamicFieldDefinition => field !== undefined)
      .map((field) => field.optionPathDisplay)
  ];

  for (const variant of variants) {
    let selectedBranchId = resolvedFieldValues.get(variant.controlFieldId);

    if (selectedBranchId === undefined && shouldPrompt) {
      const controlField = fieldById.get(variant.controlFieldId);
      if (controlField !== undefined) {
        selectedBranchId = await promptForField(controlField);
        resolvedFieldValues.set(controlField.id, selectedBranchId);
        if (!controlField.synthetic) {
          setNestedValue(params, controlField.path, selectedBranchId);
        }
      }
    }

    if (selectedBranchId === undefined) {
      if (variant.optional) {
        continue;
      }

      errors.push({
        path: variant.controlDisplayPath,
        message: `Missing required parameter "${variant.controlDisplayPath}".`
      });
      continue;
    }

    const selectedBranch = variant.branches.find((branch) => branch.branchId === selectedBranchId);
    if (selectedBranch === undefined) {
      errors.push({
        path: variant.controlDisplayPath,
        message: `Invalid value for "${variant.controlDisplayPath}". Expected one of: ${variant.branches.map((branch) => branch.branchId).join(", ")}, got ${describeReceived(selectedBranchId)}.`
      });
      continue;
    }

    let hasInvalidBranchParameter = false;

    for (const branch of variant.branches) {
      if (branch.branchId === selectedBranch.branchId) {
        continue;
      }

      const invalidFieldId = branch.fieldIds.find((fieldId) => providedFieldIds.has(fieldId));
      if (invalidFieldId !== undefined) {
        const field = fieldById.get(invalidFieldId);
        if (field !== undefined) {
          errors.push({
            path: field.displayPath,
            message: `Unknown parameter "${field.displayPath}" for ${variant.controlDisplayPath}="${selectedBranch.branchId}". ${formatAvailableList(
              getAvailableBranchParameters(selectedBranch)
            )}`
          });
          hasInvalidBranchParameter = true;
        }
      }

      const invalidDynamicFieldId = branch.dynamicFieldIds.find((fieldId) =>
        providedDynamicFieldIds.has(fieldId)
      );
      if (invalidDynamicFieldId !== undefined) {
        const field = dynamicFieldById.get(invalidDynamicFieldId);
        if (field !== undefined) {
          errors.push({
            path: field.displayPath,
            message: `Unknown parameter "${field.displayPath}" for ${variant.controlDisplayPath}="${selectedBranch.branchId}". ${formatAvailableList(
              getAvailableBranchParameters(selectedBranch)
            )}`
          });
          hasInvalidBranchParameter = true;
        }
      }
    }

    if (hasInvalidBranchParameter) {
      continue;
    }

    for (const fieldId of selectedBranch.requiredFieldIds) {
      const field = fieldById.get(fieldId);
      if (field === undefined || field.synthetic) {
        continue;
      }

      if (getNestedValue(params, field.path) !== undefined) {
        continue;
      }

      if (shouldPrompt) {
        const promptedValue = await promptForField(field);
        resolvedFieldValues.set(field.id, promptedValue);
        setNestedValue(params, field.path, promptedValue);
        providedFieldIds.add(field.id);
        continue;
      }

      errors.push({
        path: field.displayPath,
        message: `Missing required parameter "${field.displayPath}" for ${variant.controlDisplayPath}="${selectedBranch.branchId}". ${formatAvailableList(
          getAvailableBranchParameters(selectedBranch)
        )}`
      });
    }

    for (const fieldId of selectedBranch.requiredDynamicFieldIds) {
      const field = dynamicFieldById.get(fieldId);
      if (field === undefined) {
        continue;
      }

      if (getNestedValue(params, field.path) !== undefined) {
        continue;
      }

      errors.push({
        path: field.displayPath,
        message: `Missing required parameter "${field.displayPath}" for ${variant.controlDisplayPath}="${selectedBranch.branchId}". ${formatAvailableList(
          getAvailableBranchParameters(selectedBranch)
        )}`
      });
    }
  }
}

async function resolveParams(
  fields: FieldDefinition[],
  dynamicFields: DynamicFieldDefinition[],
  variants: VariantDefinition[],
  positionalValues: unknown[],
  optionValues: Record<string, unknown>,
  rawArgv: string[],
  casing: Casing,
  presetPath: string | undefined,
  shouldPrompt: boolean,
  missingParameterContext: CliMissingParameterContext | undefined,
  promptStreams: PromptStreams
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};
  const presetValues =
    typeof presetPath === "string" && presetPath.length > 0
      ? await loadPresetValues(fields, presetPath)
      : {};
  const providedFieldIds = new Set<string>();
  const resolvedFieldValues = new Map<string, unknown>();
  const errors: ValidationError[] = [];

  for (const field of fields) {
    let value: unknown;
    let resolvedMissing = false;
    let source: "default" | "option" | "positional" | "preset" | "prompt" | undefined;

    if (field.positionalIndex !== undefined) {
      const positionalValue = positionalValues[field.positionalIndex];

      if (field.schema.kind === "array") {
        if (Array.isArray(positionalValue) && positionalValue.length > 0) {
          const itemSchema = unwrapOptional(field.schema.item);

          if (itemSchema.kind === "array" || itemSchema.kind === "object") {
            throw new UserError(`Array parameter "${field.displayPath}" must use scalar items.`);
          }

          value = positionalValue.map((item) =>
            parseScalarValue(String(item), itemSchema as ScalarSchema, field.displayPath)
          );
          source = "positional";
        }
      } else if (typeof positionalValue === "string" && positionalValue.length > 0) {
        value = parseFieldInputValue(positionalValue, field.schema, field.displayPath);
        source = "positional";
      }
    }

    if (
      value === undefined &&
      Object.prototype.hasOwnProperty.call(optionValues, field.commanderOptionAttribute) &&
      hasFieldValue(optionValues[field.commanderOptionAttribute])
    ) {
      value = normalizeCommanderOptionValue(optionValues[field.commanderOptionAttribute]);
      source = "option";
    }

    if (
      value === undefined &&
      field.commanderOptionAttribute === field.optionAttribute &&
      Object.prototype.hasOwnProperty.call(optionValues, field.optionAttribute) &&
      hasFieldValue(optionValues[field.optionAttribute])
    ) {
      value = normalizeCommanderOptionValue(optionValues[field.optionAttribute]);
      source = "option";
    }

    if (
      value === undefined &&
      field.optionFlag === "--verbose" &&
      Object.prototype.hasOwnProperty.call(optionValues, field.optionAttribute) &&
      hasFieldValue(optionValues[field.optionAttribute])
    ) {
      value = normalizeCommanderOptionValue(optionValues[field.optionAttribute]);
      source = "option";
    }

    if (
      value === undefined &&
      Object.prototype.hasOwnProperty.call(presetValues, field.optionAttribute)
    ) {
      value = presetValues[field.optionAttribute];
      source = "preset";
    }

    if (source === "option") {
      const parsed = parseOptionFieldValue(field, value, errors);
      if (!parsed.ok) {
        continue;
      }

      value = parsed.value;
    }

    if (
      value === undefined &&
      field.optional &&
      missingParameterContext !== undefined &&
      field.schema.cli?.resolveMissing !== undefined
    ) {
      const resolution = await field.schema.cli.resolveMissing({
        ...missingParameterContext,
        params: { ...params }
      });
      const choices = resolution?.choices ?? [];

      if (choices.length === 1) {
        value = choices[0]?.value;
        resolvedMissing = true;
        source = "prompt";
      } else if (choices.length > 1) {
        const selected = await select<unknown>(
          withPromptStreams(
            {
              message: resolution?.message ?? field.description ?? fieldPromptLabel(field),
              options: choices.map((choice) => ({
                label: choice.label,
                value: choice.value as unknown
              }))
            },
            promptStreams
          )
        );

        if (isCancel(selected)) {
          throwPromptCancellation();
        }

        value = selected;
        resolvedMissing = true;
        source = "prompt";
      }
    }

    if (resolvedMissing) {
      const validation = validateSchema(field.schema, value);
      if (!validation.ok) {
        errors.push(
          ...validation.issues.map((issue) => ({
            path: field.displayPath,
            message: issue.message
          }))
        );
        continue;
      }
      value = validation.value;
    }

    if (value === undefined && shouldPrompt && !field.optional) {
      value = await promptForField(field, promptStreams);
      source = "prompt";
    }

    if (value === undefined && field.hasDefault) {
      value = field.defaultValue;
      source = "default";
    }

    if (value === undefined) {
      if (field.optional) {
        continue;
      }

      errors.push({
        path: field.displayPath,
        message: `Missing required parameter "${field.displayPath}".`
      });
      continue;
    }

    resolvedFieldValues.set(field.id, value);
    if (source !== undefined && source !== "default") {
      providedFieldIds.add(field.id);
    }

    if (!field.synthetic) {
      setNestedValue(params, field.path, value);
    }
  }

  const dynamicResults =
    dynamicFields.length > 0
      ? parseDynamicValues(dynamicFields, rawArgv, casing, errors)
      : {
          providedFieldIds: new Set<string>(),
          values: new Map<string, unknown>()
        };

  for (const field of dynamicFields) {
    let value = dynamicResults.values.get(field.id);

    if (value === undefined && field.hasDefault) {
      value = field.defaultValue;
    }

    if (value === undefined) {
      if (field.optional || field.variantId !== undefined) {
        continue;
      }

      errors.push({
        path: field.displayPath,
        message: `Missing required parameter "${field.displayPath}".`
      });
      continue;
    }

    setNestedValue(params, field.path, value);
  }

  await enforceVariantConstraints(
    params,
    fields,
    dynamicFields,
    variants,
    resolvedFieldValues,
    dynamicResults.providedFieldIds,
    providedFieldIds,
    shouldPrompt,
    errors
  );

  throwValidationErrors(errors);

  return params;
}

function getResolvedFlags(command: CommanderCommand): ResolvedFlags {
  const flags = command.optsWithGlobals() as ResolvedFlags;
  return flags;
}

async function executeCommand<TServices extends object>(
  state: ExecutionState<TServices>,
  services: TServices,
  requirementOptions: CommandRequirementOptions,
  runtimeFetch: typeof globalThis.fetch,
  runtimeOptions: HumanInLoopRuntimeOptions | undefined,
  runtimeEnv: Record<string, string> | undefined,
  runtimeFs: HandlerFs | undefined,
  outputEmitter: ((entry: string) => void) | undefined,
  promptStreams: PromptStreams,
  diagnosticsOptions: {
    logLevel?: LogLevel;
    logger?: RuntimeLoggerInput;
    verboseControlEnabled: boolean;
  },
  onErrorReportContext?: (context: {
    command: Command<TServices, any, any, any>;
    commandPath: string;
    params?: unknown;
    secrets?: Record<string, string | undefined>;
  }) => void
): Promise<void> {
  const logger = createLogger(outputEmitter);
  const primitives = {
    logger,
    renderTable,
    getTheme,
    note
  };
  const optionValues = state.actionCommand.optsWithGlobals() as Record<string, unknown>;
  const resolvedFlags = optionValues as ResolvedFlags;
  const output = resolveOutput(resolvedFlags);
  const diagnostics = createRuntimeLogger({
    level:
      resolvedFlags.logLevel ??
      (diagnosticsOptions.verboseControlEnabled && resolvedFlags.verbose
        ? "trace"
        : diagnosticsOptions.logLevel),
    logger: diagnosticsOptions.logger ?? writeCLIDiagnosticEvent
  });
  const promptInput = promptStreams.input ?? process.stdin;
  const promptOutput = promptStreams.output ?? process.stdout;
  const stdinTTY = Boolean((promptInput as NodeJS.ReadStream).isTTY);
  const stdoutTTY = Boolean((promptOutput as NodeJS.WriteStream).isTTY);
  const shouldPrompt = !resolvedFlags.yes && stdinTTY;
  const missingParameterContext: CliMissingParameterContext | undefined =
    !resolvedFlags.yes && output === "rich" && stdinTTY && stdoutTTY
      ? {
          commandPath: state.commandPath,
          params: {},
          output,
          stdinTTY,
          stdoutTTY
        }
      : undefined;
  const runtime = await resolveFixtureRuntime(
    state.command,
    services,
    requirementOptions,
    runtimeFetch,
    runtimeEnv,
    runtimeFs
  );
  const preflightContext = {
    ...runtime.services,
    secrets: runtime.secrets,
    fetch: runtime.fetch,
    fs: runtime.fs,
    env: runtime.env,
    diagnostics,
    progress(message: string): void {
      diagnostics.emit({ level: "info", message, category: "progress" });
      logger.info(message);
    }
  };

  let runtimeSecrets: Record<string, string | undefined> | undefined;
  let resolvedParams: unknown;

  try {
    await withOutputFormat(output, async () => {
      await assertCommandRequirements(state.command, preflightContext, runtime.requirementOptions);

      const params = await resolveParams(
        state.fields,
        state.dynamicFields,
        state.variants,
        state.positionalValues,
        optionValues,
        state.rawArgv,
        state.casing,
        state.presetsEnabled ? resolvedFlags.preset : undefined,
        shouldPrompt,
        missingParameterContext,
        promptStreams
      );
      resolvedParams = params;
      runtimeSecrets = runtime.secrets;

      const context = {
        ...preflightContext,
        params
      } as HandlerContext<any, any, TServices>;

      if (state.command.stream !== undefined) {
        const stream = createManagedStream({
          eventSchema: state.command.stream.event,
          onStatus(event) {
            diagnostics.emit({
              level: "info",
              message: event.message ?? event.type,
              category: "runtime"
            });
            if (output === "rich" && event.message !== undefined) {
              logger.info(event.message);
            }
          },
          async create(signal, status) {
            return await state.command.handler({
              ...context,
              signal,
              status,
              async refreshSecrets() {
                return resolveCommandSecrets(state.command, runtimeEnv);
              }
            } as never);
          }
        });
        const interrupt = (): void => {
          void stream.cancel(new UserError("Operation cancelled."));
        };
        process.once("SIGINT", interrupt);
        try {
          for await (const event of stream) {
            if (output === "json") {
              const line = JSON.stringify(event);
              if (outputEmitter === undefined) {
                process.stdout.write(`${line}\n`);
              } else {
                outputEmitter(line);
              }
            } else {
              renderResult(
                state.command,
                event,
                output,
                primitives,
                outputEmitter === undefined
                  ? undefined
                  : (chunk) => outputEmitter(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk)
              );
            }
          }
        } finally {
          process.removeListener("SIGINT", interrupt);
          await stream.cancel();
        }
        return;
      }

      if (
        state.command.confirm &&
        !state.command.humanInLoop &&
        !resolvedFlags.yes &&
        process.stdin.isTTY
      ) {
        for (const field of state.fields) {
          const value = field.path.reduce<unknown>(
            (current, segment) =>
              current && typeof current === "object"
                ? (current as Record<string, unknown>)[segment]
                : undefined,
            params
          );

          if (value !== undefined) {
            logger.resolved(field.displayPath, formatResolvedValue(value));
          }
        }

        const proceed = await confirm({
          message: "Proceed?",
          initialValue: true
        });

        if (isCancel(proceed)) {
          cancel("Operation cancelled.");
          throw new UserError("Operation cancelled.");
        }

        if (proceed !== true) {
          throw new UserError("Operation cancelled.");
        }
      }

      const result = state.command.humanInLoop
        ? await (
            await importOptionalModule<typeof import("./human-in-loop/gate.js")>(
              optionalModulePaths.humanInLoop
            )
          ).invokeWithHumanInLoop(state.command, context, runtimeOptions, state.commandPath)
        : await state.command.handler(context);

      if (output === "rich" && runtime.isFixture) {
        writeRichHeader(`${state.command.name} (fixture)`);
      }

      if (isHumanInLoopPending(result)) {
        renderHumanInLoopPending(result);
        return;
      }

      const renderStatus = renderResult(
        state.command,
        result,
        output,
        primitives,
        outputEmitter === undefined
          ? undefined
          : (chunk) => outputEmitter(chunk.endsWith("\n") ? chunk.slice(0, -1) : chunk)
      );
      if (renderStatus.mcpError) {
        process.exitCode = 1;
      }
    });
  } catch (error) {
    onErrorReportContext?.({
      command: state.command,
      commandPath: state.commandPath,
      params: resolvedParams,
      secrets: runtimeSecrets ?? runtime.secrets
    });
    throw error;
  }
}

type HttpErrorLike = {
  name: string;
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
};

type ProblemDetailsLike = {
  type?: string;
  title?: string;
  status?: number;
  detail?: string;
  instance?: string;
};

type GraphQLErrorEnvelopeLike = {
  errors: Array<{
    message: string;
    path?: Array<string | number>;
    extensions?: {
      code?: string;
    };
  }>;
};

function isStringRecord(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function isHttpErrorLike(error: unknown): error is HttpErrorLike {
  if (!isPlainObject(error)) {
    return false;
  }

  if (typeof error.name !== "string" || typeof error.message !== "string") {
    return false;
  }

  const request = error.request;
  const response = error.response;

  return (
    isPlainObject(request) &&
    typeof request.method === "string" &&
    typeof request.url === "string" &&
    isStringRecord(request.headers) &&
    isPlainObject(response) &&
    typeof response.status === "number" &&
    typeof response.statusText === "string" &&
    isStringRecord(response.headers) &&
    hasOwnProperty(response, "body")
  );
}

function hasTypedOptionalField(
  value: Record<string, unknown>,
  field: string,
  type: "number" | "string"
): boolean {
  return !hasOwnProperty(value, field) || typeof value[field] === type;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isProblemDetailsLike(body: unknown): body is ProblemDetailsLike {
  if (!isPlainObject(body)) {
    return false;
  }

  if (!hasTypedOptionalField(body, "type", "string")) {
    return false;
  }

  if (!hasTypedOptionalField(body, "title", "string")) {
    return false;
  }

  if (!hasTypedOptionalField(body, "status", "number")) {
    return false;
  }

  if (!hasTypedOptionalField(body, "detail", "string")) {
    return false;
  }

  if (!hasTypedOptionalField(body, "instance", "string")) {
    return false;
  }

  return hasOwnNonEmptyString(body, "title") || hasOwnNonEmptyString(body, "detail");
}

function isGraphQLErrorEnvelopeLike(body: unknown): body is GraphQLErrorEnvelopeLike {
  if (!isPlainObject(body) || !Array.isArray(body.errors) || body.errors.length === 0) {
    return false;
  }

  return body.errors.every((error) => {
    if (!isPlainObject(error) || typeof error.message !== "string") {
      return false;
    }

    if (hasOwnProperty(error, "path")) {
      const pathValue = error.path;
      if (
        !Array.isArray(pathValue) ||
        !pathValue.every((entry) => typeof entry === "string" || typeof entry === "number")
      ) {
        return false;
      }
    }

    if (hasOwnProperty(error, "extensions")) {
      if (!isPlainObject(error.extensions)) {
        return false;
      }

      if (hasOwnProperty(error.extensions, "code") && typeof error.extensions.code !== "string") {
        return false;
      }
    }

    return true;
  });
}

function hasOwnProperty<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, unknown> {
  return Object.prototype.hasOwnProperty.call(value, name);
}

function hasOwnNonEmptyString<Name extends PropertyKey>(
  value: object,
  name: Name
): value is Record<Name, string> {
  return hasOwnProperty(value, name) && isNonEmptyString(value[name]);
}

function styleHttpErrorLine(value: string, style: (line: string) => string): string {
  return process.stdout.isTTY !== true ? value : style(value);
}

function formatHttpErrorStatus(value: string): string {
  return styleHttpErrorLine(value, text.error);
}

function formatProblemDetailsBody(body: ProblemDetailsLike): string {
  const lines: string[] = [];

  if (hasOwnNonEmptyString(body, "title")) {
    lines.push(`Problem: ${body.title}`);
  }

  if (hasOwnNonEmptyString(body, "detail")) {
    lines.push(`Detail:  ${body.detail}`);
  }

  if (hasOwnProperty(body, "type") && body.type !== undefined) {
    lines.push(`Type:    ${body.type}`);
  }

  if (hasOwnProperty(body, "instance") && body.instance !== undefined) {
    lines.push(`Instance: ${body.instance}`);
  }

  if (hasOwnProperty(body, "status") && body.status !== undefined) {
    lines.push(`Status:  ${body.status}`);
  }

  return lines.join("\n");
}

function formatGraphQLErrorEnvelopeBody(body: GraphQLErrorEnvelopeLike): string {
  return body.errors
    .map((error) => {
      const lines = [`GraphQL error: ${error.message}`];

      if (hasOwnProperty(error, "path") && error.path !== undefined) {
        lines.push(`  at path: ${error.path.join(".")}`);
      }

      if (
        hasOwnProperty(error, "extensions") &&
        error.extensions !== undefined &&
        hasOwnProperty(error.extensions, "code") &&
        error.extensions.code !== undefined
      ) {
        lines.push(`  code:    ${error.extensions.code}`);
      }

      return lines.join("\n");
    })
    .join("\n\n");
}

function formatHttpErrorBody(body: unknown): string {
  const redactedBody = redactHttpBody(body);

  if (typeof redactedBody === "string") {
    return redactedBody;
  }

  if (isProblemDetailsLike(redactedBody)) {
    return formatProblemDetailsBody(redactedBody);
  }

  if (isGraphQLErrorEnvelopeLike(redactedBody)) {
    return formatGraphQLErrorEnvelopeBody(redactedBody);
  }

  const serialized = JSON.stringify(redactedBody, null, 2);
  return serialized === undefined ? String(redactedBody) : serialized;
}

function indentHttpErrorBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function formatHttpHeaderValue(name: string, value: string): string {
  return redactHttpHeaderValue(name, value);
}

function formatHttpErrorHeaders(headers: Record<string, string>): string[] {
  return Object.entries(headers).map(
    ([name, value]) => `  ${name}: ${formatHttpHeaderValue(name, value)}`
  );
}

function formatHttpErrorSnippet(body: unknown): string {
  return formatHttpErrorBody(body).replace(/\s+/g, " ").trim().slice(0, 200);
}

function renderHttpError(
  error: HttpErrorLike,
  options: { debugStackMode: DebugStackMode | undefined; verbose: boolean }
): void {
  const detailed = options.verbose || options.debugStackMode !== undefined;
  const summary = summarizeHttpError(error);
  const lines: string[] = [
    styleHttpErrorLine(`Request:  ${error.request.method} ${error.request.url}`, text.muted)
  ];

  if (detailed) {
    lines.push("", "Request headers:", ...formatHttpErrorHeaders(error.request.headers), "");

    if (error.request.body !== undefined) {
      lines.push(
        "Request body:",
        indentHttpErrorBlock(formatHttpErrorBody(error.request.body)),
        ""
      );
    }
  }

  lines.push(
    formatHttpErrorStatus(`Status:   ${error.response.status} ${error.response.statusText}`)
  );

  if (detailed) {
    lines.push(
      "",
      "Response headers:",
      ...formatHttpErrorHeaders(error.response.headers),
      "",
      "Response body:",
      indentHttpErrorBlock(formatHttpErrorBody(error.response.body))
    );
  } else {
    const summaryLines = [
      summary.code === undefined ? undefined : `Code:     ${summary.code}`,
      summary.message === undefined ? undefined : `Message:  ${summary.message}`,
      summary.requestId === undefined ? undefined : `Request id: ${summary.requestId}`,
      summary.retryAfter === undefined ? undefined : `Retry after: ${summary.retryAfter}`,
      summary.hint === undefined ? undefined : `Hint:     ${summary.hint}`
    ].filter((line): line is string => line !== undefined);

    if (summary.fieldErrors !== undefined && summary.fieldErrors.length > 0) {
      summaryLines.push(
        "",
        "Field errors:",
        ...summary.fieldErrors.map((fieldError) => `  ${fieldError.path}: ${fieldError.message}`)
      );
    }

    lines.push("");
    if (summaryLines.length > 0) {
      lines.push(...summaryLines);
    } else {
      lines.push(`Response body: ${formatHttpErrorSnippet(error.response.body)}`);
    }
    lines.push("Re-run with --verbose to see headers and full body.");
  }

  process.stderr.write(`${lines.join("\n")}\n`);

  const stack = error instanceof Error ? (error as Error).stack : undefined;
  if (options.debugStackMode !== undefined && stack) {
    process.stderr.write(`${formatDebugStack(stack, options.debugStackMode)}\n`);
  }
}

async function handleRunError(
  error: unknown,
  options: {
    debugStackMode: DebugStackMode | undefined;
    output: OutputMode;
    verbose: boolean;
    program?: CommanderCommand;
    argv?: readonly string[];
    rootUsageName: string;
    commandPath: string;
    outputEmitter?: (entry: string) => void;
    userErrorPattern: "definition" | "runtime-user" | "usage";
  }
): Promise<void> {
  const logger = createLogger(options.outputEmitter);

  await withOutputFormat(options.output, async () => {
    if (error instanceof UserError) {
      renderCliErrorPattern(
        options.userErrorPattern === "definition"
          ? {
              kind: "definition",
              error,
              debugStackMode: options.debugStackMode
            }
          : options.userErrorPattern === "usage"
            ? {
                kind: "usage",
                message: error.message,
                rootUsageName: options.rootUsageName,
                commandPath: options.commandPath
              }
            : {
                kind: "runtime-user",
                message: error.message
              },
        options.outputEmitter
      );
      return;
    }

    if (error instanceof Error && error.name === "ToolcraftBugError") {
      renderCliErrorPattern(
        {
          kind: "toolcraft-bug",
          error,
          debugStackMode: options.debugStackMode
        },
        options.outputEmitter
      );
      return;
    }

    if (error instanceof CommanderError) {
      process.exitCode = error.exitCode;
      if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
        return;
      }
      if (error.code === "commander.unknownCommand") {
        logger.error(
          appendUsagePointer(
            formatUnknownCommandError(error, options.program, options.argv ?? process.argv),
            {
              rootUsageName: options.rootUsageName,
              commandPath: options.commandPath
            }
          )
        );
        return;
      }
      if (error.code === "commander.unknownOption") {
        const argv = options.argv ?? process.argv;
        logger.error(
          appendUsagePointer(formatUnknownOptionError(error, options.program, argv), {
            rootUsageName: options.rootUsageName,
            commandPath:
              options.commandPath.length > 0
                ? options.commandPath
                : findCurrentCommanderCommandPath(options.program, argv)
          })
        );
        return;
      }
      logger.error(
        appendUsagePointer(formatCommanderErrorMessage(error), {
          rootUsageName: options.rootUsageName,
          commandPath:
            options.commandPath.length > 0
              ? options.commandPath
              : findCurrentCommanderCommandPath(options.program, options.argv ?? process.argv)
        })
      );
      return;
    }

    if (isHttpErrorLike(error)) {
      renderHttpError(error, options);
      process.exitCode = 1;
      return;
    }

    const message = error instanceof Error ? error.message : String(error);
    renderCliErrorPattern(
      {
        kind: "unexpected",
        message,
        stack: error instanceof Error ? error.stack : undefined,
        debugStackMode: options.debugStackMode
      },
      options.outputEmitter
    );
  });
}

function formatCommanderErrorMessage(error: CommanderError): string {
  return error.message.startsWith("error:") ? error.message : `error: ${error.message}`;
}

function formatInvalidEnumMessage(
  label: string,
  value: string,
  values: ReadonlyArray<string | number | boolean>,
  opts: { candidates?: readonly string[]; threshold?: number } = {}
): string {
  const suggestions = suggest(
    value,
    opts.candidates ?? values.map((candidate) => String(candidate)),
    opts
  );
  const suggestionLine =
    suggestions.length > 0 ? ` Did you mean: ${suggestions.join(", ")}?\n` : " ";
  return `Invalid value for "${label}".${suggestionLine}Expected one of: ${values.map((candidate) => String(candidate)).join(", ")}, got ${describeReceived(value)}.`;
}

function formatUnknownCommandError(
  error: CommanderError,
  program: CommanderCommand | undefined,
  argv: readonly string[]
): string {
  const input = extractQuotedCommanderValue(error.message) ?? "";
  const currentCommand =
    program === undefined ? undefined : findCurrentCommanderCommand(program, argv);
  return formatUnknownCommandMessage(input, currentCommand);
}

function appendUsagePointer(
  message: string,
  options: {
    rootUsageName: string;
    commandPath: string;
  }
): string {
  if (message.includes("--help")) {
    return message;
  }

  const helpTarget =
    options.commandPath.length === 0
      ? options.rootUsageName
      : `${options.rootUsageName} ${options.commandPath}`;
  return `${message}\nRun ${helpTarget} --help for usage.`;
}

function formatCliCommandPath(commandPath: string): string {
  return commandPath
    .split(".")
    .filter((segment) => segment.length > 0)
    .join(" ");
}

function formatUnknownCommandMessage(
  input: string,
  currentCommand: CommanderCommand | undefined
): string {
  const suggestions =
    currentCommand === undefined
      ? []
      : suggest(
          input,
          currentCommand.commands.map((command) => command.name())
        );
  return formatSuggestionMessage(`Unknown command "${input}".`, suggestions);
}

function formatUnknownOptionError(
  error: CommanderError,
  program: CommanderCommand | undefined,
  argv: readonly string[]
): string {
  const input = extractQuotedCommanderValue(error.message) ?? "";
  const currentCommand =
    program === undefined ? undefined : findCurrentCommanderCommand(program, argv);
  const suggestions =
    currentCommand === undefined
      ? []
      : suggest(
          input,
          currentCommand.options
            .map((option) => option.long)
            .filter((flag): flag is string => flag !== undefined)
        );
  return formatSuggestionMessage(`Unknown option "${input}".`, suggestions);
}

function formatSuggestionMessage(message: string, suggestions: readonly string[]): string {
  if (suggestions.length === 0) {
    return message;
  }

  return `${message}\nDid you mean: ${suggestions.join(", ")}?`;
}

function extractQuotedCommanderValue(message: string): string | undefined {
  const singleQuoted = extractBetweenQuotes(message, "'");
  if (singleQuoted !== undefined) {
    return singleQuoted;
  }

  return extractBetweenQuotes(message, '"');
}

function extractBetweenQuotes(message: string, quote: "'" | '"'): string | undefined {
  const start = message.indexOf(quote);
  if (start === -1) {
    return undefined;
  }

  const end = message.indexOf(quote, start + 1);
  if (end === -1) {
    return undefined;
  }

  return message.slice(start + 1, end);
}

function resolveDebugStackMode(value: unknown): DebugStackMode | undefined {
  if (value === true || value === "trim") {
    return "trim";
  }

  if (value === "raw") {
    return "raw";
  }

  return undefined;
}

function getDebugStackModeFromArgv(argv: readonly string[]): DebugStackMode | undefined {
  for (let index = 2; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === undefined) {
      continue;
    }

    if (token === "--debug") {
      return "trim";
    }

    if (token === "--debug=raw") {
      return "raw";
    }
  }

  return undefined;
}

function findCurrentCommanderCommand(
  program: CommanderCommand,
  argv: readonly string[]
): CommanderCommand {
  let current = program;
  const tokens = argv.slice(2);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token === "--") {
      break;
    }
    if (token.startsWith("-")) {
      const option = current.options.find(
        (candidate) => candidate.long === token || candidate.short === token
      );
      if (option?.required === true && !token.includes("=")) {
        index += 1;
      }
      continue;
    }

    const child = current.commands.find(
      (command) => command.name() === token || command.aliases().includes(token)
    );
    if (child === undefined) {
      break;
    }

    current = child;
  }

  return current;
}

function findCurrentCommanderCommandPath(
  program: CommanderCommand | undefined,
  argv: readonly string[]
): string {
  if (program === undefined) {
    return "";
  }

  let current = program;
  const pathSegments: string[] = [];
  const tokens = argv.slice(2);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token === "--" || token.startsWith("-")) {
      break;
    }

    const child = current.commands.find(
      (command) => command.name() === token || command.aliases().includes(token)
    );
    if (child === undefined) {
      break;
    }

    current = child;
    pathSegments.push(child.name());
  }

  return pathSegments.join(" ");
}

function findUnknownCommanderCommand(
  program: CommanderCommand,
  argv: readonly string[]
): { input: string; currentCommand: CommanderCommand; commandPath: string } | undefined {
  let current = program;
  const pathSegments: string[] = [];
  const tokens = argv.slice(2);

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === undefined || token === "--") {
      return undefined;
    }
    if (token.startsWith("-")) {
      const option = current.options.find(
        (candidate) => candidate.long === token || candidate.short === token
      );
      if (option?.required === true && !token.includes("=")) {
        index += 1;
      }
      continue;
    }

    if (
      getToolcraftHiddenDefaultNames(current).includes(token) ||
      getToolcraftReservedChildNames(current).includes(token)
    ) {
      return {
        input: token,
        currentCommand: current,
        commandPath: pathSegments.join(" ")
      };
    }

    if (current.commands.length === 0) {
      return undefined;
    }

    const child = current.commands.find(
      (command) => command.name() === token || command.aliases().includes(token)
    );
    if (child === undefined) {
      if (getDefaultCommanderCommandName(current) !== undefined) {
        if (shouldRejectDefaultCommandToken(current, token, pathSegments)) {
          return {
            input: token,
            currentCommand: current,
            commandPath: pathSegments.join(" ")
          };
        }

        return undefined;
      }

      return {
        input: token,
        currentCommand: current,
        commandPath: pathSegments.join(" ")
      };
    }

    current = child;
    pathSegments.push(child.name());
  }

  return undefined;
}

function shouldRejectDefaultCommandToken(
  command: CommanderCommand,
  token: string,
  pathSegments: readonly string[]
): boolean {
  return (
    pathSegments.length === 0 &&
    isBareCommandLikeToken(token) &&
    hasNonDefaultPublicChildCommand(command)
  );
}

function hasNonDefaultPublicChildCommand(command: CommanderCommand): boolean {
  const defaultName = getDefaultCommanderCommandName(command);
  return command.commands.some(
    (child) =>
      child.name() !== defaultName &&
      !isToolcraftHiddenCommander(child) &&
      !getToolcraftReservedChildNames(command).includes(child.name())
  );
}

function isBareCommandLikeToken(token: string): boolean {
  if (token.length === 0) {
    return false;
  }

  for (const character of token) {
    if (!isCommandNameCharacter(character)) {
      return false;
    }
  }

  return true;
}

function isCommandNameCharacter(character: string): boolean {
  const code = character.codePointAt(0);
  if (code === undefined) {
    return false;
  }

  const isLowercaseLetter = code >= 97 && code <= 122;
  const isUppercaseLetter = code >= 65 && code <= 90;
  const isDigit = code >= 48 && code <= 57;
  return (
    isLowercaseLetter || isUppercaseLetter || isDigit || character === "-" || character === "_"
  );
}

function getDefaultCommanderCommandName(command: CommanderCommand): string | undefined {
  const candidate = command as CommanderCommand & { _defaultCommandName?: unknown };
  return typeof candidate._defaultCommandName === "string"
    ? candidate._defaultCommandName
    : undefined;
}

function configureCommanderSuggestionOutput(command: CommanderCommand): void {
  command.exitOverride();
  command.configureOutput({
    outputError: (message, write) => {
      if (message.includes("unknown command") || message.includes("unknown option")) {
        return;
      }

      write(message);
    }
  });

  command.commands.forEach((child) => configureCommanderSuggestionOutput(child));
}

export async function runCLI<TServices extends object = Record<string, unknown>>(
  roots: Group<TServices> | Group<TServices>[],
  options: RunCLIOptions<TServices> = {}
): Promise<void> {
  enableSourceMaps();
  const controls = resolveCLIControls(options.controls);
  const argv = controls.verbose
    ? normalizeVerboseAlias([...(options.argv ?? process.argv)])
    : [...(options.argv ?? process.argv)];
  const rootUsageName = options.rootUsageName ?? inferProgramName(argv);
  let lastActionCommand: CommanderCommand | undefined;
  let resolvedCommandPath = "";
  let program: CommanderCommand | undefined;
  let version: string | undefined;
  let userErrorPattern: "definition" | "runtime-user" | "usage" = "definition";
  let errorReportContext:
    | {
        command: Command<TServices, any, any, any>;
        commandPath: string;
        params?: unknown;
        secrets?: Record<string, string | undefined>;
      }
    | undefined;

  try {
    const normalizedRoot = normalizeRoots(roots, argv);
    const root =
      options.approvals === true
        ? (
            await importOptionalModule<typeof import("./human-in-loop/approvals-commands.js")>(
              optionalModulePaths.approvals
            )
          ).mergeApprovalsGroup(normalizedRoot)
        : normalizedRoot;
    if (hasMcpProxyConfig(root)) {
      await (
        await importOptionalModule<typeof import("./mcp-proxy.js")>(optionalModulePaths.mcpProxy)
      ).resolveMcpProxies(root, { projectRoot: options.projectRoot });
    }
    const casing = options.casing ?? "kebab";
    const services = (options.services ?? {}) as TServices;
    const runtimeOptions = options.humanInLoop ?? {};
    const runtimeFetch = options.fetch ?? globalThis.fetch;
    version = options.version ?? findEntrypointPackageMetadata(argv[1])?.version;
    const servicesWithBuiltIns = {
      ...services,
      runtimeOptions,
      root
    } as TServices;
    const requirementOptions = {
      apiVersion: options.apiVersion,
      env: options.env
    } satisfies CommandRequirementOptions;

    validateServices(services as Record<string, unknown>);

    if (hasHelpFlag(argv)) {
      userErrorPattern = "usage";
      await renderGeneratedHelp(root, argv, { ...options, version });
      return;
    }

    if (argv.length <= 2 && root.default?.scope.includes("cli") !== true) {
      userErrorPattern = "usage";
      await renderGeneratedHelp(root, argv, { ...options, version });
      return;
    }

    program = new CommanderCommand();
    program.name(root.name);
    program.exitOverride();
    program.showHelpAfterError();
    program.addHelpCommand(false);
    const presetsEnabled = options.presets === true;
    const globalLongOptionFlags = getGlobalLongOptionFlags(
      presetsEnabled,
      version !== undefined,
      controls
    );
    addGlobalOptions(program, presetsEnabled, controls);

    if (version !== undefined) {
      program.version(version, "--version");
    }
    Reflect.set(
      program,
      "_toolcraftReservedChildNames",
      root.children
        .filter((child) => !isNodeVisibleInScope(child, "cli"))
        .flatMap((child) => getNodeCommandNames(child))
    );

    const execute = async (state: ExecutionState<TServices>) => {
      lastActionCommand = state.actionCommand;
      resolvedCommandPath = formatCliCommandPath(state.commandPath);
      await executeCommand(
        state,
        servicesWithBuiltIns,
        requirementOptions,
        runtimeFetch,
        runtimeOptions,
        options.env,
        options.fs,
        options.outputEmitter,
        {
          input: options.promptInput,
          output: options.promptOutput
        },
        {
          logLevel: options.logLevel,
          logger: options.logger,
          verboseControlEnabled: controls.verbose
        },
        (context) => {
          errorReportContext = context;
        }
      );
    };

    const rootChildNames = new Set(
      root.children
        .filter((candidate) => isNodeVisibleInScope(candidate, "cli"))
        .map((candidate) => candidate.name)
    );
    for (const child of root.children) {
      const command = createNodeCommand(
        child,
        casing,
        globalLongOptionFlags,
        execute,
        presetsEnabled,
        controls
      );
      if (command === null) {
        continue;
      }

      const isDefaultChild =
        root.default !== undefined &&
        root.default.scope.includes("cli") &&
        (command.name() === root.default.name || command.aliases().includes(root.default.name));

      addCommanderChild(program, command, isDefaultChild, rootChildNames);
    }
    configureCommanderSuggestionOutput(program);

    const unknownCommand = findUnknownCommanderCommand(program, argv);
    if (unknownCommand !== undefined) {
      createLogger().error(
        appendUsagePointer(
          formatUnknownCommandMessage(unknownCommand.input, unknownCommand.currentCommand),
          {
            rootUsageName,
            commandPath: unknownCommand.commandPath
          }
        )
      );
      process.exitCode = 1;
      return;
    }

    userErrorPattern = "usage";
    await program.parseAsync(argv);
  } catch (error) {
    if (error instanceof ApprovalDeclinedError) {
      renderApprovalDeclined(error);
      return;
    }

    const resolvedFlags = lastActionCommand ? getResolvedFlags(lastActionCommand) : undefined;
    const report = await writeErrorReport({
      argv,
      command: errorReportContext?.command,
      commandPath: errorReportContext?.commandPath ?? resolvedCommandPath,
      env: process.env,
      error,
      errorReports: options.errorReports,
      params: errorReportContext?.params,
      projectRoot: options.projectRoot,
      secrets: errorReportContext?.secrets,
      version
    });

    if (report !== undefined) {
      process.stderr.write(`Saved error report to ${report.displayPath}\n`);
    }

    await handleRunError(error, {
      debugStackMode:
        resolvedFlags !== undefined
          ? resolveDebugStackMode(resolvedFlags.debug)
          : getDebugStackModeFromArgv(argv),
      output:
        resolvedFlags !== undefined ? resolveOutput(resolvedFlags) : resolveOutputFromArgv(argv),
      verbose: resolvedFlags ? Boolean(resolvedFlags.verbose) : argv.includes("--verbose"),
      program,
      argv,
      rootUsageName,
      commandPath: resolvedCommandPath,
      outputEmitter: options.outputEmitter,
      userErrorPattern: errorReportContext?.params === undefined ? userErrorPattern : "runtime-user"
    });
  }
}
