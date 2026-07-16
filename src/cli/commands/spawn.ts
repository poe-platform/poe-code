import path from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import type { Command } from "commander";
import { Option } from "commander";
import type { CliContainer } from "../container.js";
import {
  renderAcpEvent,
  spawnInteractive,
  getDefaultSpawnLogDir,
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn,
  supportsSpawnMode,
  SPAWN_MODES,
  DEFAULT_SPAWN_MODE,
  type HookBridgeOptions,
  type McpSpawnConfig,
  type SpawnMode
} from "@poe-code/agent-spawn";
import { resolveAgentId } from "@poe-code/agent-defs";
import {
  bridgeActiveSkills,
  cleanupBridgedSkills,
  type BridgeManifest
} from "@poe-code/agent-skill-config";
import {
  bridgeHooks,
  cleanupBridgedHooks,
  formatSupportedTransformPairs,
  isTransformSupported,
  resolveAgentSupport,
  type BridgeHookManifest
} from "@poe-code/agent-hook-config";
import {
  text,
  select,
  isCancel,
  resolveOutputFormat,
  renderMarkdown
} from "toolcraft-design";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveSpawnTarget,
  listSpawnTargets,
  formatServiceList,
  listServiceNames,
  buildResumeCommand,
  resolveMergedDocument,
  requireInteractiveStdin,
  type CommandFlags,
  type ExecutionResources,
  type SpawnTarget
} from "./shared.js";
import { loadIntegrations, type Integrations } from "@poe-code/braintrust";
import type { SpawnCommandOptions } from "../../providers/spawn-options.js";
import { formatSpawnDryRunMessage, resolveConfiguredModel } from "../../sdk/spawn-core.js";
import { spawn as spawnSdk } from "../../sdk/spawn.js";
import { spawnAutonomous } from "../../sdk/autonomous.js";
import type { FileSystem } from "../../utils/file-system.js";
import { OperationCancelledError, ValidationError } from "../errors.js";
import { requireNonEmpty } from "../options.js";
import { resolveSpawnWorkspace } from "../../workspace/resolve-spawn-workspace.js";
import {
  addRuntimeOptions,
  pickRuntimeOptions,
  type RuntimeCliOptions
} from "./runtime-options.js";
import {
  addActivityTimeoutOption,
  pickActivityTimeoutOptions,
  type ActivityTimeoutCliOptions
} from "./activity-timeout-options.js";
import { groupOptionsForHelp, setHelpGuidance } from "./help-guidance.js";
import { addSkillOptions, resolveSkillOptions, type SkillCliOptions } from "./skill-options.js";
import {
  addWorktreeOptions,
  isWorktreeRequested,
  pickWorktreeOptions,
  type WorktreeCliOptions
} from "./worktree-options.js";
import { parseMcpSpawnConfig, resolveMcpSpawnInput } from "../mcp-spawn-config.js";

export interface CustomSpawnHandlerContext {
  container: CliContainer;
  service: string;
  options: SpawnCommandOptions;
  flags: CommandFlags;
  resources: ExecutionResources;
}

export type CustomSpawnHandler = (context: CustomSpawnHandlerContext) => Promise<void>;

export interface RegisterSpawnCommandOptions {
  handlers?: Record<string, CustomSpawnHandler>;
  extraServices?: string[];
}

export function registerSpawnCommand(
  program: Command,
  container: CliContainer,
  options: RegisterSpawnCommandOptions = {}
): void {
  const extraServices = options.extraServices ?? [];
  const spawnTargets = listSpawnTargets(container, extraServices);
  const serviceList = listServiceNames(spawnTargets);
  const serviceDescription = `Agent to spawn${formatServiceList(serviceList)}`;

  const spawnCommand = addSkillOptions(
    program
      .command("spawn")
      .alias("s")
      .description("Run a single prompt through an agent CLI.")
      .option("--model <model>", "Model identifier override passed to the agent CLI")
      .option("-C, --cwd <path>", "Working directory or workspace locator for the agent CLI")
      .option("--stdin", "Read the prompt from stdin")
      .option("-i, --interactive", "Launch the agent in interactive TUI mode")
      .option(
        "--mode <mode>",
        `Permission mode: ${SPAWN_MODES.join(" | ")} (prompted; --yes uses ${DEFAULT_SPAWN_MODE})`
      )
      .option("--resume-thread-id <id>", "Resume a prior provider thread/session")
      .option(
        "--mcp-servers <json|@file>",
        "MCP server config JSON, or @path/to/file.json to load it from disk (see Examples)"
      )
  )
    .option("--hooks-from <agentId>", "Agent hook configuration to bridge for this run")
    .addOption(
      new Option(
        "--hooks-strategy <strategy>",
        `Hook bridge strategy (default: auto; transform supports ${formatSupportedTransformPairs()})`
      ).choices(["auto", "symlink", "transform"])
    )
    .addOption(
      new Option("--hooks-scope <scope>", "Hook bridge scope (default: merged)").choices([
        "project",
        "user",
        "merged"
      ])
    )
    .addOption(
      new Option("--mcp-config <json|@file>", "[deprecated: use --mcp-servers]").hideHelp()
    )
    .option(
      "--log-dir <path>",
      `Directory override for ACP JSONL spawn logs (default: ${getDefaultSpawnLogDir().replace(homedir(), "~")})`
    )
    .option("--log-file-name <name>", "Filename override for the spawn log")
    .option(
      "--log-content",
      "Include message and tool content in ACP JSONL spawn logs (danger: writes prompts and tool arguments, which may contain secrets, to disk)"
    )
    .option("--capture-otel", "Capture native OpenTelemetry emitted by the spawned agent")
    .option("--capture-otel-content", "Include prompt and tool content in native OpenTelemetry");

  addRuntimeOptions(addWorktreeOptions(addActivityTimeoutOption(spawnCommand)))
    .argument("<agent>", serviceDescription)
    .argument(
      "[prompt]",
      "Prompt text to send, '@path/to/file' to load from a file, or '-' / stdin"
    )
    .argument("[agentArgs...]", "Additional arguments forwarded to the agent CLI")
    .action(async function (
      this: Command,
      service: string,
      promptText: string | undefined,
      agentArgs: string[] = []
    ) {
      const flags = resolveCommandFlags(program);
      const commandOptions = this.opts<
        {
          model?: string;
          cwd?: string;
          stdin?: boolean;
          interactive?: boolean;
          mode?: string;
          mcpServers?: string;
          mcpConfig?: string;
          skill?: string[];
          skills?: string[];
          hooksFrom?: string;
          hooksStrategy?: "auto" | "symlink" | "transform";
          hooksScope?: "project" | "user" | "merged";
          resumeThreadId?: string;
          logDir?: string;
          logFileName?: string;
          logContent?: boolean;
          captureOtel?: boolean;
          captureOtelContent?: boolean;
        } & RuntimeCliOptions &
          ActivityTimeoutCliOptions &
          SkillCliOptions &
          WorktreeCliOptions
      >();
      const runtimeOptions = pickRuntimeOptions(commandOptions);
      const model =
        commandOptions.model === undefined
          ? undefined
          : requireNonEmpty(commandOptions.model, "--model");
      const resumeThreadId =
        commandOptions.resumeThreadId === undefined
          ? undefined
          : requireNonEmpty(commandOptions.resumeThreadId, "--resume-thread-id");
      const skills = resolveSkillOptions(commandOptions);
      const hooks = resolveHookOptions(
        commandOptions.hooksFrom,
        commandOptions.hooksStrategy,
        commandOptions.hooksScope,
        service,
        this
      );
      let integrations: Integrations | null = null;
      const shouldEmitUiOutput = resolveOutputFormat() !== "json";
      const rawMcpInput = commandOptions.mcpServers ?? commandOptions.mcpConfig;
      const mcpInput = await resolveMcpSpawnInput(rawMcpInput, container.fs, container.env.cwd);
      const mcpServers = parseMcpSpawnConfig(mcpInput);

      const wantsStdinFlag = commandOptions.stdin === true;
      const shouldReadFromStdin =
        wantsStdinFlag || promptText === "-" || (!promptText && !process.stdin.isTTY);

      const forwardedArgs = wantsStdinFlag
        ? [...(promptText ? [promptText] : []), ...agentArgs]
        : agentArgs;

      if (wantsStdinFlag) {
        promptText = undefined;
      }

      if (promptText === "-") {
        promptText = undefined;
      }

      if (promptText !== undefined) {
        promptText = await resolvePromptInput(promptText, container.fs, container.env.cwd);
      }

      if (!promptText && shouldReadFromStdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        promptText = Buffer.concat(chunks).toString("utf8").trim();
      }

      if (!promptText && !commandOptions.interactive) {
        throw new Error("No prompt provided via argument or stdin");
      }
      const prompt = promptText ?? "";
      // Resolve the agent before the mode. Otherwise a missing or unknown agent is
      // reported as a --mode problem, blaming a flag the user did not get wrong.
      const directHandler = getCustomSpawnHandler(options.handlers, service);
      const resolvedTarget = directHandler
        ? undefined
        : resolveSpawnTarget(container, requireNonEmpty(service, "agent"));
      const mode = await resolveSpawnMode(service, commandOptions.mode, flags);

      const workspace = await resolveSpawnWorkspace(commandOptions.cwd, {
        baseDir: container.env.cwd,
        homeDir: container.env.homeDir,
        mode,
        resolveRemoteLocators: !flags.dryRun,
        fs: container.fs,
        exec: container.commandRunner
      });
      const cwdOverride = workspace.cwd;

      try {
        integrations = await loadIntegrations(
          await resolveMergedDocument(container, { readOnly: flags.dryRun })
        );
        if (commandOptions.interactive) {
          // A worktree run reconciles output after the agent exits, which an interactive
          // TUI session has no defined success signal for. Refuse rather than accept the
          // flag and silently run in the original checkout.
          if (isWorktreeRequested(commandOptions)) {
            throw new ValidationError(
              "spawn --worktree cannot be combined with --interactive. Drop --interactive to run the agent in a managed worktree."
            );
          }
          // An interactive agent TUI inherits stdio and drives a terminal it does not
          // have here, so it would greet a script that can never answer.
          requireInteractiveStdin(
            "spawn --interactive requires an interactive TTY. Drop --interactive to run the agent non-interactively."
          );
          const target = resolvedTarget ?? resolveSpawnTarget(container, service);
          const canonicalService = target.name;
          assertInteractiveSupport(target.label, canonicalService);
          const interactiveModel = await resolveConfiguredModel(
            container,
            canonicalService,
            model,
            { readOnly: flags.dryRun }
          );
          const result = await spawnInteractive(canonicalService, {
            prompt,
            args: forwardedArgs,
            model: interactiveModel,
            mode,
            ...(skills ? { skills } : {}),
            ...(hooks ? { hooks } : {}),
            ...(resumeThreadId !== undefined ? { resumeThreadId } : {}),
            runtimeConfigCwd: container.env.cwd,
            ...runtimeOptions,
            ...(mcpServers ? { mcpServers } : {}),
            cwd: cwdOverride
          });
          process.exitCode = result.exitCode;
          return;
        }

        const directSpawnOptions: SpawnCommandOptions = {
          prompt,
          args: forwardedArgs,
          model,
          mode,
          mcpServers,
          ...(skills ? { skills } : {}),
          ...(hooks ? { hooks } : {}),
          cwd: cwdOverride,
          ...(resumeThreadId !== undefined ? { resumeThreadId } : {}),
          logDir: commandOptions.logDir,
          ...(commandOptions.logFileName !== undefined
            ? { logFileName: commandOptions.logFileName }
            : {}),
          ...(commandOptions.logContent ? { logContent: true } : {}),
          ...(commandOptions.captureOtel || commandOptions.captureOtelContent || process.env.POE_CODE_CAPTURE_OTEL === "1" || process.env.POE_CODE_CAPTURE_OTEL_CONTENT === "1"
            ? { captureOtel: true }
            : {}),
          ...(commandOptions.captureOtelContent || process.env.POE_CODE_CAPTURE_OTEL_CONTENT === "1"
            ? { captureOtelContent: true }
            : {}),
          ...pickActivityTimeoutOptions(commandOptions),
          ...(isWorktreeRequested(commandOptions)
            ? { worktree: pickWorktreeOptions(commandOptions) }
            : {}),
          ...(integrations?.spawnMiddleware ? { middlewares: [integrations.spawnMiddleware] } : {}),
          runtimeConfigCwd: container.env.cwd,
          ...runtimeOptions,
          useStdin: shouldReadFromStdin
        };

        if (directHandler) {
          const resources = createExecutionResources(container, flags, `spawn:${service}`);
          if (shouldEmitUiOutput) {
            resources.logger.intro(`spawn ${service}`);
          }
          await directHandler({
            container,
            service,
            options: directSpawnOptions,
            flags,
            resources
          });
          if (shouldEmitUiOutput) {
            resources.context.finalize();
          }
          return;
        }

        const target = resolvedTarget ?? resolveSpawnTarget(container, service);
        const canonicalService = target.name;
        const configuredModel = await resolveConfiguredModel(
          container,
          canonicalService,
          model,
          { readOnly: flags.dryRun }
        );
        const spawnOptions: SpawnCommandOptions = {
          ...directSpawnOptions,
          model: configuredModel
        };
        const resources = createExecutionResources(container, flags, `spawn:${canonicalService}`);
        let skipFinalize = false;
        if (shouldEmitUiOutput) {
          resources.logger.intro(`spawn ${canonicalService}`);
        }
        const canonicalHandler = getCustomSpawnHandler(options.handlers, canonicalService);
        if (canonicalHandler) {
          try {
            await canonicalHandler({
              container,
              service: canonicalService,
              options: spawnOptions,
              flags,
              resources
            });
            return;
          } finally {
            if (shouldEmitUiOutput) {
              resources.context.finalize();
            }
          }
        }

        try {
          assertSpawnSupport(target);

          assertMcpSpawnSupport(
            target.label,
            canonicalService,
            target.supportsMcpSpawn === true,
            mcpServers
          );

          if (flags.dryRun) {
            validateDryRunBridgeResources(canonicalService, container, spawnOptions);
            resources.logger.dryRun(formatSpawnDryRunMessage(target.label, spawnOptions));
            return;
          }

          if (spawnOptions.useStdin && target.supportsStdinPrompt !== true) {
            throw new ValidationError(
              `${target.label} does not support stdin prompts. Pass the prompt as an argument.`
            );
          }

          if (shouldEmitUiOutput && spawnOptions.logContent) {
            resources.logger.warn(
              "--log-content records prompts and tool content to the spawn log; they may contain secrets."
            );
          }

          const final = await traceSpawnRun(integrations, canonicalService, () =>
            spawnAutonomous(spawnSdk, {
              service: canonicalService,
              prompt: spawnOptions.prompt,
              args: spawnOptions.args,
              model: spawnOptions.model,
              mode: spawnOptions.mode,
              cwd: spawnOptions.cwd,
              ...(spawnOptions.mcpServers ? { mcpServers: spawnOptions.mcpServers } : {}),
              ...(spawnOptions.skills ? { skills: spawnOptions.skills } : {}),
              ...(spawnOptions.hooks ? { hooks: spawnOptions.hooks } : {}),
              ...(spawnOptions.resumeThreadId !== undefined
                ? { resumeThreadId: spawnOptions.resumeThreadId }
                : {}),
              ...(spawnOptions.logDir !== undefined ? { logDir: spawnOptions.logDir } : {}),
              ...(spawnOptions.logFileName !== undefined
                ? { logFileName: spawnOptions.logFileName }
                : {}),
              ...(spawnOptions.logContent ? { logContent: true } : {}),
              ...(spawnOptions.captureOtel ? { captureOtel: true } : {}),
              ...(spawnOptions.captureOtelContent ? { captureOtelContent: true } : {}),
              ...(spawnOptions.activityTimeoutMs !== undefined
                ? { activityTimeoutMs: spawnOptions.activityTimeoutMs }
                : {}),
              ...(spawnOptions.worktree ? { worktree: spawnOptions.worktree } : {}),
              ...(spawnOptions.useStdin ? { useStdin: spawnOptions.useStdin } : {}),
              runtimeConfigCwd: container.env.cwd,
              ...runtimeOptions
            })
          );
          process.exitCode = final.exitCode;

          if (shouldEmitUiOutput && final.detached) {
            resources.logger.info(formatDetachedJob(final.detached));
            skipFinalize = true;
            return;
          }

          if (!shouldEmitUiOutput) {
            renderAcpEvent({
              event: "spawn_result",
              exitCode: final.exitCode,
              ...(final.threadId ? { threadId: final.threadId } : {}),
              ...(final.usage ? { usage: final.usage } : {}),
              protocolVersion: 1
            });
          }

          if (shouldEmitUiOutput) {
            if (final.logError) {
              resources.logger.warn(final.logError);
            } else if (final.logFile) {
              resources.logger.info(text.muted(`Log: ${final.logFile}`));
            }
          }

          if (final.exitCode !== 0) {
            if (!shouldEmitUiOutput) {
              return;
            }
            const detail = final.stderr.trim() || final.stdout.trim();
            const suffix = detail ? `: ${detail}` : "";
            throw new Error(
              `${target.label} spawn failed with exit code ${final.exitCode}${suffix}`
            );
          }

          if (shouldEmitUiOutput) {
            const trimmedStdout = final.stdout.trim();
            if (trimmedStdout) {
              resources.logger.info(renderMarkdown(trimmedStdout).trimEnd());
            } else {
              const trimmedStderr = final.stderr.trim();
              if (trimmedStderr) {
                resources.logger.info(renderMarkdown(trimmedStderr).trimEnd());
              }
            }
          }

          if (shouldEmitUiOutput && final.threadId) {
            const resumeCommand = buildResumeCommand(
              canonicalService,
              final.threadId,
              spawnOptions.cwd ?? process.cwd()
            );
            if (resumeCommand) {
              resources.logger.info(text.muted(`\nResume: ${resumeCommand}`));
            }
          }
        } finally {
          if (shouldEmitUiOutput && !skipFinalize) {
            resources.context.finalize();
          }
        }
      } finally {
        await integrations?.shutdown();
        await workspace.cleanup?.();
      }
    });

  groupOptionsForHelp(spawnCommand, {
    Advanced: [
      "--resume-thread-id",
      "--mcp-servers",
      "--skill",
      "--skills",
      "--hooks-from",
      "--hooks-strategy",
      "--hooks-scope",
      "--activity-timeout-ms",
      "--worktree"
    ],
    Infrastructure: [
      "--log-dir",
      "--log-file-name",
      "--log-content",
      "--capture-otel",
      "--capture-otel-content",
      "--runtime",
      "--runtime-image",
      "--detach",
      "--runner-sync"
    ]
  });

  setHelpGuidance(spawnCommand, {
    examples: [
      'poe-code spawn claude "explain src/cli/program.ts"',
      "poe-code spawn claude @prompt.md --model Claude-Sonnet-4.5",
      'git diff | poe-code spawn codex --stdin --mode read',
      'poe-code spawn claude "fix the failing test" --mode edit -C ~/repo',
      "poe-code spawn claude -i",
      `poe-code spawn claude ping --mcp-servers '{"docs":{"command":"mcp-docs"}}'`,
      "poe-code spawn claude @task.md --mcp-servers @mcp.json",
      'poe-code spawn claude "and now add tests" --resume-thread-id thr_123'
    ],
    notes: [
      "Advanced flags tune a single run: MCP servers, skills, hooks, worktrees.",
      "Infrastructure flags cover logging, telemetry, and where the agent runs."
    ]
  });
}

async function traceSpawnRun<T>(
  integrations: Integrations | null,
  name: string,
  run: () => Promise<T>
): Promise<T> {
  return integrations?.traceRun("spawn", name, run) ?? run();
}

async function resolveSpawnMode(
  service: string,
  input: string | undefined,
  flags: CommandFlags
): Promise<SpawnMode> {
  const explicitMode = parseSpawnMode(input);
  if (explicitMode) {
    assertSpawnModeSupported(service, explicitMode);
    return explicitMode;
  }

  if (flags.assumeYes) {
    return DEFAULT_SPAWN_MODE;
  }

  if (process.stdin.isTTY !== true) {
    throw new ValidationError(
      `spawn requires --mode when running without an interactive TTY. Pass ${listSpawnModes("--mode ")}; or pass --yes to use ${DEFAULT_SPAWN_MODE}.`
    );
  }

  const allModeOptions: Array<{ value: SpawnMode; label: string; hint: string }> = [
    { value: "edit", label: "Edit", hint: "Allow edits, keep provider permission prompts" },
    { value: "auto", label: "Auto", hint: "Agent auto-approves safe actions, rejects unsafe ones" },
    { value: "read", label: "Read only", hint: "Inspect without editing" },
    { value: "yolo", label: "Yolo", hint: "Use provider full-access or skip-permission flags" }
  ];
  const modeOptions = allModeOptions.filter((option) => supportsSpawnMode(service, option.value));

  const selected = await select<SpawnMode>({
    message: "Select permission mode:",
    initialValue: DEFAULT_SPAWN_MODE,
    options: modeOptions
  });
  if (isCancel(selected)) {
    throw new OperationCancelledError();
  }

  return selected as SpawnMode;
}

function assertSpawnModeSupported(service: string, mode: SpawnMode): void {
  if (supportsSpawnMode(service, mode)) {
    return;
  }

  const supported = SPAWN_MODES.filter((name) => supportsSpawnMode(service, name));
  throw new ValidationError(
    `Agent "${service}" does not support --mode ${mode}. Supported modes: ${supported.join(", ")}.`
  );
}

function parseSpawnMode(input: string | undefined): SpawnMode | undefined {
  if (input === undefined) {
    return undefined;
  }

  const normalized = input.trim().toLowerCase();
  if (SPAWN_MODES.includes(normalized as SpawnMode)) {
    return normalized as SpawnMode;
  }

  throw new ValidationError(`Invalid --mode "${input}". Expected ${listSpawnModes()}.`);
}

function listSpawnModes(prefix = ""): string {
  const labels = SPAWN_MODES.map((mode) => `${prefix}${mode}`);
  return `${labels.slice(0, -1).join(", ")}, or ${labels[labels.length - 1]}`;
}

function formatDetachedJob(detached: { jobId: string; envId: string }): string {
  return `job started: ${detached.jobId}\nsandbox: ${detached.envId}\ndetached.`;
}

async function resolvePromptInput(input: string, fs: FileSystem, baseDir: string): Promise<string> {
  if (!input.startsWith("@")) {
    return input;
  }

  const rawPath = input.slice(1);
  if (rawPath.length === 0) {
    throw new ValidationError("prompt @<path> requires a file path after '@'");
  }

  const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(baseDir, rawPath);

  try {
    const contents = await fs.readFile(filePath, "utf8");
    return contents.trim();
  } catch (error) {
    throw new ValidationError(
      `prompt could not read file "${filePath}": ${(error as Error).message}`
    );
  }
}

function getCustomSpawnHandler(
  handlers: Record<string, CustomSpawnHandler> | undefined,
  service: string
): CustomSpawnHandler | undefined {
  return handlers !== undefined && Object.prototype.hasOwnProperty.call(handlers, service)
    ? handlers[service]
    : undefined;
}

function assertMcpSpawnSupport(
  label: string,
  service: string,
  providerSupportsMcpSpawn: boolean,
  servers?: McpSpawnConfig
): void {
  if (!servers || Object.keys(servers).length === 0) {
    return;
  }
  if (supportsMcpAtSpawn(service) || providerSupportsMcpSpawn) {
    return;
  }

  const supported = listMcpSupportedAgents();
  throw new ValidationError(
    `${label} does not support MCP servers at spawn time.\n` +
      `Agents with spawn-time MCP support: ${supported.join(", ")}`
  );
}

function resolveHookOptions(
  from: string | undefined,
  strategy: "auto" | "symlink" | "transform" | undefined,
  scope: HookBridgeOptions["scope"] | undefined,
  target: string,
  command: Command
): NonNullable<SpawnCommandOptions["hooks"]> | undefined {
  if (!from) {
    if (strategy) {
      command.outputHelp({ error: true });
      command.error(
        "error: option '--hooks-strategy <strategy>' requires '--hooks-from <agentId>'"
      );
    }
    if (scope) {
      command.outputHelp({ error: true });
      command.error(
        "error: option '--hooks-scope <scope>' requires '--hooks-from <agentId>'"
      );
    }
    return undefined;
  }

  assertHookPairIsBridgeable(from, target, strategy ?? "auto");

  return {
    from,
    strategy: strategy ?? "auto",
    ...(scope ? { scope } : {})
  };
}

/**
 * Rejects source/target combinations the bridge cannot serve before the agent
 * runs. Unknown agents fall through to the bridge's own "unsupported agent"
 * reporting.
 */
function assertHookPairIsBridgeable(
  from: string,
  target: string,
  strategy: "auto" | "symlink" | "transform"
): void {
  const source = resolveAgentSupport(from);
  const resolvedTarget = resolveAgentSupport(target);
  if (source.config === undefined || resolvedTarget.config === undefined) {
    return;
  }

  const sameFormat = source.config.format === resolvedTarget.config.format;
  const needsTransform = strategy === "transform" || (strategy === "auto" && !sameFormat);
  if (!needsTransform || isTransformSupported(from, target)) {
    return;
  }

  throw new ValidationError(
    `Cannot transform hooks from "${source.id}" to "${resolvedTarget.id}". Supported transforms: ${formatSupportedTransformPairs()}.`
  );
}

function validateDryRunBridgeResources(
  service: string,
  container: CliContainer,
  options: SpawnCommandOptions
): void {
  if ((options.skills === undefined || options.skills.length === 0) && options.hooks === undefined) {
    return;
  }

  const runId = randomUUID();
  let skillsManifest: BridgeManifest | undefined;
  let hooksManifest: BridgeHookManifest | undefined;
  try {
    if (options.skills !== undefined && options.skills.length > 0) {
      skillsManifest = bridgeActiveSkills(
        service,
        options.cwd ?? container.env.cwd,
        options.skills,
        container.env.homeDir,
        runId
      );
    }
    if (options.hooks !== undefined) {
      hooksManifest = bridgeHooks(
        options.hooks.from,
        service,
        options.cwd ?? container.env.cwd,
        container.env.homeDir,
        runId,
        {
          strategy: options.hooks.strategy,
          ...(options.hooks.scope !== undefined ? { scope: options.hooks.scope } : {})
        }
      );
    }
  } finally {
    if (hooksManifest !== undefined) {
      cleanupBridgedHooks(hooksManifest);
    }
    if (skillsManifest !== undefined) {
      cleanupBridgedSkills(skillsManifest);
    }
  }
}

function assertSpawnSupport(target: SpawnTarget): void {
  if (typeof target.spawn === "function") {
    return;
  }
  if (getSpawnConfig(target.name) || getSpawnConfig(target.id)) {
    return;
  }
  throw new ValidationError(`${target.label} does not support spawn.`);
}

function assertInteractiveSupport(label: string, service: string): void {
  const spawnConfig = getSpawnConfig(service);
  if (spawnConfig?.kind === "cli" && spawnConfig.interactive) {
    return;
  }
  if (resolveAgentId(service)) {
    return;
  }
  throw new ValidationError(`${label} does not support interactive mode.`);
}
