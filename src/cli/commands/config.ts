import { execSync } from "node:child_process";
import type { Command } from "commander";
import { pathExists } from "@poe-code/config-mutations";
import {
  collectEnvOverrides,
  initProjectConfig,
  readDocument,
  resolveEditTarget,
  type ConfigDocument
} from "@poe-code/poe-code-config";
import { text } from "@poe-code/design-system";
import type { CliContainer } from "../container.js";
import { knownConfigScopes } from "../../services/config.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveMergedDocument,
  shlexQuote
} from "./shared.js";

interface ConfigEditCommandOptions {
  global?: boolean;
  project?: boolean;
}

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
    .action(async () => {
      await executeConfigShow(program, container);
    });

  config
    .command("init")
    .description("Create an empty project config file.")
    .action(async () => {
      await executeConfigInit(program, container);
    });

  config
    .command("edit")
    .description("Open a config file in $EDITOR.")
    .option("--global", "Open the global config file.")
    .option("--project", "Open the project config file.")
    .action(async (options: ConfigEditCommandOptions) => {
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

async function executeConfigShow(program: Command, container: CliContainer): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "config:show");
  const globalDocument = await readDocument(container.fs, container.env.configPath);
  const projectDocument = await readDocument(container.fs, container.env.projectConfigPath);
  const envOverrides = collectEnvOverrides(knownConfigScopes, container.env.variables);
  const resolvedDocument = await resolveMergedDocument(container);

  resources.logger.intro("config show");
  resources.logger.info(
    [
      formatDocumentSection("Global config", container.env.configPath, globalDocument),
      formatDocumentSection("Project config", container.env.projectConfigPath, projectDocument),
      formatEnvSection(envOverrides.entries),
      formatDocumentSection("Resolved (merged)", undefined, resolvedDocument)
    ].join("\n\n")
  );
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
  options: ConfigEditCommandOptions
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
    : JSON.stringify(document, null, 2);
  return `${text.heading(`── ${headingText} ──`)}\n${body}`;
}

function formatEnvSection(entries: string[]): string {
  const body = entries.length > 0 ? entries.join("\n") : text.muted("(empty)");
  return `${text.heading("── Environment variable overrides ──")}\n${body}`;
}

function resolveEditor(container: CliContainer): string {
  const editor = container.env.getVariable("EDITOR") ?? container.env.getVariable("VISUAL");
  const resolved = typeof editor === "string" ? editor.trim() : "";
  if (resolved.length === 0) {
    throw new Error("Set $EDITOR to use this command");
  }
  return resolved;
}
