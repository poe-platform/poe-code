import { execSync } from "node:child_process";
import type { Command } from "commander";
import { pathExists } from "@poe-code/config-mutations";
import {
  collectEnvOverrides,
  initProjectConfig,
  readDocument,
  readDocumentReadonly,
  resolveEditTarget,
  type ConfigDocument,
  type EditTargetOptions
} from "@poe-code/poe-code-config/core";
import { getTheme, renderTable, text } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { ValidationError } from "../errors.js";
import { knownConfigScopes } from "../../services/config.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveMergedDocument,
  shlexQuote
} from "./shared.js";
import { jsonOptionDescription, writeJson, type JsonCommandOptions } from "./json-output.js";

/** Settings nested deeper than this are summarized; --json carries the full documents. */
const CONFIG_SUMMARY_MAX_DEPTH = 2;

const REDACTED_CONFIG_VALUE = "<redacted>";
const SENSITIVE_CONFIG_KEY_NAMES = new Set([
  "apikey",
  "authorization",
  "proxyauthorization",
  "secret",
  "token",
  "password"
]);
const SENSITIVE_CONFIG_KEY_SUFFIXES = [
  "apikey",
  "apitoken",
  "authtoken",
  "accesstoken",
  "secret",
  "password"
];
const SENSITIVE_ENV_VARS = new Set(["POE_API_KEY"]);

export function registerConfigCommand(program: Command, container: CliContainer): void {
  const config = program
    .command("config")
    .description("Inspect and manage poe-code config files.")
    .action(async () => {
      await executeConfigInfo(program, container);
    });

  config
    .command("show")
    .description("Show config inputs and the merged result.")
    .option("--json", jsonOptionDescription)
    .action(async (options: JsonCommandOptions) => {
      await executeConfigShow(program, container, options);
    });

  config
    .command("init")
    .description("Create an empty project config file.")
    .action(async () => {
      await executeConfigInit(program, container);
    });

  config
    .command("path")
    .description("Print the resolved config file path.")
    .option("--global", "Print the global config file path.")
    .option("--project", "Print the project config file path.")
    .action(async (options: EditTargetOptions) => {
      const targetPath = await resolveEditTarget(
        container.fs,
        container.env.configPath,
        container.env.projectConfigPath,
        options
      );
      process.stdout.write(`${targetPath}\n`);
    });

  config
    .command("edit")
    .description("Open a config file in $EDITOR.")
    .option("--global", "Open the global config file.")
    .option("--project", "Open the project config file.")
    .action(async (options: EditTargetOptions) => {
      await executeConfigEdit(program, container, options);
    });
}

async function executeConfigInfo(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "config");
  const globalExists = await pathExists(container.fs, container.env.configPath);
  const projectExists = await pathExists(container.fs, container.env.projectConfigPath);

  resources.logger.intro("config");
  resources.logger.resolved(
    "Global config",
    `${container.env.configPath} (${globalExists ? "exists" : "missing"})`
  );
  resources.logger.resolved(
    "Project config",
    `${container.env.projectConfigPath} (${projectExists ? "exists" : "missing"})`
  );
  resources.logger.nextSteps([
    'Run "poe-code utils config show" to see resolved configuration.'
  ]);
}

async function executeConfigShow(
  program: Command,
  container: CliContainer,
  options: JsonCommandOptions = {}
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const readConfigDocument = flags.dryRun ? readDocumentReadonly : readDocument;
  const globalDocument = await readConfigDocument(container.fs, container.env.configPath);
  const projectDocument = await readConfigDocument(container.fs, container.env.projectConfigPath);
  const envOverrides = collectEnvOverrides(knownConfigScopes, container.env.variables);
  const resolvedDocument = await resolveMergedDocument(container, { readOnly: flags.dryRun });

  if (options.json === true) {
    writeJson({
      global: { path: container.env.configPath, document: redactConfigDocument(globalDocument) },
      project: {
        path: container.env.projectConfigPath,
        document: redactConfigDocument(projectDocument)
      },
      env: envOverrides.entries.map(redactEnvEntry),
      resolved: redactConfigDocument(resolvedDocument)
    });
    return;
  }

  const resources = createExecutionResources(container, flags, "config:show");

  resources.logger.intro("config show");
  resources.logger.info(
    [
      formatDocumentSection("Global config", container.env.configPath, globalDocument),
      formatDocumentSection("Project config", container.env.projectConfigPath, projectDocument),
      formatEnvSection(envOverrides.entries),
      formatDocumentSection("Resolved (merged)", undefined, resolvedDocument)
    ].join("\n\n")
  );
  resources.logger.nextSteps([
    'Run "poe-code utils config show --json" for the full config documents.'
  ]);
}

async function executeConfigInit(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "config:init");
  const targetPath = container.env.projectConfigPath;

  resources.logger.intro("config init");

  if (await pathExists(container.fs, targetPath)) {
    resources.logger.info(`Project config already exists at ${targetPath}`);
    return;
  }

  if (flags.dryRun) {
    resources.logger.dryRun(`Dry run: would create project config at ${targetPath}`);
    return;
  }

  await initProjectConfig(container.fs, targetPath);
  resources.logger.success(`Created project config at ${targetPath}`);
}

async function executeConfigEdit(
  program: Command,
  container: CliContainer,
  options: EditTargetOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "config:edit");
  const editor = resolveEditor(container);

  resources.logger.intro("config edit");

  const targetPath = await resolveEditTarget(
    container.fs,
    container.env.configPath,
    container.env.projectConfigPath,
    options
  );

  if (flags.dryRun) {
    resources.logger.dryRun(`Dry run: would open ${targetPath} in ${editor}`);
    return;
  }

  if (!(await pathExists(container.fs, targetPath))) {
    await initProjectConfig(container.fs, targetPath);
  }

  execSync(`${editor} ${shlexQuote(targetPath)}`, {
    stdio: "inherit"
  });
}

function formatDocumentSection(
  title: string,
  filePath: string | undefined,
  document: ConfigDocument
): string {
  const headingText = filePath ? `${title} (${filePath})` : title;
  const body = Object.keys(document).length === 0
    ? text.muted("(empty)")
    : renderTable({
        theme: getTheme(),
        columns: [
          { name: "Setting", title: "Setting", alignment: "left", maxLen: 44 },
          { name: "Value", title: "Value", alignment: "left", maxLen: 60 }
        ],
        rows: flattenConfigRows(redactConfigDocument(document))
      });
  return `${text.heading(`── ${headingText} ──`)}\n${body}`;
}

/** Flattens a redacted document into dotted Setting/Value rows, summarizing deep branches. */
function flattenConfigRows(
  value: unknown,
  prefix = "",
  depth = 0
): Array<Record<string, string>> {
  if (value === null || typeof value !== "object") {
    return [{ Setting: prefix, Value: String(value) }];
  }

  if (Array.isArray(value)) {
    return [{ Setting: prefix, Value: `${value.length} ${value.length === 1 ? "item" : "items"}` }];
  }

  const entries = Object.entries(value);
  if (entries.length === 0) {
    return [{ Setting: prefix, Value: "(empty)" }];
  }

  if (depth >= CONFIG_SUMMARY_MAX_DEPTH) {
    const keys = entries.map(([key]) => key);
    return [
      {
        Setting: prefix,
        Value: `${keys.length} ${keys.length === 1 ? "key" : "keys"}: ${keys.join(", ")}`
      }
    ];
  }

  return entries.flatMap(([key, entryValue]) =>
    flattenConfigRows(entryValue, prefix ? `${prefix}.${key}` : key, depth + 1)
  );
}

function formatEnvSection(entries: string[]): string {
  const body = entries.length > 0 ? entries.map(redactEnvEntry).join("\n") : text.muted("(empty)");
  return `${text.heading("── Environment variable overrides ──")}\n${body}`;
}

function redactConfigDocument(document: ConfigDocument): ConfigDocument {
  return redactConfigValue(document) as ConfigDocument;
}

function redactConfigValue(value: unknown, key?: string): unknown {
  if (key !== undefined && isSensitiveConfigKey(key)) {
    return REDACTED_CONFIG_VALUE;
  }

  if (Array.isArray(value)) {
    return value.map((entry) => redactConfigValue(entry));
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([entryKey, entryValue]) => [
        entryKey,
        redactConfigValue(entryValue, entryKey)
      ])
    );
  }

  return value;
}

function isSensitiveConfigKey(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[-_\s]/g, "");
  return SENSITIVE_CONFIG_KEY_NAMES.has(normalized)
    || SENSITIVE_CONFIG_KEY_SUFFIXES.some(suffix => normalized.endsWith(suffix));
}

function redactEnvEntry(entry: string): string {
  const match = entry.match(/^(\s*([A-Z0-9_]+)\s*=\s*).*/);
  if (!match) {
    return entry;
  }

  const [, prefix, name] = match;
  return SENSITIVE_ENV_VARS.has(name) ? `${prefix}${REDACTED_CONFIG_VALUE}` : entry;
}

function resolveEditor(container: CliContainer): string {
  const editor = container.env.getVariable("EDITOR") ?? container.env.getVariable("VISUAL");
  const resolved = typeof editor === "string" ? editor.trim() : "";
  if (resolved.length === 0) {
    throw new ValidationError("Set $EDITOR to use this command");
  }
  return resolved;
}
