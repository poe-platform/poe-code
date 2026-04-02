import { access, readFile, writeFile } from "node:fs/promises";
import { Command as CommanderCommand, CommanderError, InvalidArgumentError, Option } from "commander";
import { cancel, confirm, createLogger, isCancel, promptText, resetOutputFormatCache, select } from "@poe-code/design-system";
import type {
  AnySchema,
  ArraySchema,
  Command,
  Group,
  HandlerContext,
  HandlerEnv,
  HandlerFs,
  ObjectSchema,
} from "./index.js";
import { UserError } from "./index.js";

const RESERVED_SERVICE_NAMES = new Set(["params", "secrets", "fetch", "fs", "env", "progress"]);

type Casing = "kebab" | "snake";
type OutputMode = "rich" | "md" | "json";
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

export interface RunCLIOptions<TServices extends object = Record<string, unknown>> {
  casing?: Casing;
  services?: TServices;
  version?: string;
}

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

function readSecrets(command: Command<any, any, any, any>): Record<string, string | undefined> {
  return Object.fromEntries(
    Object.entries(command.secrets).map(([name, secret]) => [name, process.env[secret.env]])
  );
}

function validateSecrets(command: Command<any, any, any, any>, secrets: Record<string, string | undefined>): void {
  for (const [name, secret] of Object.entries(command.secrets)) {
    if (secret.optional === true) {
      continue;
    }

    if (secrets[name] !== undefined) {
      continue;
    }

    const details = secret.description ? `\n${secret.description}` : "";
    throw new UserError(`Missing required secret ${secret.env}.${details}`);
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

function createEnv(): HandlerEnv {
  return {
    get(key: string): string | undefined {
      return process.env[key];
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

function renderResult(
  command: Command<any, any, any, any>,
  result: unknown,
  output: OutputMode,
  logger: ReturnType<typeof createLogger>
): void {
  if (output === "json") {
    const payload = command.render?.json ? command.render.json(result) : result;
    if (payload !== undefined) {
      process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    }
    return;
  }

  if (output === "md") {
    const payload = command.render?.markdown
      ? command.render.markdown(result)
      : typeof result === "string"
      ? result
      : JSON.stringify(result, null, 2);

    if (payload.length > 0) {
      process.stdout.write(`${payload}\n`);
    }
    return;
  }

  if (command.render?.rich) {
    command.render.rich(result, { logger });
    return;
  }

  if (typeof result === "string") {
    process.stdout.write(`${result}\n`);
    return;
  }

  if (result !== undefined) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
}

function getGlobalFlags(command: CommanderCommand): GlobalFlags {
  const flags = command.optsWithGlobals() as GlobalFlags;
  return flags;
}

async function executeCommand<TServices extends object>(
  state: ExecutionState<TServices>,
  services: TServices
): Promise<void> {
  const logger = createLogger();
  const globalFlags = getGlobalFlags(state.actionCommand);
  const output = resolveOutput(globalFlags);
  const shouldPrompt = !globalFlags.yes && Boolean(process.stdin.isTTY);

  await withOutputFormat(output, async () => {
    const params = await resolveParams(
      state.fields,
      state.positionalValues,
      state.actionCommand.optsWithGlobals() as Record<string, unknown>,
      shouldPrompt
    );
    const secrets = readSecrets(state.command);
    validateSecrets(state.command, secrets);
    const fs = createFs();
    const env = createEnv();

    const context = {
      ...services,
      params,
      secrets,
      fetch: globalThis.fetch,
      fs,
      env,
      progress(message: string): void {
        logger.info(message);
      },
    } as HandlerContext<any, any, TServices>;

    const checkResult = await state.command.requires?.check?.(context);
    if (checkResult && !checkResult.ok) {
      throw new UserError(checkResult.message ?? "Command precondition failed.");
    }

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
    renderResult(state.command, result, output, logger);
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

  validateServices(services as Record<string, unknown>);

  const program = new CommanderCommand();
  program.name(root.name);
  program.exitOverride();
  program.showHelpAfterError();
  addGlobalOptions(program);

  if (options.version !== undefined) {
    program.version(options.version, "--version");
  }

  const execute = async (state: ExecutionState<TServices>) => {
    try {
      await executeCommand(state, services);
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
