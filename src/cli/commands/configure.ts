import type { Command } from "commander";
import type { Stats } from "node:fs";
import { parseAgentSpecifier, type AgentDefinition } from "@poe-code/agent-defs";
import type { CliContainer } from "../container.js";
import type { AuthProvider } from "@poe-code/providers";
import {
  buildProviderContext,
  createExecutionResources,
  createSecretPrompter,
  formatServiceList,
  listServiceNames,
  resolveCommandFlags,
  resolveDefaultAgent,
  resolveAgentDefinition,
  resolveServiceAdapter,
  applyIsolatedConfiguration,
  type CommandFlags
} from "./shared.js";
import { saveConfiguredService } from "../../services/config.js";
import { OperationCancelledError } from "../errors.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";
import type { MutationObservers } from "@poe-code/config-mutations";
import type { CommandContext } from "../context.js";
import { createConfigurePayload } from "./configure-payload.js";
import type { ProviderContext, ProviderService } from "../service-registry.js";
import type { FileSystem } from "../../utils/file-system.js";

const serviceSelectionPrompt = (action: string) => `Pick a tool to ${action}:`;
const DEFAULT_SERVICE_AGENT = "claude-code";

export interface ConfigureCommandOptions {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  reasoningEffort?: string;
  provider?: string;
  shapeBaseUrl?: string[];
  skipIfConfigured?: boolean;
}

export function registerConfigureCommand(program: Command, container: CliContainer): Command {
  const serviceNames = listServiceNames(container.registry.list());
  const serviceDescription = `Tool to configure${formatServiceList(serviceNames)}`;
  const configureCommand = program
    .command("configure")
    .alias("c")
    .description("Configure developer tooling for Poe API.")
    .argument("[agent]", serviceDescription)
    .option("-y, --yes", "Accept defaults, skip prompts")
    .option("--api-key <key>", "Poe API key")
    .option("--base-url <url>", "Base URL for the resolved provider API shape")
    .option("--model <model>", "Model identifier")
    .option("--reasoning-effort <level>", "Reasoning effort level")
    .option("--provider <id>", "Provider to use for this agent")
    .option(
      "--shape-base-url <shape-id>=<url>",
      "Base URL for one provider API shape",
      collectRepeatedOption
    )
    .option("--skip-if-configured", "Exit without writes when current config already matches")
    .action(async (service: string | undefined, options: ConfigureCommandOptions) => {
      const resolved = await resolveServiceArgument(program, container, service, {
        action: "configure"
      });
      await executeConfigure(program, container, resolved, options);
    });

  return configureCommand;
}

function collectRepeatedOption(value: string, previous: string[] | undefined): string[] {
  return [...(previous ?? []), value];
}

export async function executeConfigure(
  program: Command,
  container: CliContainer,
  service: string,
  options: ConfigureCommandOptions
): Promise<void> {
  const adapter = resolveServiceAdapter(container, service);
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, `configure:${canonicalService}`);

  resources.logger.intro(`configure ${canonicalService}`);

  const providerId =
    adapter.requiresProvider === false
      ? undefined
      : await resolveProvider(
          resolveAgentDefinition(canonicalService) ?? { id: canonicalService },
          options,
          container,
          flags
        );

  const providerContext = buildProviderContext(container, adapter, resources);

  const payload = await createConfigurePayload({
    container,
    flags,
    options,
    context: providerContext,
    adapter,
    logger: resources.logger,
    providerId
  });

  let skippedConfigured = false;
  await container.registry.invoke(canonicalService, "configure", async (entry) => {
    if (!entry.configure) {
      throw new Error(`Agent "${canonicalService}" does not support configure.`);
    }
    if (
      options.skipIfConfigured === true &&
      !(await hasMaterialConfigureChange({
        entry,
        adapter,
        providerContext,
        payload
      }))
    ) {
      skippedConfigured = true;
      return;
    }

    const tracker = createMutationTracker();
    const mutationLogger = createMutationReporter(resources.logger);
    const observers = combineMutationObservers(tracker.observers, mutationLogger);

    await entry.configure(
      {
        fs: providerContext.command.fs,
        env: providerContext.env,
        command: providerContext.command,
        options: payload
      },
      observers
        ? {
            observers
          }
        : undefined
    );

    if (!flags.dryRun) {
      await saveConfiguredService({
        fs: container.fs,
        filePath: providerContext.env.configPath,
        projectFilePath: providerContext.env.projectConfigPath,
        service: canonicalService,
        metadata: {
          files: tracker.files(),
          provider: providerId ?? "none"
        }
      });
    }

    const isolated = adapter.isolatedEnv;
    if (isolated && isolated.requiresConfig !== false) {
      const isolatedTracker = createMutationTracker();
      const isolatedLogger = createMutationReporter(resources.logger);
      const isolatedObservers = combineMutationObservers(isolatedTracker.observers, isolatedLogger);
      await applyIsolatedConfiguration({
        adapter: entry,
        providerContext,
        payload,
        isolated,
        providerName: adapter.name,
        observers: isolatedObservers
      });
    }
  });

  if (skippedConfigured) {
    resources.context.complete({
      success: `${adapter.label} is already configured.`,
      dry: `Dry run: ${adapter.label} is already configured.`
    });
    resources.context.finalize();
    return;
  }

  resources.context.complete({
    success: `Configured ${adapter.label}.`,
    dry: `Dry run: would configure ${adapter.label}.`
  });

  if (!flags.dryRun) {
    resources.logger.nextSteps(adapter.postConfigureMessages ?? []);
  }

  resources.context.finalize();
}

async function hasMaterialConfigureChange(input: {
  entry: ProviderService;
  adapter: ProviderService;
  providerContext: ProviderContext;
  payload: unknown;
}): Promise<boolean> {
  const overlay = createOverlayFileSystem(input.providerContext.command.fs);
  const command = createSilentDryRunCommand(input.providerContext.command, overlay.fs);

  await input.entry.configure(
    {
      fs: overlay.fs,
      env: input.providerContext.env,
      command,
      options: input.payload
    },
    { observers: createNoopMutationObservers() }
  );

  const isolated = input.adapter.isolatedEnv;
  if (isolated && isolated.requiresConfig !== false) {
    await applyIsolatedConfiguration({
      adapter: input.entry,
      providerContext: {
        ...input.providerContext,
        command
      },
      payload: input.payload,
      isolated,
      providerName: input.adapter.name,
      observers: createNoopMutationObservers()
    });
  }

  return overlay.hasMaterialChange();
}

function createSilentDryRunCommand(
  base: CommandContext,
  fs: CommandContext["fs"]
): CommandContext {
  return {
    fs,
    runCommand: base.runCommand,
    runCommandWithEnv: base.runCommandWithEnv,
    flushDryRun() {},
    complete() {},
    finalize() {}
  };
}

function createNoopMutationObservers(): MutationObservers {
  return {};
}

function createOverlayFileSystem(base: FileSystem): {
  fs: FileSystem;
  hasMaterialChange(): Promise<boolean>;
} {
  const writes = new Map<string, string | null>();
  const directories = new Set<string>();

  const readOverlayText = async (filePath: string): Promise<string> => {
    if (writes.has(filePath)) {
      const value = writes.get(filePath);
      if (value === null) {
        throw createNotFoundError(filePath);
      }
      return value ?? "";
    }
    return base.readFile(filePath, "utf8");
  };

  async function readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  async function readFile(filePath: string): Promise<Buffer>;
  async function readFile(filePath: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const content = await readOverlayText(filePath);
    return encoding ? content : Buffer.from(content);
  }

  const fs: FileSystem = {
    readFile,
    async writeFile(filePath, content) {
      writes.set(filePath, stringifyFileContent(content));
    },
    async mkdir(directoryPath) {
      directories.add(directoryPath);
    },
    async unlink(filePath) {
      writes.set(filePath, null);
    },
    async stat(filePath) {
      if (directories.has(filePath)) {
        return createOverlayStats();
      }
      if (writes.has(filePath)) {
        if (writes.get(filePath) === null) {
          throw createNotFoundError(filePath);
        }
        return createOverlayStats();
      }
      return base.stat(filePath);
    },
    async lstat(filePath) {
      return fs.stat(filePath);
    },
    async symlink() {},
    async readlink(filePath) {
      return base.readlink(filePath);
    },
    async rename(from, to) {
      writes.set(to, await readOverlayText(from));
      writes.set(from, null);
    },
    async readdir(directoryPath) {
      return base.readdir(directoryPath);
    },
    async rm(filePath) {
      writes.set(filePath, null);
    },
    async chmod() {}
  };

  return {
    fs,
    async hasMaterialChange() {
      for (const directoryPath of directories) {
        if (!(await pathExists(base, directoryPath))) {
          return true;
        }
      }
      for (const [filePath, content] of writes) {
        if (isBackupPath(filePath)) {
          continue;
        }
        const current = await readBaseText(base, filePath);
        if (content === null) {
          if (current !== null) {
            return true;
          }
          continue;
        }
        if (current !== content) {
          return true;
        }
      }
      return false;
    }
  };
}

function stringifyFileContent(content: string | NodeJS.ArrayBufferView): string {
  if (typeof content === "string") {
    return content;
  }
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("utf8");
}

function createOverlayStats(): Stats {
  return {
    isFile: () => true,
    isDirectory: () => false,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => false,
    isFIFO: () => false,
    isSocket: () => false
  } as Stats;
}

async function pathExists(fs: FileSystem, filePath: string): Promise<boolean> {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (isNotFoundError(error)) {
      return false;
    }
    throw error;
  }
}

async function readBaseText(fs: FileSystem, filePath: string): Promise<string | null> {
  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }
    throw error;
  }
}

function isBackupPath(filePath: string): boolean {
  return filePath.includes(".backup-");
}

function createNotFoundError(filePath: string): NodeJS.ErrnoException {
  const error = new Error(`ENOENT: no such file or directory, open '${filePath}'`) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function isNotFoundError(error: unknown): boolean {
  return Boolean(
    error &&
      typeof error === "object" &&
      (error as { code?: unknown }).code === "ENOENT"
  );
}

async function resolveProvider(
  agent: Pick<AgentDefinition, "id" | "apiShapes">,
  options: Pick<ConfigureCommandOptions, "provider" | "apiKey">,
  container: CliContainer,
  flags: CommandFlags
): Promise<string> {
  const explicit =
    options.provider ?? container.env.getVariable("POE_CODE_PROVIDER") ?? undefined;

  const candidates = container.providerRegistry.forAgent(agent);
  if (candidates.length === 0) {
    throw new Error(`No providers support agent "${agent.id}".`);
  }

  if (flags.dryRun) {
    return explicit ?? candidates[0]!.id;
  }

  if (explicit) {
    if (options.apiKey !== undefined || !(await container.providerRegistry.isLoggedIn(explicit))) {
      await triggerProviderLogin(container, explicit, options.apiKey, flags);
    }
    return explicit;
  }

  const loggedIn: AuthProvider[] = [];
  for (const candidate of candidates) {
    if (
      await container.providerRegistry.isLoggedIn(candidate.id) ||
      hasProviderEnvCredential(candidate, container)
    ) {
      loggedIn.push(candidate);
    }
  }

  if (loggedIn.length === 1) {
    return loggedIn[0]!.id;
  }

  if (loggedIn.length > 1) {
    if (flags.assumeYes) {
      throw new Error(
        `Multiple providers support "${agent.id}". Use --provider <id> to select one.`
      );
    }
    return await promptForProviderChoice(agent.id, loggedIn, container);
  }

  if (flags.assumeYes) {
    throw new Error(
      `No logged-in providers support agent "${agent.id}". Use --provider and --api-key to authenticate non-interactively.`
    );
  }

  const chosen =
    candidates.length === 1
      ? candidates[0]!.id
      : await promptForProviderChoice(agent.id, candidates, container);

  await triggerProviderLogin(container, chosen, options.apiKey, flags);
  return chosen;
}

function hasProviderEnvCredential(
  provider: AuthProvider,
  container: CliContainer
): boolean {
  if (provider.auth.kind !== "api-key") {
    return false;
  }
  const value = container.env.getVariable(provider.auth.envVar);
  return typeof value === "string" && value.trim().length > 0;
}

async function promptForProviderChoice(
  agentId: string,
  providers: readonly AuthProvider[],
  container: CliContainer
): Promise<string> {
  const choices = providers.map((p) => ({ title: p.label, value: p.id }));
  const descriptor = container.promptLibrary.serviceSelection({
    message: `Which provider powers ${agentId}?`,
    choices
  });
  const response = await container.prompts(descriptor);
  const selected = response[descriptor.name];
  if (typeof selected !== "string") {
    throw new OperationCancelledError();
  }
  return selected;
}

async function triggerProviderLogin(
  container: CliContainer,
  providerId: string,
  apiKey: string | undefined,
  flags: CommandFlags
): Promise<void> {
  await container.providerRegistry.login(
    providerId,
    { apiKey },
    {
      envVars: container.env.variables,
      promptForSecret: createSecretPrompter(container),
      resolvePreferredLogin: async (input) =>
        container.options.resolveApiKey({
          value: input.apiKey,
          envValue: input.envValue,
          dryRun: flags.dryRun,
          assumeYes: flags.assumeYes,
          allowStored: false
        })
    }
  );
}

function createMutationTracker(): {
  observers: MutationObservers;
  files(): string[];
} {
  const targets = new Set<string>();
  const observers: MutationObservers = {
    onComplete(details, outcome) {
      if (!outcome.changed || !details.targetPath) {
        return;
      }
      if (outcome.effect !== "write" && outcome.effect !== "delete") {
        return;
      }
      targets.add(details.targetPath);
    }
  };

  return {
    observers,
    files() {
      return Array.from(targets).sort();
    }
  };
}

export async function resolveServiceArgument(
  program: Command,
  container: CliContainer,
  provided?: string,
  selectionContext?: { action: string }
): Promise<string> {
  if (provided) {
    return provided;
  }
  const fromConfig = await resolveDefaultAgent(container);
  if (fromConfig !== null) {
    return parseAgentSpecifier(fromConfig).agent;
  }
  const services = container.registry.list();
  const action = selectionContext?.action ?? "configure";
  if (services.length === 0) {
    throw new Error(`No agents available to ${action}.`);
  }
  const flags = resolveCommandFlags(program);
  if (flags.assumeYes) {
    return DEFAULT_SERVICE_AGENT;
  }
  const selectionLogger = container.loggerFactory.create({
    dryRun: flags.dryRun,
    verbose: flags.verbose,
    scope: action
  });
  selectionLogger.intro(action);
  const choices = services.map((service) => ({
    title: service.label,
    value: service.name
  }));
  const descriptor = container.promptLibrary.serviceSelection({
    message: serviceSelectionPrompt(action),
    choices
  });
  const response = await container.prompts(descriptor);
  const selectionValue = response[descriptor.name];
  if (typeof selectionValue !== "string") {
    throw new OperationCancelledError();
  }
  const resolved = services.find((service) => service.name === selectionValue);
  if (!resolved) {
    throw new Error("Invalid agent selection.");
  }
  return resolved.name;
}
