import { Command, Option } from "commander";
import { select, promptText, isCancel, cancel, getTheme, renderTable, withSpinner } from "toolcraft-design";
import type { CliContainer } from "../container.js";
import { createExecutionResources, resolveCommandFlags } from "./shared.js";
import { isDecimalIntegerLiteral } from "./decimal-integer.js";
import { ValidationError } from "../errors.js";
import {
  followLaunchLogs,
  listLaunches,
  readLaunchLogs,
  removeLaunch,
  restartLaunch,
  runLaunchDaemon,
  startLaunch,
  stopLaunch
} from "../../sdk/launch.js";
import type { ManagedProcessRecord, ProcessSpec } from "../../sdk/launch.js";
import type { DockerMount, DockerPortMapping, Engine } from "@poe-code/process-runner";
import { isValidManagedProcessId } from "@poe-code/process-launcher";

interface StartCommandOptions {
  restart?: ProcessSpec["restart"];
  maxRestarts?: string;
  readyPattern?: string;
  readyPort?: string;
  cwd?: string;
  env?: string[];
  image?: string;
  mount?: string[];
  port?: string[];
  network?: string;
  engine?: Engine;
}

interface LogsCommandOptions {
  follow?: boolean;
  lines?: string;
  stderr?: boolean;
}

export function registerLaunchCommand(program: Command, container: CliContainer): Command {
  const launch = program
    .command("launch")
    .description("Manage long-running host and Docker processes.")
    .addHelpCommand(false);

  launch
    .command("start")
    .usage("<id> -- <command> [args...]")
    .description("Start and supervise a managed process.")
    .argument("[id]", "Managed process identifier")
    .argument("[command...]", "Command and arguments to run after --")
    .addOption(createChoiceOption("--restart <policy>", "Restart policy", ["never", "on-failure", "always"], "on-failure"))
    .option("--max-restarts <n>", "Max consecutive restarts", "5")
    .option("--ready-pattern <string>", "Log substring to wait for before reporting running")
    .option("--ready-port <port>", "TCP port to probe for readiness")
    .option("--cwd <dir>", "Working directory for the managed process")
    .option("--env <entry>", "Environment variable (KEY=VALUE)", collectValues, [])
    .option("--image <image>", "Docker image")
    .option("--mount <src:target[:ro]>", "Docker bind mount", collectValues, [])
    .option("--port <host:container>", "Docker port mapping", collectValues, [])
    .option("--network <name>", "Docker network")
    .addOption(createChoiceOption("--engine <engine>", "Container engine", ["docker", "podman"]))
    .action(async function (this: Command, id: string | undefined, commandArgs: string[]) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "launch:start");
      const spec = await resolveStartSpec({
        commandArgs,
        id,
        options: this.opts<StartCommandOptions>(),
        program
      });
      if (spec === null) {
        return;
      }
      if (flags.dryRun) {
        resources.logger.dryRun(`Dry run: would start managed process ${spec.id}.`);
        return;
      }

      await withSpinner({
        message: formatStartSpinnerMessage(spec),
        fn: () =>
          startLaunch({
            cwd: container.env.cwd,
            homeDir: container.env.homeDir,
            spec
          }),
        stopMessage: (record) => formatManagedProcessStatus(record, spec.id)
      });
    });

  launch
    .command("stop")
    .description("Stop a managed process.")
    .argument("<id>", "Managed process identifier")
    .option("--force", "Stop immediately with SIGKILL / docker kill")
    .action(async function (this: Command, id: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, `launch:stop:${id}`);
      if (flags.dryRun) {
        await validateManagedProcessExists(container, id);
        resources.logger.dryRun(`Dry run: would stop managed process ${id}.`);
        return;
      }
      const result = await stopLaunch({
        force: Boolean(this.opts<{ force?: boolean }>().force),
        homeDir: container.env.homeDir,
        id
      });
      if (result === null) {
        throw new ValidationError(`Managed process not found: ${id}`);
      }
    });

  launch
    .command("restart")
    .description("Restart a managed process.")
    .argument("<id>", "Managed process identifier")
    .action(async function (id: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, `launch:restart:${id}`);
      if (flags.dryRun) {
        await validateManagedProcessExists(container, id);
        resources.logger.dryRun(`Dry run: would restart managed process ${id}.`);
        return;
      }
      await withSpinner({
        message: `Restarting managed process ${id}...`,
        fn: () => restartLaunch({ homeDir: container.env.homeDir, id }),
        stopMessage: (record) => formatManagedProcessStatus(record, id)
      });
    });

  launch
    .command("status")
    .description("List managed processes.")
    .action(async function () {
      const records = await listLaunches({ homeDir: container.env.homeDir });
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, "launch:status");

      if (records.length === 0) {
        resources.logger.info("No managed processes.");
        return;
      }

      resources.logger.info(renderTable({
        columns: [
          { name: "ID", title: "ID", alignment: "left", maxLen: 24 },
          { name: "RUNTIME", title: "RUNTIME", alignment: "left", maxLen: 8 },
          { name: "STATUS", title: "STATUS", alignment: "left", maxLen: 12 },
          { name: "PID", title: "PID", alignment: "right", maxLen: 8 },
          { name: "RESTARTS", title: "RESTARTS", alignment: "right", maxLen: 10 },
          { name: "UPTIME", title: "UPTIME", alignment: "right", maxLen: 12 },
          { name: "LAST EXIT", title: "LAST EXIT", alignment: "right", maxLen: 10 }
        ],
        rows: records.map(formatStatusRow),
        theme: getTheme()
      }));
    });

  launch
    .command("logs")
    .description("Show managed process logs.")
    .argument("<id>", "Managed process identifier")
    .option("--follow", "Follow log output")
    .option("--lines <n>", "Number of lines to show", "50")
    .option("--stderr", "Show stderr instead of stdout")
    .action(async function (this: Command, id: string) {
      const options = this.opts<LogsCommandOptions>();
      const lines = parseNonNegativeInt(options.lines, "lines") ?? 50;
      const stream = options.stderr ? "stderr" : "stdout";
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, `launch:logs:${id}`);
      const initial = await readLaunchLogs({
        homeDir: container.env.homeDir,
        id,
        lines,
        stream
      });

      if (initial.length > 0) {
        resources.logger.info(initial.join("\n"));
      }

      if (!options.follow) {
        return;
      }

      const controller = new AbortController();
      const stop = () => {
        controller.abort();
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        for await (const line of followLaunchLogs({
          homeDir: container.env.homeDir,
          id,
          lines,
          signal: controller.signal,
          stream
        })) {
          resources.logger.info(line);
        }
      } finally {
        process.removeListener("SIGINT", stop);
        process.removeListener("SIGTERM", stop);
      }
    });

  launch
    .command("rm")
    .description("Remove managed process state and logs.")
    .argument("<id>", "Managed process identifier")
    .action(async function (id: string) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(container, flags, `launch:rm:${id}`);
      if (flags.dryRun) {
        resources.logger.dryRun(`Dry run: would remove managed process ${id}.`);
        return;
      }
      await removeLaunch({ homeDir: container.env.homeDir, id });
    });

  launch
    .command("__run", { hidden: true })
    .argument("<id>", "Managed process identifier")
    .action(async function (id: string) {
      await runLaunchDaemon({ homeDir: container.env.homeDir, id });
    });

  return launch;
}

async function resolveStartSpec(options: {
  program: Command;
  id?: string;
  commandArgs: string[];
  options: StartCommandOptions;
}): Promise<ProcessSpec | null> {
  const flags = resolveCommandFlags(options.program);
  const id = await resolveProcessId(options.id, flags.assumeYes);
  if (id === null) {
    return null;
  }

  const commandParts = await resolveCommandParts(options.commandArgs, flags.assumeYes);
  if (commandParts === null) {
    return null;
  }
  if (commandParts.length === 0) {
    throw new ValidationError("Command to run is required.");
  }

  const runtime = await resolveRuntime({
    assumeYes: flags.assumeYes,
    hasCommand: commandParts.length > 0,
    image: options.options.image
  });
  if (runtime === null) {
    return null;
  }

  const restart = await resolveRestart(options.options.restart, flags.assumeYes);
  if (restart === null) {
    return null;
  }

  const spec: ProcessSpec = {
    args: commandParts.slice(1),
    command: commandParts[0]!,
    id,
    restart
  };

  const maxRestarts = parseNonNegativeInt(options.options.maxRestarts, "max-restarts");
  if (maxRestarts !== undefined) {
    spec.maxRestarts = maxRestarts;
  }

  if (options.options.cwd) {
    spec.cwd = options.options.cwd;
  }

  const envEntries = options.options.env ?? [];
  if (envEntries.length > 0) {
    spec.env = parseEnvEntries(envEntries);
  }

  const readyCheck = resolveReadyCheck(options.options);
  if (readyCheck) {
    spec.readyCheck = readyCheck;
  }

  if (runtime === "docker") {
    const image = await resolveDockerImage(options.options.image);
    if (image === null) {
      return null;
    }

    spec.docker = {
      image,
      ...(options.options.engine ? { engine: options.options.engine } : {}),
      ...(options.options.mount?.length ? { mounts: options.options.mount.map(parseMount) } : {}),
      ...(options.options.port?.length ? { ports: options.options.port.map(parsePort) } : {}),
      ...(options.options.network ? { network: options.options.network } : {})
    };
  }

  return spec;
}

async function resolveProcessId(
  value: string | undefined,
  assumeYes: boolean
): Promise<string | null> {
  if (value && value.trim().length > 0) {
    return assertUsableProcessId(value.trim());
  }

  if (assumeYes) {
    throw new ValidationError("Process ID is required.");
  }

  assertInteractivePromptAvailable(
    "Process ID is required when running without an interactive TTY."
  );

  const entered = await promptText({
    message: "Process ID"
  });
  if (isCancel(entered)) {
    cancel("Launch start cancelled.");
    return null;
  }

  const id = typeof entered === "string" ? entered.trim() : "";
  if (id.length === 0) {
    throw new ValidationError("Process ID is required.");
  }

  return assertUsableProcessId(id);
}

function assertUsableProcessId(id: string): string {
  if (!isValidManagedProcessId(id)) {
    throw new ValidationError(
      `Invalid process id ${JSON.stringify(id)}. Expected a single name without path separators or control characters.`
    );
  }

  return id;
}

async function resolveCommandParts(
  commandArgs: string[],
  assumeYes: boolean
): Promise<string[] | null> {
  if (commandArgs.length > 0) {
    return [...commandArgs];
  }

  if (assumeYes) {
    throw new ValidationError("Command to run is required.");
  }

  assertInteractivePromptAvailable(
    "Command to run is required when running without an interactive TTY."
  );

  const entered = await promptText({
    message: "Command to run"
  });
  if (isCancel(entered)) {
    cancel("Launch start cancelled.");
    return null;
  }

  const value = typeof entered === "string" ? entered.trim() : "";
  if (value.length === 0) {
    throw new ValidationError("Command to run is required.");
  }

  return splitCommandLine(value);
}

async function resolveRuntime(options: {
  image: string | undefined;
  assumeYes: boolean;
  hasCommand: boolean;
}): Promise<"host" | "docker" | null> {
  if (options.image) {
    return "docker";
  }

  if (options.hasCommand || options.assumeYes) {
    return "host";
  }

  assertInteractivePromptAvailable(
    "Runtime selection requires a command, --image, or --yes when running without an interactive TTY."
  );

  const selected = await select({
    message: "Runtime",
    options: [
      { label: "host", value: "host" },
      { label: "docker", value: "docker" }
    ]
  });
  if (isCancel(selected)) {
    cancel("Launch start cancelled.");
    return null;
  }
  return selected as "host" | "docker";
}

async function resolveDockerImage(value: string | undefined): Promise<string | null> {
  if (value && value.trim().length > 0) {
    return value.trim();
  }

  assertInteractivePromptAvailable(
    "Docker image is required when running without an interactive TTY."
  );

  const entered = await promptText({
    message: "Docker image"
  });
  if (isCancel(entered)) {
    cancel("Launch start cancelled.");
    return null;
  }

  const image = typeof entered === "string" ? entered.trim() : "";
  if (image.length === 0) {
    throw new ValidationError("Docker image is required when runtime is docker.");
  }

  return image;
}

async function resolveRestart(
  restart: ProcessSpec["restart"] | undefined,
  assumeYes: boolean
): Promise<ProcessSpec["restart"] | null> {
  if (restart) {
    return restart;
  }

  if (assumeYes) {
    return "on-failure";
  }

  assertInteractivePromptAvailable(
    "Restart policy selection requires --restart or --yes when running without an interactive TTY."
  );

  const selected = await select({
    message: "Restart policy",
    options: [
      { label: "on-failure", value: "on-failure" },
      { label: "never", value: "never" },
      { label: "always", value: "always" }
    ]
  });
  if (isCancel(selected)) {
    cancel("Launch start cancelled.");
    return null;
  }

  return selected as ProcessSpec["restart"];
}

function assertInteractivePromptAvailable(message: string): void {
  if (process.stdin.isTTY !== true) {
    throw new ValidationError(message);
  }
}

function resolveReadyCheck(options: StartCommandOptions): ProcessSpec["readyCheck"] | undefined {
  if (options.readyPattern && options.readyPattern.trim().length > 0) {
    return { kind: "log-pattern", pattern: options.readyPattern.trim() };
  }

  const readyPort = parsePositiveInt(options.readyPort, "ready-port");
  if (readyPort !== undefined) {
    return { kind: "tcp", port: readyPort };
  }

  return undefined;
}

function formatStartSpinnerMessage(spec: ProcessSpec): string {
  const readiness = formatReadinessWait(spec.readyCheck);
  if (readiness) {
    return `Starting managed process ${spec.id}; ${readiness}...`;
  }
  return `Starting managed process ${spec.id}...`;
}

function formatReadinessWait(readyCheck: ProcessSpec["readyCheck"] | undefined): string | null {
  if (readyCheck === undefined) {
    return null;
  }
  if (readyCheck.kind === "log-pattern") {
    return "waiting for log readiness";
  }
  return `waiting for TCP port ${readyCheck.port}`;
}

async function validateManagedProcessExists(container: CliContainer, id: string): Promise<void> {
  const records = await listLaunches({ homeDir: container.env.homeDir });
  if (!records.some((record) => getManagedProcessId(record) === id)) {
    throw new ValidationError(`Managed process not found: ${id}`);
  }
}

function getManagedProcessId(record: ManagedProcessRecord & { id?: string }): string | undefined {
  return record.spec?.id ?? record.state?.id ?? record.id;
}

function formatManagedProcessStatus(record: ManagedProcessRecord, fallbackId: string): string {
  const id = record.spec?.id ?? record.state?.id ?? fallbackId;
  if (record.state?.status) {
    return `Managed process ${id} is ${record.state.status}.`;
  }
  return `Managed process ${id} updated.`;
}

function parseEnvEntries(entries: string[]): Record<string, string> {
  const env: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const entry of entries) {
    const separator = entry.indexOf("=");
    if (separator <= 0) {
      throw new ValidationError(`Invalid --env value "${entry}". Expected KEY=VALUE.`);
    }

    const key = entry.slice(0, separator).trim();
    const value = entry.slice(separator + 1);
    if (key.length === 0) {
      throw new ValidationError(`Invalid --env value "${entry}". Expected KEY=VALUE.`);
    }
    env[key] = value;
  }

  return env;
}

function parseMount(value: string): DockerMount {
  const parts = value.split(":");
  if (parts.length < 2 || parts.length > 3) {
    throw new ValidationError(`Invalid --mount value "${value}". Expected src:target[:ro].`);
  }

  const mount: DockerMount = {
    source: parts[0]!,
    target: parts[1]!
  };
  if (parts[2] === "ro") {
    mount.readonly = true;
  } else if (parts[2] !== undefined) {
    throw new ValidationError(`Invalid --mount value "${value}". Only :ro is supported.`);
  }
  return mount;
}

function parsePort(value: string): DockerPortMapping {
  const parts = value.split(":");
  if (parts.length !== 2) {
    throw new ValidationError(`Invalid --port value "${value}". Expected host:container.`);
  }

  return {
    container: parseRequiredPositiveInt(parts[1]!, "port"),
    host: parseRequiredPositiveInt(parts[0]!, "port")
  };
}


function splitCommandLine(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;

  for (const char of value) {
    if (quote !== null) {
      if (char === quote) {
        quote = null;
      } else {
        current += char;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === " " || char === "\t") {
      if (current.length > 0) {
        parts.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (quote !== null) {
    throw new ValidationError("Command contains an unterminated quote.");
  }
  if (current.length > 0) {
    parts.push(current);
  }
  return parts;
}

function formatStatusRow(record: ManagedProcessRecord): Record<string, string> {
  const state = record.state;
  const id = record.spec?.id ?? state?.id ?? "-";
  return {
    ID: id,
    "LAST EXIT": state?.lastExitCode == null ? "-" : String(state.lastExitCode),
    PID: state?.pid == null ? "-" : String(state.pid),
    RESTARTS: state ? String(state.restartCount) : "0",
    RUNTIME: state?.runtime ?? (record.spec?.docker ? "docker" : "host"),
    STATUS: state?.status ?? "stopped",
    UPTIME: formatUptime(state)
  };
}

function formatUptime(state: ManagedProcessRecord["state"]): string {
  if (!state || (state.status !== "running" && state.status !== "restarting") || !state.lastStartedAt) {
    return "-";
  }

  const startedAt = Date.parse(state.lastStartedAt);
  if (!Number.isFinite(startedAt)) {
    return "-";
  }

  const totalSeconds = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function createChoiceOption(
  flags: string,
  description: string,
  choices: string[],
  defaultValue?: string
): Option {
  const option = new Option(flags, description).choices(choices);
  if (defaultValue !== undefined) {
    option.default(defaultValue);
  }
  return option;
}

function parsePositiveInt(value: string | undefined, fieldName: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!isDecimalIntegerLiteral(normalized) || !Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(`Invalid ${fieldName} "${value}". Expected a positive integer.`);
  }
  return parsed;
}

function parseRequiredPositiveInt(value: string, fieldName: string): number {
  const parsed = parsePositiveInt(value, fieldName);
  if (parsed === undefined) {
    throw new ValidationError(`Invalid ${fieldName} "${value}". Expected a positive integer.`);
  }
  return parsed;
}

function parseNonNegativeInt(value: string | undefined, fieldName: string): number | undefined {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim();
  const parsed = Number.parseInt(normalized, 10);
  if (!isDecimalIntegerLiteral(normalized) || !Number.isInteger(parsed) || parsed < 0) {
    throw new ValidationError(`Invalid ${fieldName} "${value}". Expected a non-negative integer.`);
  }
  return parsed;
}

function collectValues(value: string, previous: string[]): string[] {
  return [...previous, value];
}
