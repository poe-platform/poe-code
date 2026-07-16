import type { Command } from "commander";
import path from "node:path";
import type { Stats } from "node:fs";
import { randomUUID } from "node:crypto";
import { parseAgentSpecifier, type AgentDefinition } from "@poe-code/agent-defs";
import type { CliContainer } from "../container.js";
import { resolveApiShape, type ApiShapeId, type AuthProvider } from "@poe-code/providers";
import {
  buildProviderContext,
  createExecutionResources,
  createSecretPrompter,
  formatServiceList,
  listServiceNames,
  resolveAssumedDefaultAgent,
  resolveCommandFlags,
  resolveAgentDefinition,
  resolveServiceAdapter,
  applyIsolatedConfiguration,
  type CommandFlags
} from "./shared.js";
import { loadConfiguredServices, saveConfiguredService } from "../../services/config.js";
import { OperationCancelledError } from "../errors.js";
import { requireNonEmpty } from "../options.js";
import {
  combineMutationObservers,
  createMutationReporter
} from "../../services/mutation-events.js";
import type { MutationObservers } from "@poe-code/config-mutations";
import type { CommandContext } from "../context.js";
import { createConfigurePayload } from "./configure-payload.js";
import { hasOwnErrorCode } from "../../utils/error-codes.js";
import type { FileSystem } from "../../utils/file-system.js";

const serviceSelectionPrompt = (action: string) => `Pick a tool to ${action}:`;
const apiShapeLabels: Record<ApiShapeId, string> = {
  "openai-chat-completions": "chat-completions",
  "openai-responses": "responses",
  "anthropic-messages": "messages",
  "google-generations": "generations"
};

type OverlayEntry =
  | { kind: "file"; content: string }
  | { kind: "delete" }
  | { kind: "symlink"; target: string };

type BaseEntry =
  | { kind: "missing" }
  | { kind: "file"; content: string }
  | { kind: "symlink"; target: string }
  | { kind: "other" };

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
  const serviceNames = listServiceNames(
    container.registry.list().filter((service) => service.supportsConfigure !== false)
  );
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
      "Override --base-url for a single provider API shape, e.g. --shape-base-url anthropic-messages=https://gateway.example/anthropic. Repeatable; passing an unknown shape id lists the shapes the provider exposes.",
      collectRepeatedOption
    )
    .option("--skip-if-configured", "Exit without writes when current config already matches")
    .action(async (
      service: string | undefined,
      options: ConfigureCommandOptions,
      command: Command
    ) => {
      const resolved = await resolveServiceArgument(command, container, service, {
        action: "configure"
      });
      await executeConfigure(command, container, resolved, options);
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
  if (adapter.supportsConfigure === false) {
    throw new Error(`${adapter.label} is spawn-only and does not support configure.`);
  }
  const canonicalService = adapter.name;
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, `configure:${canonicalService}`);

  resources.logger.intro(`configure ${canonicalService}`);

  if (options.apiKey !== undefined) {
    requireNonEmpty(options.apiKey, "--api-key");
  }
  if (options.model !== undefined) {
    requireNonEmpty(options.model, "--model");
  }

  if (options.skipIfConfigured === true) {
    const configured = await loadConfiguredServices({
      fs: container.fs,
      filePath: container.env.configPath,
      projectFilePath: container.env.projectConfigPath,
      readOnly: flags.dryRun
    });
    if (Object.prototype.hasOwnProperty.call(configured, canonicalService)) {
      resources.context.complete({
        success: `${adapter.label} is already configured.`,
        dry: `Dry run: ${adapter.label} is already configured.`
      });
      resources.context.finalize();
      return;
    }
  }

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

  await container.registry.invoke(canonicalService, "configure", async (entry) => {
    if (!entry.configure) {
      throw new Error(`Agent "${canonicalService}" does not support configure.`);
    }

    const tracker = createMutationTracker();
    const mutationLogger = createMutationReporter(resources.logger);
    const observers = combineMutationObservers(tracker.observers, mutationLogger);
    const isolated = adapter.isolatedEnv;
    const transaction =
      !flags.dryRun && isolated && isolated.requiresConfig !== false
        ? createOverlayFileSystem(providerContext.command.fs)
        : undefined;
    const executionCommand = transaction
      ? createSilentDryRunCommand(providerContext.command, transaction.fs)
      : providerContext.command;
    const executionProviderContext = transaction
      ? { ...providerContext, command: executionCommand }
      : providerContext;
    let stagedCredentialFallback:
      | { providerId: string; credential: string; previousCredential?: string }
      | undefined;

    await entry.configure(
      {
        fs: executionCommand.fs,
        env: providerContext.env,
        command: executionCommand,
        options: payload
      },
      observers
        ? {
            observers
          }
        : undefined
    );

    if (!flags.dryRun) {
      const configuredPayload = payload as {
        model?: unknown;
        reasoningEffort?: unknown;
        provider?: { credential?: unknown };
      };
      await saveConfiguredService({
        fs: executionCommand.fs,
        filePath: providerContext.env.configPath,
        projectFilePath: providerContext.env.projectConfigPath,
        service: canonicalService,
        metadata: {
          files: tracker.files(),
          provider: providerId ?? "none",
          model: typeof configuredPayload.model === "string" ? configuredPayload.model : undefined,
          reasoningEffort:
            typeof configuredPayload.reasoningEffort === "string"
              ? configuredPayload.reasoningEffort
              : undefined,
          baseUrl: options.baseUrl,
          shapeBaseUrl: options.shapeBaseUrl
        }
      });

      if (transaction && providerId && options.apiKey !== undefined) {
        const store = container.createPreviewProviderStore(providerId, transaction.fs);
        const credential = configuredPayload.provider?.credential;
        if (store && typeof credential === "string") {
          await store.set(credential);
        } else if (typeof credential === "string") {
          stagedCredentialFallback = {
            providerId,
            credential,
            previousCredential: await container.providerRegistry
              .resolveCredential(providerId, {}, { envVars: {} })
              .catch(() => undefined)
          };
        }
      }
    }

    if (isolated && isolated.requiresConfig !== false) {
      const isolatedTracker = createMutationTracker();
      const isolatedLogger = createMutationReporter(resources.logger);
      const isolatedObservers = combineMutationObservers(isolatedTracker.observers, isolatedLogger);
      await applyIsolatedConfiguration({
        adapter: entry,
        providerContext: executionProviderContext,
        payload,
        isolated,
        providerName: adapter.name,
        observers: isolatedObservers
      });
    }

    if (stagedCredentialFallback) {
      await container.providerRegistry.login(stagedCredentialFallback.providerId, {
        apiKey: stagedCredentialFallback.credential
      });
    }
    try {
      await transaction?.commit();
    } catch (error) {
      if (stagedCredentialFallback) {
        if (stagedCredentialFallback.previousCredential === undefined) {
          await container.providerRegistry.logout(stagedCredentialFallback.providerId);
        } else {
          await container.providerRegistry.login(stagedCredentialFallback.providerId, {
            apiKey: stagedCredentialFallback.previousCredential
          });
        }
      }
      throw error;
    }
  });

  resources.context.complete({
    success: `Configured ${adapter.label}.`,
    dry: `Dry run: would configure ${adapter.label}.`
  });

  // Post-configure notes explain what configuring the agent actually means, so a
  // preview needs them too - especially for agents whose configure writes no files.
  resources.logger.nextSteps(adapter.postConfigureMessages ?? []);

  resources.context.finalize();
}

function createSilentDryRunCommand(base: CommandContext, fs: CommandContext["fs"]): CommandContext {
  return {
    dryRun: base.dryRun,
    fs,
    runCommand: base.runCommand,
    runCommandWithEnv: base.runCommandWithEnv,
    flushDryRun() {},
    complete() {},
    finalize() {}
  };
}

export function createOverlayFileSystem(base: FileSystem): {
  fs: FileSystem;
  hasMaterialChange(): Promise<boolean>;
  commit(): Promise<void>;
} {
  const writes = new Map<string, OverlayEntry>();
  const directories = new Set<string>();
  const modes = new Map<string, number>();

  const readOverlayText = async (filePath: string, seen = new Set<string>()): Promise<string> => {
    if (writes.has(filePath)) {
      const value = writes.get(filePath);
      if (!value || value.kind === "delete") {
        throw createNotFoundError(filePath);
      }
      if (value.kind === "file") {
        return value.content;
      }
      if (seen.has(filePath)) {
        throw createFsError("ELOOP", filePath);
      }
      seen.add(filePath);
      return readOverlayText(resolveSymlinkTarget(filePath, value.target), seen);
    }
    return base.readFile(filePath, "utf8");
  };

  const readOverlayEntry = async (filePath: string): Promise<OverlayEntry> => {
    const value = writes.get(filePath);
    if (value) {
      if (value.kind === "delete") {
        throw createNotFoundError(filePath);
      }
      return { ...value };
    }
    const stats = await base.lstat(filePath);
    if (stats.isSymbolicLink()) {
      return { kind: "symlink", target: await base.readlink(filePath) };
    }
    return { kind: "file", content: await base.readFile(filePath, "utf8") };
  };

  async function readFile(filePath: string, encoding: BufferEncoding): Promise<string>;
  async function readFile(filePath: string): Promise<Buffer>;
  async function readFile(filePath: string, encoding?: BufferEncoding): Promise<string | Buffer> {
    const content = await readOverlayText(filePath);
    return encoding ? content : Buffer.from(content);
  }

  const fs: FileSystem = {
    readFile,
    async writeFile(filePath, content, options) {
      await assertOverlayParentDirectory(filePath);
      if (options?.flag === "wx" && (await overlayPathExists(filePath))) {
        throw createFsError("EEXIST", filePath);
      }
      writes.set(filePath, { kind: "file", content: stringifyFileContent(content) });
    },
    async mkdir(directoryPath, options) {
      if (await overlayPathExists(directoryPath)) {
        if ((await fs.stat(directoryPath)).isDirectory()) {
          return;
        }
        throw createFsError("EEXIST", directoryPath);
      }
      if (options?.recursive !== true) {
        await assertOverlayParentDirectory(directoryPath);
      } else {
        await assertNoOverlayFileAncestor(directoryPath);
        let currentPath = directoryPath;
        while (!(await overlayPathExists(currentPath))) {
          directories.add(currentPath);
          const parentPath = path.dirname(currentPath);
          if (parentPath === currentPath) {
            break;
          }
          currentPath = parentPath;
        }
        return;
      }
      directories.add(directoryPath);
    },
    async unlink(filePath) {
      if (!(await overlayPathExists(filePath))) {
        throw createNotFoundError(filePath);
      }
      writes.set(filePath, { kind: "delete" });
    },
    async stat(filePath) {
      if (directories.has(filePath)) {
        return createOverlayStats(true);
      }
      const value = writes.get(filePath);
      if (value) {
        if (value.kind === "delete") {
          throw createNotFoundError(filePath);
        }
        if (value.kind === "file") {
          return createOverlayStats(false);
        }
        return fs.stat(resolveSymlinkTarget(filePath, value.target));
      }
      return base.stat(filePath);
    },
    async lstat(filePath) {
      if (directories.has(filePath)) {
        return createOverlayStats(true);
      }
      const value = writes.get(filePath);
      if (value) {
        if (value.kind === "delete") {
          throw createNotFoundError(filePath);
        }
        return createOverlayStats(false, value.kind === "symlink");
      }
      return base.lstat(filePath);
    },
    async symlink(target, filePath) {
      await assertOverlayParentDirectory(filePath);
      if (await overlayPathExists(filePath)) {
        throw createFsError("EEXIST", filePath);
      }
      writes.set(filePath, { kind: "symlink", target });
    },
    async readlink(filePath) {
      const value = writes.get(filePath);
      if (value) {
        if (value.kind === "symlink") {
          return value.target;
        }
        throw createFsError(value.kind === "delete" ? "ENOENT" : "EINVAL", filePath);
      }
      return base.readlink(filePath);
    },
    async realpath(filePath) {
      return base.realpath(filePath);
    },
    async rename(from, to) {
      await assertOverlayParentDirectory(to);
      writes.set(to, await readOverlayEntry(from));
      writes.set(from, { kind: "delete" });
      const mode = modes.get(from);
      if (mode !== undefined) {
        modes.set(to, mode);
        modes.delete(from);
      }
    },
    async readdir(directoryPath) {
      const entries = new Set(await base.readdir(directoryPath).catch((error) => {
        if (isNotFoundError(error)) {
          return [];
        }
        throw error;
      }));
      for (const directory of directories) {
        if (path.dirname(directory) === directoryPath) {
          entries.add(path.basename(directory));
        }
      }
      for (const [filePath, content] of writes) {
        if (path.dirname(filePath) !== directoryPath) {
          continue;
        }
        if (content.kind === "delete") {
          entries.delete(path.basename(filePath));
        } else {
          entries.add(path.basename(filePath));
        }
      }
      return [...entries];
    },
    async rm(filePath) {
      writes.set(filePath, { kind: "delete" });
    },
    async chmod(filePath, mode) {
      modes.set(filePath, mode);
    }
  };

  const overlayPathExists = async (filePath: string): Promise<boolean> => {
    try {
      await fs.lstat(filePath);
      return true;
    } catch (error) {
      if (isNotFoundError(error)) {
        return false;
      }
      throw error;
    }
  };

  const assertOverlayParentDirectory = async (filePath: string): Promise<void> => {
    const parentPath = path.dirname(filePath);
    try {
      const parent = await fs.stat(parentPath);
      if (!parent.isDirectory()) {
        throw createFsError("ENOTDIR", parentPath);
      }
    } catch (error) {
      if (isNotFoundError(error)) {
        throw createNotFoundError(parentPath);
      }
      throw error;
    }
  };

  const assertNoOverlayFileAncestor = async (directoryPath: string): Promise<void> => {
    let currentPath = directoryPath;
    while (currentPath !== path.dirname(currentPath)) {
      if (await overlayPathExists(currentPath)) {
        if (!(await fs.stat(currentPath)).isDirectory()) {
          throw createFsError("ENOTDIR", currentPath);
        }
        return;
      }
      currentPath = path.dirname(currentPath);
    }
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
        const current = await readBaseEntry(base, filePath);
        if (content.kind === "delete") {
          if (current.kind !== "missing") {
            return true;
          }
          continue;
        }
        if (!baseEntryMatchesOverlay(current, content)) {
          return true;
        }
      }
      return false;
    },
    async commit() {
      const sortedDirectories = [...directories].sort(
        (left, right) => left.split(path.sep).length - right.split(path.sep).length
      );
      const createdDirectories: string[] = [];
      const originals = new Map<string, BaseEntry>();
      const originalModes = new Map<string, number>();
      try {
        for (const directoryPath of sortedDirectories) {
          if (!(await pathExists(base, directoryPath))) {
            createdDirectories.push(directoryPath);
          }
          await base.mkdir(directoryPath, { recursive: true });
        }
        for (const [filePath, content] of writes) {
          if (filePath.includes(".mutation-tmp-") && content.kind === "delete") {
            continue;
          }
          originals.set(filePath, await readBaseEntry(base, filePath));
          if (content.kind === "delete") {
            await base.unlink(filePath).catch((error) => {
              if (!isNotFoundError(error)) {
                throw error;
              }
            });
          } else if (content.kind === "file") {
            await writeBaseTextAtomically(base, filePath, content.content);
          } else {
            await replaceBaseWithSymlink(base, filePath, content.target);
          }
        }
        for (const [filePath, mode] of modes) {
          originalModes.set(filePath, (await base.stat(filePath)).mode);
          await base.chmod?.(filePath, mode);
        }
      } catch (error) {
        for (const [filePath, mode] of [...originalModes].reverse()) {
          await base.chmod?.(filePath, mode).catch(() => undefined);
        }
        for (const [filePath, original] of [...originals].reverse()) {
          await restoreBaseEntry(base, filePath, original).catch(() => undefined);
        }
        for (const directoryPath of createdDirectories.reverse()) {
          await base.rm?.(directoryPath, { recursive: true, force: true }).catch(() => undefined);
        }
        throw error;
      }
    }
  };
}

function stringifyFileContent(content: string | NodeJS.ArrayBufferView): string {
  if (typeof content === "string") {
    return content;
  }
  return Buffer.from(content.buffer, content.byteOffset, content.byteLength).toString("utf8");
}

function resolveSymlinkTarget(linkPath: string, target: string): string {
  return path.isAbsolute(target) ? target : path.resolve(path.dirname(linkPath), target);
}

async function readBaseEntry(fs: FileSystem, filePath: string): Promise<BaseEntry> {
  try {
    const stats = await fs.lstat(filePath);
    if (stats.isSymbolicLink()) {
      return { kind: "symlink", target: await fs.readlink(filePath) };
    }
    if (!stats.isFile()) {
      return { kind: "other" };
    }
    return { kind: "file", content: await fs.readFile(filePath, "utf8") };
  } catch (error) {
    if (isNotFoundError(error)) {
      return { kind: "missing" };
    }
    throw error;
  }
}

function baseEntryMatchesOverlay(baseEntry: BaseEntry, overlayEntry: OverlayEntry): boolean {
  if (overlayEntry.kind === "file") {
    return baseEntry.kind === "file" && baseEntry.content === overlayEntry.content;
  }
  if (overlayEntry.kind === "symlink") {
    return baseEntry.kind === "symlink" && baseEntry.target === overlayEntry.target;
  }
  return baseEntry.kind === "missing";
}

async function writeBaseTextAtomically(
  fs: FileSystem,
  filePath: string,
  content: string
): Promise<void> {
  await replaceBasePathAtomically(fs, filePath, async (temporaryPath) => {
    await fs.writeFile(temporaryPath, content, { encoding: "utf8", flag: "wx" });
  });
}

async function replaceBaseWithSymlink(
  fs: FileSystem,
  filePath: string,
  target: string
): Promise<void> {
  const parentPath = path.dirname(filePath);
  const parentRealPath = await fs.realpath(parentPath);
  await assertStableParentDirectory(fs, parentPath, parentRealPath);
  await removeBasePathIfPresent(fs, filePath);
  await assertStableParentDirectory(fs, parentPath, parentRealPath);
  await fs.symlink(target, filePath);
}

async function replaceBasePathAtomically(
  fs: FileSystem,
  filePath: string,
  createTemporaryPath: (temporaryPath: string) => Promise<void>
): Promise<void> {
  const parentPath = path.dirname(filePath);
  const parentRealPath = await fs.realpath(parentPath);
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const temporaryPath = createOverlayTempPath(filePath);
    let temporaryCreated = false;
    try {
      await createTemporaryPath(temporaryPath);
      temporaryCreated = true;
      await assertStableParentDirectory(fs, parentPath, parentRealPath);
      await fs.rename(temporaryPath, filePath);
      temporaryCreated = false;
      return;
    } catch (error) {
      if (isAlreadyExistsError(error) && !temporaryCreated) {
        continue;
      }
      if (temporaryCreated || !isAlreadyExistsError(error)) {
        await fs.unlink(temporaryPath).catch((cleanupError) => {
          if (!isNotFoundError(cleanupError)) {
            throw cleanupError;
          }
        });
      }
      throw error;
    }
  }

  throw new Error(`Unable to create temporary overlay file for ${filePath}.`);
}

function createOverlayTempPath(filePath: string): string {
  return `${filePath}.overlay-tmp-${process.pid}-${randomUUID()}`;
}

async function assertStableParentDirectory(
  fs: FileSystem,
  parentPath: string,
  expectedRealPath: string
): Promise<void> {
  const currentRealPath = await fs.realpath(parentPath);
  if (currentRealPath !== expectedRealPath) {
    throw new Error(`Refusing overlay commit after parent directory changed: ${parentPath}`);
  }
}

async function restoreBaseEntry(
  fs: FileSystem,
  filePath: string,
  entry: BaseEntry
): Promise<void> {
  if (entry.kind === "missing") {
    await removeBasePathIfPresent(fs, filePath);
    return;
  }
  if (entry.kind === "file") {
    await writeBaseTextAtomically(fs, filePath, entry.content);
    return;
  }
  if (entry.kind === "symlink") {
    await replaceBaseWithSymlink(fs, filePath, entry.target);
  }
}

async function removeBasePathIfPresent(fs: FileSystem, filePath: string): Promise<void> {
  await fs.unlink(filePath).catch((error) => {
    if (!isNotFoundError(error)) {
      throw error;
    }
  });
}

function isAlreadyExistsError(error: unknown): boolean {
  return hasOwnErrorCode(error, "EEXIST");
}

function createOverlayStats(directory: boolean, symbolicLink = false): Stats {
  return {
    isFile: () => !directory && !symbolicLink,
    isDirectory: () => directory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isSymbolicLink: () => symbolicLink,
    isFIFO: () => false,
    isSocket: () => false
  } as Stats;
}

function createFsError(code: string, filePath: string): NodeJS.ErrnoException {
  const error = new Error(`${code}: operation failed, '${filePath}'`) as NodeJS.ErrnoException;
  error.code = code;
  return error;
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

function isBackupPath(filePath: string): boolean {
  return filePath.includes(".backup-");
}

function createNotFoundError(filePath: string): NodeJS.ErrnoException {
  const error = new Error(
    `ENOENT: no such file or directory, open '${filePath}'`
  ) as NodeJS.ErrnoException;
  error.code = "ENOENT";
  return error;
}

function isNotFoundError(error: unknown): boolean {
  return hasOwnErrorCode(error, "ENOENT");
}

async function resolveProvider(
  agent: Pick<AgentDefinition, "id" | "apiShapes">,
  options: Pick<ConfigureCommandOptions, "provider" | "apiKey">,
  container: CliContainer,
  flags: CommandFlags
): Promise<string> {
  const explicit = options.provider ?? container.env.getVariable("POE_CODE_PROVIDER") ?? undefined;

  const candidates = container.providerRegistry.forAgent(agent);
  if (explicit) {
    const provider = container.providerRegistry.get(explicit);
    if (!provider) {
      throw new Error(`Unknown provider "${explicit}".`);
    }
    if (!resolveApiShape(provider, agent)) {
      throw new Error(formatIncompatibleProviderError(agent, provider));
    }
  }

  if (candidates.length === 0) {
    throw new Error(`No providers support agent "${agent.id}".`);
  }

  if (flags.dryRun) {
    return explicit ?? candidates[0]!.id;
  }

  if (explicit) {
    if (options.apiKey === undefined) {
      const loggedIn = await container.providerRegistry.isLoggedIn(explicit);
      if (!loggedIn) {
        await triggerProviderLogin(container, explicit, options.apiKey, flags);
      }
    }
    return explicit;
  }

  const loggedIn: AuthProvider[] = [];
  for (const candidate of candidates) {
    if (
      (await container.providerRegistry.isLoggedIn(candidate.id)) ||
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
      throw new Error(formatAmbiguousProvidersError(agent.id, loggedIn));
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

function formatIncompatibleProviderError(
  agent: Pick<AgentDefinition, "id" | "apiShapes">,
  provider: AuthProvider
): string {
  return [
    `Provider "${provider.id}" cannot configure ${agent.id}.`,
    `${agent.id} requires one of: ${formatApiShapeLabels(agent.apiShapes ?? [])}.`,
    `${provider.id} provides: ${formatApiShapeLabels(provider.apiShapes?.map((shape) => shape.id) ?? [])}.`
  ].join("\n");
}

function formatAmbiguousProvidersError(
  agentId: string,
  providers: readonly AuthProvider[]
): string {
  return [
    `${agentId} can be configured with multiple providers.`,
    "Pass --provider.",
    "",
    "Compatible providers:",
    ...providers.map((provider) => `  ${provider.id}`)
  ].join("\n");
}

function formatApiShapeLabels(shapeIds: readonly ApiShapeId[]): string {
  return shapeIds.length > 0
    ? shapeIds.map((shapeId) => apiShapeLabels[shapeId]).join(", ")
    : "none";
}

function hasProviderEnvCredential(provider: AuthProvider, container: CliContainer): boolean {
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
  const flags = resolveCommandFlags(program);
  const action = selectionContext?.action ?? "configure";
  const services = container.registry.list().filter((service) => {
    if (action === "configure") return service.supportsConfigure !== false;
    if (action === "install") return typeof service.install === "function";
    if (action === "test") return typeof service.test === "function";
    return true;
  });
  if (services.length === 0) {
    throw new Error(`No agents available to ${action}.`);
  }
  const selectionLogger = container.loggerFactory.create({
    dryRun: flags.dryRun,
    verbose: flags.verbose,
    scope: action
  });
  if (flags.assumeYes) {
    return await resolveAssumedDefaultAgent({
      container,
      logger: selectionLogger,
      readOnly: flags.dryRun
    });
  }
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
