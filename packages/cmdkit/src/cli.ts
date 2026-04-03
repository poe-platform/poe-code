import { access, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { Command as CommanderCommand, CommanderError, InvalidArgumentError, Option } from "commander";
import {
  cancel,
  confirm,
  createLogger,
  formatCommandList,
  formatOptionList,
  getTheme,
  isCancel,
  promptText,
  renderTable,
  resetOutputFormatCache,
  select,
  text,
} from "@poe-code/design-system";
import type {
  AnySchema,
  ArraySchema,
  Command,
  CommandRequirementOptions,
  Group,
  HandlerContext,
  HandlerEnv,
  HandlerFs,
  ObjectSchema,
  SecretDeclarations,
  SecretDefinition,
  Scope,
} from "./index.js";
import { UserError, assertCommandRequirements, getCommandSourcePath, resolveCommandSecrets } from "./index.js";
import { renderResult } from "./renderer.js";
import type { OutputMode } from "./renderer.js";

const RESERVED_SERVICE_NAMES = new Set(["params", "secrets", "fetch", "fs", "env", "progress"]);

type Casing = "kebab" | "snake";
type PrimitiveSchema = Exclude<AnySchema, ObjectSchema<any>>;
type ScalarSchema = Exclude<PrimitiveSchema, ArraySchema<any>>;
type FieldSchema = Exclude<PrimitiveSchema, { kind: "optional" }>;

interface GlobalFlags {
  yes?: boolean;
  output?: OutputMode;
  verbose?: boolean;
}

interface FieldDefinition {
  path: string[];
  displayPath: string;
  optionAttribute: string;
  optionFlag: string;
  schema: FieldSchema;
  description?: string;
  optional: boolean;
  hasDefault: boolean;
  defaultValue: unknown;
  positionalIndex?: number;
}

interface ExecutionState<TServices extends object> {
  command: Command<TServices, any, any, any>;
  fields: FieldDefinition[];
  positionalValues: string[];
  actionCommand: CommanderCommand;
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

export interface RunCLIOptions<TServices extends object = Record<string, unknown>> {
  apiVersion?: string;
  casing?: Casing;
  services?: TServices;
  version?: string;
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
    const previousIsLowercase = previous !== undefined && previous === previous.toLowerCase() && previous !== previous.toUpperCase();
    const nextIsLowercase = next !== undefined && next === next.toLowerCase() && next !== next.toUpperCase();

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

function collectFields(
  schema: ObjectSchema<any>,
  casing: Casing,
  path: string[] = [],
  inheritedOptional = false
): FieldDefinition[] {
  const fields: FieldDefinition[] = [];

  for (const [key, rawChildSchema] of Object.entries(schema.shape) as Array<[string, AnySchema]>) {
    const nextPath = [...path, key];
    const optional = inheritedOptional || rawChildSchema.kind === "optional";
    const childSchema = unwrapOptional(rawChildSchema);

    if (childSchema.kind === "object") {
      fields.push(...collectFields(childSchema, casing, nextPath, optional));
      continue;
    }

    fields.push({
      path: nextPath,
      displayPath: toDisplayPath(nextPath),
      optionAttribute: toOptionAttribute(nextPath, casing),
      optionFlag: toOptionFlag(nextPath, casing),
      schema: childSchema as FieldSchema,
      description: childSchema.description,
      optional,
      hasDefault: childSchema.default !== undefined,
      defaultValue: childSchema.default,
    });
  }

  return fields;
}

function assignPositionals(fields: FieldDefinition[], positional: string[]): FieldDefinition[] {
  if (positional.length === 0) {
    return fields;
  }

  const byPath = new Map(fields.map((field) => [field.displayPath, field]));

  positional.forEach((name, index) => {
    const field = byPath.get(name);

    if (field === undefined) {
      throw new UserError(`Positional parameter "${name}" does not exist in params.`);
    }

    if (field.schema.kind === "array") {
      throw new UserError(`Positional parameter "${name}" cannot be an array.`);
    }

    field.positionalIndex = index;
  });

  return fields;
}

function parseBooleanText(value: string, label: string): boolean {
  const normalized = value.trim().toLowerCase();

  if (normalized === "true") {
    return true;
  }

  if (normalized === "false") {
    return false;
  }

  throw new InvalidArgumentError(`Invalid value for "${label}". Expected true or false.`);
}

function parseEnumValue(value: string, values: ReadonlyArray<string | number | boolean>, label: string): string | number | boolean {
  const match = values.find((candidate) => String(candidate) === value);

  if (match === undefined) {
    throw new InvalidArgumentError(
      `Invalid value for "${label}". Expected one of: ${values.map((candidate) => String(candidate)).join(", ")}.`
    );
  }

  return match;
}

function parseScalarValue(value: string, schema: ScalarSchema, label: string): string | number | boolean {
  switch (schema.kind) {
    case "string":
      return value;

    case "number": {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        throw new InvalidArgumentError(`Invalid value for "${label}". Expected a number.`);
      }
      return parsed;
    }

    case "boolean":
      return parseBooleanText(value, label);

    case "enum":
      return parseEnumValue(value, schema.values, label);

    default:
      throw new UserError(`Unsupported CLI schema kind "${schema.kind}".`);
  }
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
  const itemSchema = unwrapOptional(schema.item);

  if (itemSchema.kind === "array" || itemSchema.kind === "object") {
    throw new UserError(`Array parameter "${label}" must use scalar items.`);
  }

  return splitArrayInput(value).map((item) => parseScalarValue(item, itemSchema as ScalarSchema, label));
}

function createOption(field: FieldDefinition): Option[] {
  if (field.schema.kind === "boolean") {
    return [
      new Option(field.optionFlag, field.description),
      new Option(`--no-${field.optionFlag.slice(2)}`, field.description),
    ];
  }

  if (field.schema.kind === "array") {
    return [
      new Option(`${field.optionFlag} <value...>`, field.description).argParser(
        (value: string, previous: unknown[] = []) => [
          ...previous,
          ...parseArrayValue(value, field.schema as ArraySchema<any>, field.displayPath),
        ]
      ),
    ];
  }

  const option = new Option(`${field.optionFlag} <value>`, field.description);

  if (field.schema.kind === "enum" && field.schema.values.every((value) => typeof value === "string")) {
    option.choices([...field.schema.values] as string[]);
  }

  option.argParser((value: string) => parseScalarValue(value, field.schema as ScalarSchema, field.displayPath));
  return [option];
}

function hasHelpFlag(argv: string[]): boolean {
  return argv.some((token) => HELP_FLAGS.has(token));
}

function resolveHelpOutput(argv: string[]): OutputMode {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index] ?? "";

    if (token === "--output") {
      const value = argv[index + 1];
      if (value === "rich" || value === "md" || value === "json") {
        return value;
      }
      continue;
    }

    if (token.startsWith("--output=")) {
      const value = token.slice("--output=".length);
      if (value === "rich" || value === "md" || value === "json") {
        return value;
      }
    }
  }

  return process.stdout.isTTY ? "rich" : "json";
}

function isNodeVisibleInScope<TServices extends object>(
  node: Command<TServices, any, any, any> | Group<TServices>,
  scope: Scope
): boolean {
  if (node.kind === "command") {
    return node.scope.includes(scope);
  }

  return getVisibleChildren(node, scope).length > 0 || Boolean(node.default && node.default.scope.includes(scope));
}

function getVisibleChildren<TServices extends object>(group: Group<TServices>, scope: Scope): Array<Command<TServices, any, any, any> | Group<TServices>> {
  return group.children.filter((child) => isNodeVisibleInScope(child, scope));
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
  scope: Scope
): ResolvedHelpTarget<TServices> {
  const breadcrumb = [root.name];
  let current: Command<TServices, any, any, any> | Group<TServices> = root;

  for (const token of argv.slice(2)) {
    if (token.startsWith("-") || token === "help") {
      break;
    }

    if (current.kind !== "group") {
      break;
    }

    const child: Command<TServices, any, any, any> | Group<TServices> | undefined = findVisibleChild(
      current,
      token,
      scope
    );
    if (child === undefined) {
      break;
    }

    breadcrumb.push(child.name);
    current = child;
  }

  return {
    breadcrumb,
    node: current,
  };
}

function describeSchemaType(schema: FieldSchema): string {
  switch (schema.kind) {
    case "string":
      return "string";

    case "number":
      return "number";

    case "boolean":
      return "boolean";

    case "enum":
      return "value";

    case "array":
      return `${describeSchemaType(unwrapOptional(schema.item) as FieldSchema)}...`;

    default:
      throw new UserError("Unsupported CLI schema kind.");
  }
}

function formatHelpFieldFlags(field: FieldDefinition): string {
  if (field.positionalIndex !== undefined) {
    return `<${field.displayPath}>`;
  }

  if (field.schema.kind === "boolean") {
    return field.optionFlag;
  }

  return `${field.optionFlag} <${describeSchemaType(field.schema)}>`;
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

  if (!field.optional && !field.hasDefault) {
    metadata.push("required");
  }

  if (field.hasDefault) {
    metadata.push(`default: ${formatResolvedValue(field.defaultValue)}`);
  }

  return appendHelpMetadata(description, metadata);
}

function formatSecretRows(secrets: SecretDeclarations): HelpOptionRow[] {
  return Object.values(secrets).map((secret) => ({
    flags: secret.env,
    description: formatSecretDescription(secret),
  }));
}

function formatSecretDescription(secret: SecretDefinition): string {
  if (secret.description !== undefined && secret.description.length > 0) {
    return secret.description;
  }

  return secret.optional === true ? "Optional secret" : "Required secret";
}

function formatCommandRows<TServices extends object>(group: Group<TServices>, scope: Scope): HelpCommandRow[] {
  return getVisibleChildren(group, scope).map((child) => ({
    name: child.aliases.length === 0 ? child.name : `${child.name} (${child.aliases.join(", ")})`,
    description: child.description ?? "",
  }));
}

function formatGlobalOptionRows(showVersion: boolean): HelpOptionRow[] {
  const rows: HelpOptionRow[] = [
    {
      flags: "--yes",
      description: "Accept defaults, skip prompts",
    },
    {
      flags: "--output",
      description: "Output format (rich, md, json)",
    },
    {
      flags: "--help",
      description: "Show help",
    },
  ];

  if (showVersion) {
    rows.push({
      flags: "--version",
      description: "Show version",
    });
  }

  return rows;
}

function renderHelpSections(sections: string[]): string {
  return sections.filter((section) => section.length > 0).join("\n\n");
}

function renderGroupHelp<TServices extends object>(
  group: Group<TServices>,
  breadcrumb: string[],
  scope: Scope,
  showVersion: boolean
): string {
  const sections: string[] = [];
  const commandRows = formatCommandRows(group, scope);

  if (commandRows.length > 0) {
    sections.push(`${text.section("Commands:")}\n${formatCommandList(commandRows)}`);
  }

  sections.push(`${text.section("Global options:")}\n${formatOptionList(formatGlobalOptionRows(showVersion))}`);

  return renderHelpDocument({
    breadcrumb,
    description: group.description,
    requiresAuth: group.requires?.auth === true,
    sections,
  });
}

function renderLeafHelp<TServices extends object>(
  command: Command<TServices, any, any, any>,
  breadcrumb: string[],
  casing: Casing
): string {
  const sections: string[] = [];
  const fields = assignPositionals(collectFields(command.params, casing), command.positional);
  const optionRows = fields.map((field) => ({
    flags: formatHelpFieldFlags(field),
    description: formatHelpFieldDescription(field),
  }));

  if (optionRows.length > 0) {
    sections.push(`${text.section("Options:")}\n${formatOptionList(optionRows)}`);
  }

  const secretRows = formatSecretRows(command.secrets);
  if (secretRows.length > 0) {
    sections.push(`${text.section("Secrets (via environment):")}\n${formatOptionList(secretRows)}`);
  }

  return renderHelpDocument({
    breadcrumb,
    description: command.description,
    requiresAuth: command.requires?.auth === true,
    sections,
  });
}

function renderHelpDocument(input: {
  breadcrumb: string[];
  description?: string;
  requiresAuth: boolean;
  sections: string[];
}): string {
  const lines = [text.heading(input.breadcrumb.join(" ")), ""];

  if (input.description !== undefined) {
    lines.push(`  ${input.description}`);
  }

  if (input.requiresAuth) {
    lines.push("  Requires: authentication");
  }

  if (input.description !== undefined || input.requiresAuth) {
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
  const target = resolveHelpTarget(root, argv, "cli");
  const output = resolveHelpOutput(argv);
  const casing = options.casing ?? "kebab";

  await withOutputFormat(output, async () => {
    const rendered =
      target.node.kind === "group"
        ? renderGroupHelp(target.node, target.breadcrumb, "cli", options.version !== undefined)
        : renderLeafHelp(target.node, target.breadcrumb, casing);

    process.stdout.write(rendered);
  });
}

function createNodeCommand<TServices extends object>(
  node: Command<TServices, any, any, any> | Group<TServices>,
  casing: Casing,
  execute: (state: ExecutionState<TServices>) => Promise<void>
): CommanderCommand | null {
  if (node.kind === "command") {
    if (!node.scope.includes("cli")) {
      return null;
    }

    const command = new CommanderCommand(node.name);
    const fields = assignPositionals(collectFields(node.params, casing), node.positional);

    if (node.description !== undefined) {
      command.description(node.description);
    }

    node.aliases.forEach((alias) => command.alias(alias));
    command.addHelpCommand(false);
    addGlobalOptions(command);

    for (const field of fields) {
      if (field.positionalIndex !== undefined) {
        command.argument(`[${field.displayPath}]`);
        continue;
      }

      for (const option of createOption(field)) {
        command.addOption(option);
      }
    }

    command.action(async (...args: unknown[]) => {
      const actionCommand = args[args.length - 1] as CommanderCommand;
      const positionalValues = args.slice(0, -2).filter((value) => typeof value === "string") as string[];

      await execute({
        command: node,
        fields,
        positionalValues,
        actionCommand,
      });
    });

    return command;
  }

  const visibleChildren = node.children
    .map((child) => createNodeCommand(child, casing, execute))
    .filter((child): child is CommanderCommand => child !== null);

  if (visibleChildren.length === 0 && node.default === undefined) {
    return null;
  }

  const group = new CommanderCommand(node.name);

  if (node.description !== undefined) {
    group.description(node.description);
  }

  node.aliases.forEach((alias) => group.alias(alias));
  group.addHelpCommand(false);
  addGlobalOptions(group);
  visibleChildren.forEach((child) => group.addCommand(child));

  if (node.default !== undefined && node.default.scope.includes("cli")) {
    const defaultFields = assignPositionals(collectFields(node.default.params, casing), node.default.positional);

    group.action(async (...args: unknown[]) => {
      const actionCommand = args[args.length - 1] as CommanderCommand;
      await execute({
        command: node.default as Command<TServices, any, any, any>,
        fields: defaultFields,
        positionalValues: [],
        actionCommand,
      });
    });
  }

  return group;
}

function addGlobalOptions(command: CommanderCommand): void {
  command
    .option("--yes", "Accept defaults and skip prompts.")
    .option("--output <format>", "Output format.", (value: string) => {
      if (value === "rich" || value === "md" || value === "json") {
        return value;
      }

      throw new InvalidArgumentError('Invalid value for "--output". Expected one of: rich, md, json.');
    })
    .option("--verbose", "Print stack traces for unexpected errors.");
}

function setNestedValue(target: Record<string, unknown>, path: string[], value: unknown): void {
  let cursor = target;

  for (let index = 0; index < path.length - 1; index += 1) {
    const segment = path[index] ?? "";
    const existing = cursor[segment];

    if (typeof existing === "object" && existing !== null) {
      cursor = existing as Record<string, unknown>;
      continue;
    }

    const next: Record<string, unknown> = {};
    cursor[segment] = next;
    cursor = next;
  }

  const leaf = path[path.length - 1];
  if (leaf !== undefined) {
    cursor[leaf] = value;
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

async function promptForField(field: FieldDefinition): Promise<unknown> {
  if (field.schema.kind === "enum") {
    const selected = await select({
      message: field.displayPath,
      options: field.schema.values.map((value) => ({
        label: String(value),
        value,
      })),
      initialValue: field.hasDefault ? field.defaultValue : undefined,
    });

    if (isCancel(selected)) {
      cancel("Operation cancelled.");
      throw new UserError("Operation cancelled.");
    }

    return selected;
  }

  if (field.schema.kind === "boolean") {
    const selected = await confirm({
      message: field.displayPath,
      initialValue: field.hasDefault ? Boolean(field.defaultValue) : undefined,
    });

    if (isCancel(selected)) {
      cancel("Operation cancelled.");
      throw new UserError("Operation cancelled.");
    }

    return selected;
  }

  const entered = await promptText({
    message: field.displayPath,
    initialValue:
      field.hasDefault && field.defaultValue !== undefined
        ? formatResolvedValue(field.defaultValue)
        : undefined,
  });

  if (isCancel(entered)) {
    cancel("Operation cancelled.");
    throw new UserError("Operation cancelled.");
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

  return parseScalarValue(entered, field.schema as ScalarSchema, field.displayPath);
}

function resolveOutput(globalFlags: GlobalFlags): OutputMode {
  if (globalFlags.output !== undefined) {
    return globalFlags.output;
  }

  return process.stdout.isTTY ? "rich" : "json";
}

function toDesignSystemOutput(output: OutputMode): "terminal" | "markdown" | "json" {
  if (output === "md") {
    return "markdown";
  }

  if (output === "json") {
    return "json";
  }

  return "terminal";
}

async function withOutputFormat<T>(output: OutputMode, fn: () => Promise<T>): Promise<T> {
  const previous = process.env.OUTPUT_FORMAT;
  process.env.OUTPUT_FORMAT = toDesignSystemOutput(output);
  resetOutputFormatCache();

  try {
    return await fn();
  } finally {
    process.env.OUTPUT_FORMAT = previous;
    resetOutputFormatCache();
  }
}

function createFs(): HandlerFs {
  return {
    readFile: async (path: string, encoding = "utf8") =>
      readFile(path, { encoding }),
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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

    return Object.entries(expected).every(([key, value]) => matchesFixtureValue(value, actual[key]));
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
      headers,
    });
  }

  if (typeof response.body === "string") {
    return new Response(response.body, {
      status,
      headers,
    });
  }

  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }

  return new Response(JSON.stringify(response.body), {
    status,
    headers,
  });
}

function createFixtureFetch(entries: FixtureFetchEntry[] | undefined): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = normalizeHttpMethod(init?.method ?? (input instanceof Request ? input.method : undefined));
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
      status: 204,
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
          Object.entries(entry).filter(([key]) => key !== "result" && key !== "response" && key !== "error")
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

    if (typeof firstArg === "string" && Object.prototype.hasOwnProperty.call(definition, firstArg)) {
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
        return async (...args: unknown[]) => resolveFixtureMethodResult(methodName, methods[methodName], args);
      },
    }
  );
}

function resolveFixturePath(commandPath: string): string {
  const parsed = path.parse(commandPath);
  return path.join(parsed.dir, `${parsed.name}.fixture.json`);
}

function selectFixtureScenario(scenarios: FixtureScenario[], selector: string): FixtureScenario {
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
    throw new UserError(`Fixture scenario "${selector}" was not found.`);
  }

  return scenario;
}

async function loadFixtureScenario(command: Command<any, any, any, any>, selector: string): Promise<FixtureScenario> {
  const commandPath = getCommandSourcePath(command);

  if (commandPath === undefined) {
    throw new UserError(`Fixture mode could not determine the source file for command "${command.name}".`);
  }

  const fixturePath = resolveFixturePath(commandPath);
  let rawFixture: string;

  try {
    rawFixture = await readFile(fixturePath, {
      encoding: "utf8",
    });
  } catch {
    throw new UserError(
      `Fixture file not found for command "${command.name}". Expected ${fixturePath}.`
    );
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(rawFixture);
  } catch {
    throw new UserError(`Fixture file ${fixturePath} is not valid JSON.`);
  }

  if (!Array.isArray(parsed)) {
    throw new UserError(`Fixture file ${fixturePath} must contain a JSON array of scenarios.`);
  }

  return selectFixtureScenario(parsed as FixtureScenario[], selector);
}

function resolveFixtureSecrets(command: Command<any, any, any, any>): Record<string, string> {
  return Object.fromEntries(Object.keys(command.secrets).map((name) => [name, "fixture-secret"]));
}

function createFixtureEnvValues(command: Command<any, any, any, any>): Record<string, string | undefined> {
  const values: Record<string, string | undefined> = {
    ...process.env,
    POE_API_KEY: process.env.POE_API_KEY ?? "fixture-secret",
  };

  for (const secret of Object.values(command.secrets)) {
    values[secret.env] = values[secret.env] ?? "fixture-secret";
  }

  return values;
}

async function resolveFixtureRuntime<TServices extends object>(
  command: Command<TServices, any, any, any>,
  services: TServices,
  requirementOptions: CommandRequirementOptions
): Promise<ResolvedFixtureRuntime<TServices>> {
  const selector = process.env.CMDKIT_FIXTURE;

  if (selector === undefined || selector.length === 0) {
    return {
      env: createEnv(),
      fetch: globalThis.fetch,
      fs: createFs(),
      isFixture: false,
      requirementOptions,
      secrets: resolveCommandSecrets(command),
      services,
    };
  }

  const scenario = await loadFixtureScenario(command, selector);
  const scenarioServices = isPlainObject(scenario.services) ? scenario.services : {};
  const customServiceNames = new Set([
    ...Object.keys(services as Record<string, unknown>),
    ...Object.keys(scenarioServices).filter((name) => !RESERVED_SERVICE_NAMES.has(name)),
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
      env: fixtureEnvValues,
    },
    secrets: resolveFixtureSecrets(command),
    services: fixtureServices,
  };
}

function writeRichHeader(title: string): void {
  const padding = Math.max(12, 34 - title.length);
  process.stdout.write(`── ${title} ${"─".repeat(padding)}\n`);
}

function validateServices(services: Record<string, unknown>): void {
  for (const name of Object.keys(services)) {
    if (RESERVED_SERVICE_NAMES.has(name)) {
      throw new Error(`Service name "${name}" is reserved. Choose a different name.`);
    }
  }
}

async function resolveParams(
  fields: FieldDefinition[],
  positionalValues: string[],
  optionValues: Record<string, unknown>,
  shouldPrompt: boolean
): Promise<Record<string, unknown>> {
  const params: Record<string, unknown> = {};

  for (const field of fields) {
    let value: unknown;

    if (field.positionalIndex !== undefined) {
      const positionalValue = positionalValues[field.positionalIndex];
      if (typeof positionalValue === "string" && positionalValue.length > 0) {
        value = parseScalarValue(positionalValue, field.schema as ScalarSchema, field.displayPath);
      }
    } else if (Object.prototype.hasOwnProperty.call(optionValues, field.optionAttribute)) {
      value = optionValues[field.optionAttribute];
    }

    if (value === undefined && shouldPrompt && !field.optional) {
      value = await promptForField(field);
    }

    if (value === undefined && field.hasDefault) {
      value = field.defaultValue;
    }

    if (value === undefined) {
      if (field.optional) {
        continue;
      }

      throw new UserError(`Missing required parameter "${field.displayPath}".`);
    }

    setNestedValue(params, field.path, value);
  }

  return params;
}

function getGlobalFlags(command: CommanderCommand): GlobalFlags {
  const flags = command.optsWithGlobals() as GlobalFlags;
  return flags;
}

async function executeCommand<TServices extends object>(
  state: ExecutionState<TServices>,
  services: TServices,
  requirementOptions: CommandRequirementOptions
): Promise<void> {
  const logger = createLogger();
  const primitives = {
    logger,
    renderTable,
    getTheme,
  };
  const globalFlags = getGlobalFlags(state.actionCommand);
  const output = resolveOutput(globalFlags);
  const shouldPrompt = !globalFlags.yes && Boolean(process.stdin.isTTY);
  const runtime = await resolveFixtureRuntime(state.command, services, requirementOptions);
  const preflightContext = {
    ...runtime.services,
    secrets: runtime.secrets,
    fetch: runtime.fetch,
    fs: runtime.fs,
    env: runtime.env,
    progress(message: string): void {
      logger.info(message);
    },
  };

  await withOutputFormat(output, async () => {
    await assertCommandRequirements(state.command, preflightContext, runtime.requirementOptions);

    const params = await resolveParams(
      state.fields,
      state.positionalValues,
      state.actionCommand.optsWithGlobals() as Record<string, unknown>,
      shouldPrompt
    );

    const context = {
      ...preflightContext,
      params,
    } as HandlerContext<any, any, TServices>;

    if (state.command.confirm && !globalFlags.yes && process.stdin.isTTY) {
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
        initialValue: true,
      });

      if (isCancel(proceed)) {
        cancel("Operation cancelled.");
        throw new UserError("Operation cancelled.");
      }

      if (proceed !== true) {
        throw new UserError("Operation cancelled.");
      }
    }

    const result = await state.command.handler(context);

    if (output === "rich" && runtime.isFixture) {
      writeRichHeader(`${state.command.name} (fixture)`);
    }

    renderResult(state.command, result, output, primitives);
  });
}

function handleRunError(error: unknown, verbose: boolean): void {
  const logger = createLogger();

  if (error instanceof UserError) {
    logger.error(error.message);
    process.exitCode = 1;
    return;
  }

  if (error instanceof CommanderError) {
    process.exitCode = error.exitCode;
    if (error.code === "commander.helpDisplayed" || error.code === "commander.version") {
      return;
    }
    return;
  }

  const message = error instanceof Error ? error.message : String(error);
  logger.error(verbose ? message : `${message} Use --verbose for a stack trace.`);

  if (verbose && error instanceof Error && error.stack) {
    process.stderr.write(`${error.stack}\n`);
  }

  process.exitCode = 1;
}

export async function runCLI<TServices extends object = Record<string, unknown>>(
  root: Group<TServices>,
  options: RunCLIOptions<TServices> = {}
): Promise<void> {
  const casing = options.casing ?? "kebab";
  const services = (options.services ?? {}) as TServices;
  const requirementOptions = {
    apiVersion: options.apiVersion,
  } satisfies CommandRequirementOptions;

  validateServices(services as Record<string, unknown>);

  if (hasHelpFlag(process.argv)) {
    await renderGeneratedHelp(root, process.argv, options);
    return;
  }

  const program = new CommanderCommand();
  program.name(root.name);
  program.exitOverride();
  program.showHelpAfterError();
  program.addHelpCommand(false);
  addGlobalOptions(program);

  if (options.version !== undefined) {
    program.version(options.version, "--version");
  }

  const execute = async (state: ExecutionState<TServices>) => {
    try {
      await executeCommand(state, services, requirementOptions);
    } catch (error) {
      handleRunError(error, Boolean(getGlobalFlags(state.actionCommand).verbose));
    }
  };

  for (const child of root.children) {
    const command = createNodeCommand(child, casing, execute);
    if (command !== null) {
      program.addCommand(command);
    }
  }

  if (root.default !== undefined && root.default.scope.includes("cli")) {
    const fields = assignPositionals(collectFields(root.default.params, casing), root.default.positional);
    program.action(async (...args: unknown[]) => {
      const actionCommand = args[args.length - 1] as CommanderCommand;
      await execute({
        command: root.default as Command<TServices, any, any, any>,
        fields,
        positionalValues: [],
        actionCommand,
      });
    });
  }

  try {
    await program.parseAsync(process.argv);
  } catch (error) {
    handleRunError(error, process.argv.includes("--verbose"));
  }
}
