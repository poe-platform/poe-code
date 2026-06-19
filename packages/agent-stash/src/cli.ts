import fs from "node:fs/promises";
import os from "node:os";
import process from "node:process";
import { allAgents } from "@poe-code/agent-defs";
import { supportedAgents } from "@poe-code/agent-skill-config";
import { Command } from "commander";
import {
  confirm,
  isCancel,
  multiselect,
  promptText,
  select,
  PromptCancelledError
} from "toolcraft-design";
import {
  addProfile,
  browse,
  copyOrMoveItem,
  downloadBundle,
  exportArchive,
  importArchive,
  listBackups,
  loadConfig,
  removeBackup,
  removeProfile,
  renameProfile,
  restoreBackup,
  syncBundle,
  uploadBundle
} from "./index.js";
import { runBrowseTui } from "./browse.js";
import { loadInventory } from "./inventory.js";
import type { AgentStashContext, AgentStashScope, ConflictPolicy, DownloadOptions, SyncOptions, UploadOptions } from "./types.js";
import type { SyncConflict } from "./types.js";

export interface AgentStashCliDependencies {
  createContext?: (options: { cwd?: string; home?: string }) => AgentStashContext;
  writeOut?: (message: string) => void;
  isInteractive?: () => boolean;
  prompts?: AgentStashPromptAdapter;
}

export interface AgentStashRunCliDependencies extends AgentStashCliDependencies {
  writeErr?: (message: string) => void;
}

interface PromptOption<Value> {
  label: string;
  value: Value;
  hint?: string;
  disabled?: boolean;
}

interface PromptSelectInput<Value> {
  message: string;
  options: Array<PromptOption<Value>>;
  initialValue?: Value;
  maxItems?: number;
}

interface PromptMultiselectInput<Value> {
  message: string;
  options: Array<PromptOption<Value>>;
  initialValues?: Value[];
  required?: boolean;
  maxItems?: number;
}

export interface AgentStashPromptAdapter {
  select<Value>(opts: PromptSelectInput<Value>): Promise<Value | unknown>;
  multiselect<Value>(opts: PromptMultiselectInput<Value>): Promise<Value[] | unknown>;
  confirm(opts: { message: string; initialValue?: boolean }): Promise<boolean | unknown>;
  text(opts: { message: string; placeholder?: string; defaultValue?: string; initialValue?: string }): Promise<string | unknown>;
  isCancel(value: unknown): boolean;
}

type DraftUploadOptions = Omit<UploadOptions, "scope" | "agent"> & {
  scope?: AgentStashScope;
  agent?: string;
};

type DraftDownloadOptions = Omit<DownloadOptions, "scope" | "agent"> & {
  scope?: AgentStashScope;
  agent?: string;
};

type DraftSyncOptions = Omit<SyncOptions, "scope" | "agent"> & {
  scope?: AgentStashScope;
  agent?: string;
};

function createContext(options: { cwd?: string; home?: string }): AgentStashContext {
  return {
    cwd: options.cwd ?? process.cwd(),
    homeDir: options.home ?? os.homedir(),
    fs: fs as unknown as AgentStashContext["fs"]
  };
}

function writeOut(message: string): void {
  process.stdout.write(message);
}

const defaultPrompts: AgentStashPromptAdapter = {
  select,
  multiselect,
  confirm,
  text: promptText,
  isCancel
};

export function createAgentStashProgram(dependencies: AgentStashCliDependencies = {}): Command {
  const getContext = dependencies.createContext ?? createContext;
  const output = dependencies.writeOut ?? writeOut;
  const prompts = dependencies.prompts ?? defaultPrompts;
  const isInteractiveTerminal = dependencies.isInteractive ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const program = new Command();
  program.name("agent-stash").description("Portable agent skills and hooks sync.").version("0.0.1");
  program.option("--cwd <path>", "Project working directory").option("--home <path>", "Home directory");

  const profile = program.command("profile").description("Manage named Gist profiles.");
  profile.command("list").action(async () => {
    const ctx = getContext(program.opts());
    const config = await loadConfig(ctx);
    const entries = Object.entries(config.profiles);
    if (entries.length === 0) {
      output("No profiles configured.\n");
      return;
    }
    for (const [name, record] of entries) {
      output(`${name}\t${record.gistId}\t${record.lastPushedAt ?? "-"}\t${record.lastPulledAt ?? "-"}\n`);
    }
  });
  profile.command("add").argument("<name>").argument("<gist>").action(async (name: string, gist: string) => {
    const ctx = getContext(program.opts());
    await addProfile(ctx, name, gist);
  });
  profile.command("remove").argument("<name>").action(async (name: string) => {
    const ctx = getContext(program.opts());
    await removeProfile(ctx, name);
  });
  profile.command("rename").argument("<oldName>").argument("<newName>").action(async (oldName: string, newName: string) => {
    const ctx = getContext(program.opts());
    await renameProfile(ctx, oldName, newName);
  });

  program
    .command("browse")
    .description("Browse local and shared agent stash items.")
    .option("--profile <name>")
    .option("--scope <scope>", "Local scope to browse", "project")
    .option("--agent <agent>", "Agent id or alias", "claude-code")
    .action(async (opts) => {
      const ctx = getContext(program.opts());
      if (isInteractiveTerminal()) {
        await runBrowseTui(ctx, opts);
        return;
      }
      output(`${await browse(ctx, opts)}\n`);
    });

  program
    .command("upload")
    .option("--profile <name>")
    .option("--gist <gist>")
    .option("--scope <scope>")
    .option("--agent <agent>")
    .option("--skills <names>")
    .option("--hooks <names>")
    .option("--yes")
    .action(async (opts) => {
      const ctx = getContext(program.opts());
      const result = await uploadBundle(
        ctx,
        await resolveUploadOptions(ctx, opts, { prompts, interactive: isInteractiveTerminal() })
      );
      output(`Uploaded ${result.uploaded.length} item(s) to ${result.gistId}.\n`);
    });

  program
    .command("download")
    .argument("[gist]")
    .option("--profile <name>")
    .option("--gist <gist>")
    .option("--scope <scope>")
    .option("--agent <agent>")
    .option("--skills <names>")
    .option("--hooks <names>")
    .option("--yes")
    .action(async (gist: string | undefined, opts) => {
      const ctx = getContext(program.opts());
      const result = await downloadBundle(
        ctx,
        await resolveDownloadOptions(ctx, { ...opts, gist: gist ?? opts.gist }, { prompts, interactive: isInteractiveTerminal() })
      );
      output(`Downloaded ${result.downloaded.length} item(s).\n`);
    });

  program
    .command("sync")
    .option("--profile <name>")
    .option("--gist <gist>")
    .option("--scope <scope>")
    .option("--agent <agent>")
    .option("--skills <names>")
    .option("--hooks <names>")
    .option("--on-conflict <policy>", "Conflict policy")
    .option("--yes")
    .action(async (opts) => {
      const ctx = getContext(program.opts());
      const result = await syncBundle(
        ctx,
        await resolveSyncOptions(ctx, opts, { prompts, interactive: isInteractiveTerminal() })
      );
      output(`Uploaded ${result.uploaded.length}, downloaded ${result.downloaded.length}, conflicts ${result.conflicts.length}.\n`);
      if (result.conflicts.length > 0) {
        process.exitCode = 1;
      }
    });

  for (const operation of ["copy", "move"] as const) {
    program
      .command(operation)
      .requiredOption("--from <location>")
      .requiredOption("--to <location>")
      .option("--profile <name>")
      .requiredOption("--agent <agent>")
      .requiredOption("--kind <kind>")
      .requiredOption("--name <name>")
      .option("--yes")
      .action(async (opts) => {
        const ctx = getContext(program.opts());
        const result = await copyOrMoveItem(ctx, { ...opts, operation });
        output(`${operation} ${result.item.id}.\n`);
      });
  }

  program.command("export").argument("<outputPath>").option("--profile <name>").option("--gist <gist>").option("--scope <scope>").option("--agent <agent>").action(async (outputPath: string, opts) => {
    const ctx = getContext(program.opts());
    const result = await exportArchive(ctx, { ...opts, outputPath });
    output(`Exported ${result.exported.length} item(s) to ${result.outputPath}.\n`);
  });

  program.command("import").argument("<inputPath>").requiredOption("--scope <scope>").requiredOption("--agent <agent>").option("--yes").action(async (inputPath: string, opts) => {
    const ctx = getContext(program.opts());
    const result = await importArchive(ctx, { ...opts, inputPath });
    output(`Imported ${result.imported.length} item(s).\n`);
  });

  const backup = program.command("backup").description("Manage local backups.");
  backup.command("list").action(async () => {
    const ctx = getContext(program.opts());
    const backups = await listBackups(ctx);
    if (backups.length === 0) {
      output("No backups found.\n");
      return;
    }
    for (const record of backups) {
      output(`${record.id}\t${record.createdAt}\t${record.command}\t${record.targetScope ?? "-"}\t${record.targetAgent ?? "-"}\n`);
    }
  });
  backup.command("restore").argument("<backupId>").option("--yes").action(async (backupId: string, opts) => {
    const ctx = getContext(program.opts());
    const result = await restoreBackup(ctx, { backupId, yes: opts.yes });
    output(`Restored ${result.restored.length} path(s).\n`);
  });
  backup.command("remove").argument("<backupId>").action(async (backupId: string) => {
    const ctx = getContext(program.opts());
    await removeBackup(ctx, backupId);
    output(`Removed backup ${backupId}.\n`);
  });

  return program;
}

export async function runCli(
  argv = process.argv,
  dependencies: AgentStashRunCliDependencies = {}
): Promise<void> {
  const { writeErr, ...programDependencies } = dependencies;
  try {
    await createAgentStashProgram(programDependencies).parseAsync(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    (writeErr ?? ((text: string) => process.stderr.write(text)))(`${message}\n`);
    process.exitCode = 1;
  }
}

function splitCsv(value: string | undefined): string[] | undefined {
  return value ? value.split(",").map((part) => part.trim()).filter(Boolean) : undefined;
}

async function resolveUploadOptions(
  ctx: AgentStashContext,
  raw: Record<string, unknown>,
  runtime: { prompts: AgentStashPromptAdapter; interactive: boolean }
): Promise<UploadOptions> {
  const options: DraftUploadOptions = {
    profile: stringOption(raw.profile),
    gist: stringOption(raw.gist),
    scope: scopeOption(raw.scope),
    agent: stringOption(raw.agent),
    skills: splitCsv(stringOption(raw.skills)),
    hooks: splitCsv(stringOption(raw.hooks)),
    yes: booleanOption(raw.yes)
  };

  if (options.yes) {
    applyDefaultTarget(options);
    assertTargetOptions(options);
    return options as UploadOptions;
  }
  if (!runtime.interactive) {
    assertTargetOptions(options);
    return options as UploadOptions;
  }

  await resolveProfilePrompt(ctx, options, runtime.prompts, { allowEmptyUploadProfile: true });
  await resolveTargetPrompts(options, runtime.prompts, "Source");
  await resolveUploadSelections(ctx, options, runtime.prompts);
  const selectedCount = (options.skills?.length ?? 0) + (options.hooks?.length ?? 0);
  const target = options.profile ? `profile "${options.profile}"` : options.gist ? `Gist ${options.gist}` : "a new secret Gist";
  await confirmOrThrow(runtime.prompts, `Upload ${selectedCount} item(s) to ${target}?`);
  options.yes = true;
  return options as UploadOptions;
}

async function resolveDownloadOptions(
  ctx: AgentStashContext,
  raw: Record<string, unknown>,
  runtime: { prompts: AgentStashPromptAdapter; interactive: boolean }
): Promise<DownloadOptions> {
  const options: DraftDownloadOptions = {
    profile: stringOption(raw.profile),
    gist: stringOption(raw.gist),
    scope: scopeOption(raw.scope),
    agent: stringOption(raw.agent),
    skills: splitCsv(stringOption(raw.skills)),
    hooks: splitCsv(stringOption(raw.hooks)),
    yes: booleanOption(raw.yes)
  };

  if (options.yes) {
    applyDefaultTarget(options);
    assertTargetOptions(options);
    return options as DownloadOptions;
  }
  if (!runtime.interactive) {
    assertTargetOptions(options);
    return options as DownloadOptions;
  }

  await resolveProfilePrompt(ctx, options, runtime.prompts, { allowEmptyUploadProfile: false });
  await resolveTargetPrompts(options, runtime.prompts, "Destination");
  const source = options.profile ? `profile "${options.profile}"` : `Gist ${options.gist}`;
  await confirmOrThrow(runtime.prompts, `Download from ${source} into ${options.scope} ${options.agent}?`);
  options.yes = true;
  return options as DownloadOptions;
}

async function resolveSyncOptions(
  ctx: AgentStashContext,
  raw: Record<string, unknown>,
  runtime: { prompts: AgentStashPromptAdapter; interactive: boolean }
): Promise<SyncOptions> {
  const options: DraftSyncOptions = {
    profile: stringOption(raw.profile),
    gist: stringOption(raw.gist),
    scope: scopeOption(raw.scope),
    agent: stringOption(raw.agent),
    skills: splitCsv(stringOption(raw.skills)),
    hooks: splitCsv(stringOption(raw.hooks)),
    onConflict: conflictPolicyOption(raw.onConflict) ?? (runtime.interactive && !booleanOption(raw.yes) ? "ask" : "fail"),
    yes: booleanOption(raw.yes)
  };

  if (options.yes) {
    applyDefaultTarget(options);
    assertTargetOptions(options);
    return options as SyncOptions;
  }
  if (!runtime.interactive) {
    assertTargetOptions(options);
    return options as SyncOptions;
  }

  await resolveProfilePrompt(ctx, options, runtime.prompts, { allowEmptyUploadProfile: false });
  await resolveTargetPrompts(options, runtime.prompts, "Target");
  if (options.onConflict === "ask") {
    options.resolveConflict = conflict => promptConflictResolution(runtime.prompts, conflict);
  }
  await confirmOrThrow(runtime.prompts, `Sync profile "${options.profile ?? options.gist}" with ${options.scope} ${options.agent}?`);
  options.yes = true;
  return options as SyncOptions;
}

async function resolveProfilePrompt(
  ctx: AgentStashContext,
  options: { profile?: string; gist?: string },
  prompts: AgentStashPromptAdapter,
  settings: { allowEmptyUploadProfile: boolean }
): Promise<void> {
  if (options.profile || options.gist) {
    return;
  }
  const config = await loadConfig(ctx);
  const profiles = Object.keys(config.profiles).sort();
  if (profiles.length > 0) {
    options.profile = await promptSelect(prompts, {
      message: "Profile",
      options: profiles.map((profile) => ({
        label: profile,
        value: profile,
        hint: config.profiles[profile]?.gistId
      })),
      initialValue: profiles.includes("default") ? "default" : profiles[0]
    });
    return;
  }
  if (settings.allowEmptyUploadProfile) {
    return;
  }
  const gist = await promptTextValue(prompts, "Gist ID or URL");
  if (gist.trim().length === 0) {
    throw new Error("A profile with a Gist or --gist is required.");
  }
  options.gist = gist.trim();
}

async function resolveTargetPrompts(
  options: { scope?: AgentStashScope; agent?: string },
  prompts: AgentStashPromptAdapter,
  scopeMessage: string
): Promise<void> {
  if (!options.scope) {
    options.scope = await promptSelect(prompts, {
      message: scopeMessage,
      options: [
        { label: "Project", value: "project" },
        { label: "Global", value: "global" }
      ],
      initialValue: "project"
    });
  }
  if (!options.agent) {
    options.agent = await promptSelect(prompts, {
      message: "Agent",
      options: agentOptions(),
      initialValue: "claude-code"
    });
  }
}

async function resolveUploadSelections(
  ctx: AgentStashContext,
  options: DraftUploadOptions,
  prompts: AgentStashPromptAdapter
): Promise<void> {
  assertTargetOptions(options);
  if (options.skills !== undefined && options.hooks !== undefined) {
    return;
  }
  const inventory = await loadInventory(ctx, { scope: options.scope, agent: options.agent });
  if (options.skills === undefined) {
    options.skills = await promptItems(prompts, "Skills", inventory
      .filter((item) => item.kind === "skill")
      .map((item) => item.name));
  }
  if (options.hooks === undefined) {
    options.hooks = await promptItems(prompts, "Hooks", inventory
      .filter((item) => item.kind === "hook")
      .map((item) => item.name));
  }
}

async function promptItems(
  prompts: AgentStashPromptAdapter,
  message: string,
  names: string[]
): Promise<string[]> {
  if (names.length === 0) {
    return [];
  }
  return promptMultiselect(prompts, {
    message,
    options: names.map((name) => ({ label: name, value: name })),
    initialValues: names
  });
}

function applyDefaultTarget(options: { scope?: AgentStashScope; agent?: string }): void {
  options.scope ??= "project";
  options.agent ??= "claude-code";
}

function assertTargetOptions<T extends { scope?: AgentStashScope; agent?: string }>(
  options: T
): asserts options is T & { scope: AgentStashScope; agent: string } {
  if (!options.scope) {
    throw new Error("Missing required option --scope. Pass --scope or run interactively.");
  }
  if (!options.agent) {
    throw new Error("Missing required option --agent. Pass --agent or run interactively.");
  }
}

function agentOptions(): Array<PromptOption<string>> {
  const supported = new Set(supportedAgents);
  return allAgents
    .filter((agent) => supported.has(agent.id))
    .map((agent) => ({
      label: agent.label,
      value: agent.id,
      hint: agent.id
    }));
}

async function promptSelect<Value>(
  prompts: AgentStashPromptAdapter,
  options: PromptSelectInput<Value>
): Promise<Value> {
  const result = await prompts.select(options);
  if (prompts.isCancel(result)) {
    throw new PromptCancelledError();
  }
  return result as Value;
}

async function promptMultiselect<Value>(
  prompts: AgentStashPromptAdapter,
  options: PromptMultiselectInput<Value>
): Promise<Value[]> {
  const result = await prompts.multiselect(options);
  if (prompts.isCancel(result)) {
    throw new PromptCancelledError();
  }
  return result as Value[];
}

async function promptTextValue(prompts: AgentStashPromptAdapter, message: string): Promise<string> {
  const result = await prompts.text({ message });
  if (prompts.isCancel(result)) {
    throw new PromptCancelledError();
  }
  return String(result);
}

async function confirmOrThrow(prompts: AgentStashPromptAdapter, message: string): Promise<void> {
  const result = await prompts.confirm({ message, initialValue: true });
  if (prompts.isCancel(result)) {
    throw new PromptCancelledError();
  }
  if (result !== true) {
    throw new PromptCancelledError("Operation cancelled.");
  }
}

function promptConflictResolution(
  prompts: AgentStashPromptAdapter,
  conflict: SyncConflict
): Promise<Exclude<ConflictPolicy, "ask">> {
  return promptSelect(prompts, {
    message: `Resolve conflict: ${conflict.item.name}`,
    options: [
      { label: "Local", value: "local" as const, hint: "upload local item" },
      { label: "Remote", value: "remote" as const, hint: "download remote item" },
      { label: "Newer", value: "newer" as const, hint: "use newest timestamp" },
      { label: "Fail", value: "fail" as const, hint: "leave unresolved" }
    ],
    initialValue: "fail" as const
  });
}

function stringOption(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function booleanOption(value: unknown): boolean | undefined {
  return value === true ? true : undefined;
}

function scopeOption(value: unknown): AgentStashScope | undefined {
  const text = stringOption(value);
  if (text === undefined) {
    return undefined;
  }
  if (value === "project" || value === "global") {
    return value;
  }
  throw new Error(`Invalid --scope "${text}". Expected project or global.`);
}

function conflictPolicyOption(value: unknown): ConflictPolicy | undefined {
  const text = stringOption(value);
  if (text === undefined) {
    return undefined;
  }
  if (text === "ask" || text === "local" || text === "remote" || text === "newer" || text === "fail") {
    return text;
  }
  throw new Error(`Invalid --on-conflict "${text}". Expected ask, local, remote, newer, or fail.`);
}
