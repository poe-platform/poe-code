import { spawn } from "node:child_process";
import * as fsPromises from "node:fs/promises";
import path from "node:path";
import type { SpawnMode } from "@poe-code/agent-spawn";
import { parse as parseShellCommand } from "shell-quote";
import type { AgentPlugin } from "../runtime/plugin-types.js";
import type { ToolContext } from "../runtime/types.js";
import {
  readOptionalString,
  readOptionalStringArray,
  rejectUnknownKeys,
  toOptionsObject
} from "./parse-options.js";
import {
  getOptionalBoolean,
  getOptionalNumber,
  getOptionalString,
  getRequiredString,
  assertNoSymbolicLinkPath,
  resolveAllowedPath
} from "./plugin-args.js";
import type { PluginSpec } from "./registry.js";

type RunCommandOptions = {
  signal: AbortSignal;
  timeoutMs: number;
  notify?: ToolContext["notify"];
};

type RunCommandFn = (command: string, cwd: string, options: RunCommandOptions) => Promise<string>;

type ShellPluginOptions = {
  cwd?: string;
  allowedPaths?: string[];
  fs?: Pick<typeof fsPromises, "lstat">;
  runCommand?: RunCommandFn;
};

export type ShellPluginConfigOptions = Pick<ShellPluginOptions, "cwd" | "allowedPaths">;

type SpawnedCommandOutcome = {
  aborted: boolean;
  timedOut: boolean;
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  error?: Error;
};

type SpawnedCommand = {
  stdout: RetainedShellOutput;
  stderr: RetainedShellOutput;
  terminate(): void;
  completion: Promise<SpawnedCommandOutcome>;
};

type BackgroundCommand = {
  handle: string;
  stdout: RetainedShellOutput;
  stderr: RetainedShellOutput;
  status: "running" | "exited";
  exitCode: number | null;
  exitSignal: NodeJS.Signals | null;
  timedOut: boolean;
  error?: string;
  terminate(): void;
  completion: Promise<void>;
};

type ShellOutputNotification = {
  event: "shell.stdout" | "shell.stderr";
  message: string;
  data: {
    background: boolean;
    command: string;
    cwd: string;
    handle?: string;
    stream: "stdout" | "stderr";
  };
};

const defaultTimeoutSeconds = 120;
const maxTimeoutSeconds = 600;
const terminateGracePeriodMs = 1_000;
const maxRetainedOutputChars = 128 * 1024;

type RetainedShellOutput = {
  value: string;
  omittedChars: number;
};

const shellPlugin = (options: ShellPluginOptions = {}): AgentPlugin => {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const allowedPaths = (options.allowedPaths ?? [cwd]).map((allowedPath) =>
    path.resolve(cwd, allowedPath)
  );
  const runCommand = options.runCommand ?? defaultRunCommand;
  const fs = options.fs ?? fsPromises;
  const backgroundCommands = new Map<string, BackgroundCommand>();
  let nextHandle = 0;

  const runCommandTool = {
    name: "run_command",
    description:
      "Run a shell command. Set run_in_background to true to start it and receive a handle string for read_background or kill_background.",
    policy: {
      read: true,
      edit: true,
      validate: validateRunCommandPolicy
    },
    inputSchema: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command to execute."
        },
        cwd: {
          type: "string",
          description: "Working directory for command execution."
        },
        timeout: {
          type: "number",
          description: "Timeout in seconds. Defaults to 120 and cannot exceed 600."
        },
        run_in_background: {
          type: "boolean",
          description:
            "When true, start the command and return a background handle instead of waiting."
        }
      },
      required: ["command"]
    },
    async call(args: unknown, ctx: ToolContext): Promise<string> {
      const command = getRequiredString(args, "command");
      const commandCwdArg = getOptionalString(args, "cwd");
      const commandCwd = commandCwdArg ? resolveAllowedPath(cwd, allowedPaths, commandCwdArg) : cwd;
      await assertNoSymbolicLinkPath(fs, commandCwd);
      const timeoutMs = parseTimeoutMs(args);
      const runInBackground = getOptionalBoolean(args, "run_in_background") ?? false;

      if (runInBackground) {
        if (ctx.signal.aborted) {
          throw new Error("Command aborted");
        }

        nextHandle += 1;
        const handle = `background-${nextHandle}`;
        backgroundCommands.set(
          handle,
          createBackgroundCommand(handle, command, commandCwd, timeoutMs, ctx.notify)
        );
        return handle;
      }

      return runCommand(command, commandCwd, {
        signal: ctx.signal,
        timeoutMs,
        notify: ctx.notify
      });
    }
  };

  const readBackgroundTool = {
    name: "read_background",
    description:
      "Read the latest buffered stdout/stderr and status for a background command handle.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Handle returned by run_command when run_in_background is true."
        }
      },
      required: ["handle"]
    },
    async call(args: unknown): Promise<string> {
      const handle = getRequiredString(args, "handle");
      const backgroundCommand = getBackgroundCommand(backgroundCommands, handle);
      return formatBackgroundCommand(backgroundCommand);
    }
  };

  const killBackgroundTool = {
    name: "kill_background",
    description: "Terminate a background command handle.",
    policy: {
      read: true,
      edit: true
    },
    inputSchema: {
      type: "object",
      properties: {
        handle: {
          type: "string",
          description: "Handle returned by run_command when run_in_background is true."
        }
      },
      required: ["handle"]
    },
    async call(args: unknown): Promise<string> {
      const handle = getRequiredString(args, "handle");
      const backgroundCommand = getBackgroundCommand(backgroundCommands, handle);

      if (backgroundCommand.status === "exited") {
        return `Background command already exited: ${handle}`;
      }

      backgroundCommand.terminate();
      await backgroundCommand.completion;
      return `Killed background command: ${handle}`;
    }
  };

  return {
    name: "poe-agent-plugin-shell",
    tools: [runCommandTool, readBackgroundTool, killBackgroundTool],
    async dispose(): Promise<void> {
      const pendingStops: Promise<void>[] = [];

      for (const backgroundCommand of backgroundCommands.values()) {
        if (backgroundCommand.status === "exited") {
          continue;
        }

        backgroundCommand.terminate();
        pendingStops.push(backgroundCommand.completion.catch(() => undefined));
      }

      await Promise.all(pendingStops);
      backgroundCommands.clear();
    }
  };
};

function parseTimeoutMs(args: unknown): number {
  const timeoutSeconds = getOptionalNumber(args, "timeout") ?? defaultTimeoutSeconds;

  if (timeoutSeconds <= 0) {
    throw new Error('Tool argument "timeout" must be greater than 0');
  }

  if (timeoutSeconds > maxTimeoutSeconds) {
    throw new Error(`Tool argument "timeout" must not exceed ${maxTimeoutSeconds}`);
  }

  return timeoutSeconds * 1_000;
}

function getBackgroundCommand(
  backgroundCommands: Map<string, BackgroundCommand>,
  handle: string
): BackgroundCommand {
  const backgroundCommand = backgroundCommands.get(handle);
  if (!backgroundCommand) {
    throw new Error(`Unknown background handle: ${handle}`);
  }

  return backgroundCommand;
}

function createBackgroundCommand(
  handle: string,
  command: string,
  cwd: string,
  timeoutMs: number,
  notify?: ToolContext["notify"]
): BackgroundCommand {
  const spawned = spawnShellCommand(command, cwd, {
    timeoutMs,
    notify,
    background: true,
    handle
  });

  const backgroundCommand: BackgroundCommand = {
    handle,
    stdout: spawned.stdout,
    stderr: spawned.stderr,
    status: "running",
    exitCode: null,
    exitSignal: null,
    timedOut: false,
    terminate: spawned.terminate,
    completion: spawned.completion.then((outcome) => {
      backgroundCommand.status = "exited";
      backgroundCommand.exitCode = outcome.exitCode;
      backgroundCommand.exitSignal = outcome.exitSignal;
      backgroundCommand.timedOut = outcome.timedOut;
      if (outcome.error) {
        backgroundCommand.error = outcome.error.message;
      }
    })
  };

  return backgroundCommand;
}

function validateRunCommandPolicy(args: unknown, mode: SpawnMode): string | void {
  let command: string;

  try {
    command = getRequiredString(args, "command");
  } catch {
    return;
  }

  let entries: ReturnType<typeof parseShellCommand>;

  try {
    entries = parseShellCommand(command);
  } catch (error) {
    return toPolicyErrorMessage(error, mode);
  }

  if (entries.length === 0) {
    return `Command is not allowed in ${mode} mode.`;
  }

  const segments: string[][] = [];
  let currentSegment: string[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      currentSegment.push(entry);
      continue;
    }

    if ("op" in entry) {
      if (entry.op === "|" || entry.op === "||" || entry.op === "&&" || entry.op === ";") {
        if (currentSegment.length > 0) {
          segments.push(currentSegment);
          currentSegment = [];
        }
        continue;
      }

      if (mode === "read") {
        if (isDedicatedToolReadCommand(command)) {
          return "Use the dedicated file/search/list tools instead of shell wrappers for file reads, searches, or directory listings.";
        }

        return `Shell redirection is not allowed in ${mode} mode.`;
      }

      continue;
    }
  }

  if (currentSegment.length > 0) {
    segments.push(currentSegment);
  }

  for (const segment of segments) {
    const commandParts = stripLeadingAssignments(segment);
    const commandName = commandParts[0];

    if (!commandName) {
      continue;
    }

    const commandArgs = commandParts.slice(1);
    const shellWrapperReason = getShellWrapperReason(commandName, commandArgs);
    if (shellWrapperReason) {
      return shellWrapperReason;
    }

    if (isCdWrapper(commandName, commandArgs)) {
      return 'Use the "cwd" argument instead of prefixing commands with "cd".';
    }

    if (mode === "read") {
      const directReadToolReason = getDedicatedReadToolReason(commandName, commandArgs);
      if (directReadToolReason) {
        return directReadToolReason;
      }

      const nestedCommand = getNestedReadOnlyCommand(commandName, commandArgs);
      if (nestedCommand) {
        if (!isReadOnlyCommand(nestedCommand.commandName, nestedCommand.args)) {
          return `Command "${commandName}" is not allowed in ${mode} mode.`;
        }

        continue;
      }

      if (!isReadOnlyCommand(commandName, commandArgs)) {
        return `Command "${commandName}" is not allowed in ${mode} mode.`;
      }

      continue;
    }

    const blockedReason = getBlockedEditModeReason(commandName, commandArgs);
    if (blockedReason) {
      return blockedReason;
    }
  }
}

function getShellWrapperReason(commandName: string, args: string[]): string | undefined {
  if (!isShellWrapperCommand(commandName) || args.length === 0) {
    return undefined;
  }

  const wrappedCommand = extractWrappedCommand(args);
  if (!wrappedCommand) {
    return undefined;
  }

  if (isDedicatedToolReadCommand(wrappedCommand)) {
    return "Use the dedicated file/search/list tools instead of shell wrappers for file reads, searches, or directory listings.";
  }

  return undefined;
}

function isShellWrapperCommand(commandName: string): boolean {
  return commandName === "bash" || commandName === "sh" || commandName === "zsh" || commandName === "python" || commandName === "python3";
}

function extractWrappedCommand(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "-c" || arg === "-lc") {
      return args[index + 1];
    }
  }

  const hereDocIndex = args.findIndex((arg) => arg === "-" || arg.startsWith("-"));
  if (hereDocIndex === -1) {
    return undefined;
  }

  return args.slice(hereDocIndex + 1).join(" ");
}

function isDedicatedToolReadCommand(command: string): boolean {
  return /(^|\b)(cat|ls|find|grep|rg)\b/.test(command) ||
    /open\s*\(|read_text\s*\(|read_bytes\s*\(|Path\([^)]*\)\.read_text\s*\(/.test(command);
}

function getDedicatedReadToolReason(commandName: string, args: string[]): string | undefined {
  if (commandName === "cat") {
    return 'Use the dedicated file/search/list tools instead of "cat" for file reads.';
  }

  if (commandName === "ls" || commandName === "find") {
    return `Use the dedicated file/search/list tools instead of "${commandName}" for directory listings.`;
  }

  if (commandName === "grep" || commandName === "rg") {
    return `Use the dedicated file/search/list tools instead of "${commandName}" for searches.`;
  }

  if (
    (commandName === "python" || commandName === "python3") &&
    isDedicatedToolReadCommand([commandName, ...args].join(" "))
  ) {
    return "Use the dedicated file/search/list tools instead of shell wrappers for file reads, searches, or directory listings.";
  }

  return undefined;
}

function isCdWrapper(commandName: string, args: string[]): boolean {
  return commandName === "cd" || (args.length > 0 && args[0] === "cd");
}

function getNestedReadOnlyCommand(
  commandName: string,
  args: string[]
): { commandName: string; args: string[] } | undefined {
  if (!isShellWrapperCommand(commandName)) {
    return undefined;
  }

  const wrappedCommand = extractWrappedCommand(args);
  if (!wrappedCommand) {
    return undefined;
  }

  try {
    const nestedParts = parseSingleCommandParts(wrappedCommand);
    const nestedCommandName = nestedParts[0];
    if (!nestedCommandName) {
      return undefined;
    }

    return { commandName: nestedCommandName, args: nestedParts.slice(1) };
  } catch {
    return undefined;
  }
}

function parseSingleCommandParts(command: string): string[] {
  const entries = parseShellCommand(command);
  const segment: string[] = [];

  for (const entry of entries) {
    if (typeof entry === "string") {
      segment.push(entry);
      continue;
    }

    throw new Error("Shell wrappers must contain exactly one simple command.");
  }

  return stripLeadingAssignments(segment);
}

function stripLeadingAssignments(tokens: string[]): string[] {
  let index = 0;

  while (index < tokens.length && isEnvironmentAssignment(tokens[index])) {
    index += 1;
  }

  return tokens.slice(index);
}

function isEnvironmentAssignment(token: string | undefined): boolean {
  if (!token) {
    return false;
  }

  const equalsIndex = token.indexOf("=");
  return equalsIndex > 0 && !token.startsWith("/") && !token.startsWith("./");
}

function isReadOnlyCommand(commandName: string, args: string[]): boolean {
  switch (commandName) {
    case "pwd":
    case "ls":
    case "cat":
    case "head":
    case "tail":
    case "grep":
    case "rg":
    case "find":
    case "stat":
    case "wc":
    case "sort":
    case "cut":
    case "uniq":
    case "which":
    case "whereis":
    case "basename":
    case "dirname":
    case "true":
    case "false":
    case "test":
    case "[":
    case "realpath":
    case "readlink":
    case "du":
      return true;
    case "git":
      return isReadOnlyGitCommand(args);
    default:
      return false;
  }
}

function isReadOnlyGitCommand(args: string[]): boolean {
  const parsed = parseGitCommand(args);
  if (!parsed || hasGitWriteOption(parsed.args)) {
    return false;
  }

  switch (parsed.subcommand) {
    case "status":
    case "diff":
    case "log":
    case "show":
    case "rev-parse":
    case "ls-files":
    case "grep":
    case "blame":
    case "merge-base":
    case "cat-file":
    case "reflog":
      return true;
    default:
      return false;
  }
}

function parseGitCommand(args: string[]): { subcommand: string; args: string[] } | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];

    if (!arg.startsWith("-")) {
      return { subcommand: arg, args: args.slice(index + 1) };
    }

    const consumedValues = getGitGlobalOptionValueCount(arg);
    if (consumedValues === 0) {
      continue;
    }

    if (index + consumedValues >= args.length) {
      return undefined;
    }

    index += consumedValues;
  }

  return undefined;
}

function getGitGlobalOptionValueCount(arg: string): number {
  switch (arg) {
    case "-C":
    case "-c":
    case "--git-dir":
    case "--work-tree":
    case "--namespace":
    case "--exec-path":
    case "--config-env":
      return 1;
    default:
      break;
  }

  if (
    arg.startsWith("-C") ||
    arg.startsWith("-c") ||
    arg.startsWith("--git-dir=") ||
    arg.startsWith("--work-tree=") ||
    arg.startsWith("--namespace=") ||
    arg.startsWith("--exec-path=") ||
    arg.startsWith("--config-env=")
  ) {
    return 0;
  }

  return 0;
}

function hasGitWriteOption(args: string[]): boolean {
  return args.some((arg) => arg === "--output" || arg.startsWith("--output="));
}

function getBlockedEditModeReason(commandName: string, args: string[]): string | undefined {
  if (commandName === "rm" && isRecursiveForceDelete(args)) {
    return 'Command "rm -rf" is blocked in edit mode.';
  }

  if (commandName === "git") {
    const subcommand = args.find((arg) => !arg.startsWith("-"));
    if (
      subcommand === "add" ||
      subcommand === "branch" ||
      subcommand === "checkout" ||
      subcommand === "cherry-pick" ||
      subcommand === "clean" ||
      subcommand === "commit" ||
      subcommand === "merge" ||
      subcommand === "push" ||
      subcommand === "rebase" ||
      subcommand === "reset" ||
      subcommand === "restore" ||
      subcommand === "stash" ||
      subcommand === "switch" ||
      subcommand === "tag"
    ) {
      return `Command "git ${subcommand}" is blocked in edit mode.`;
    }
  }

  if (commandName === "curl" && isCurlWrite(args)) {
    return 'Command "curl" is blocked in edit mode because it performs a network write.';
  }

  if (commandName === "wget" && isWgetWrite(args)) {
    return 'Command "wget" is blocked in edit mode because it performs a network write.';
  }
}

function isRecursiveForceDelete(args: string[]): boolean {
  let hasRecursive = false;
  let hasForce = false;

  for (const arg of args) {
    if (arg === "--recursive") {
      hasRecursive = true;
      continue;
    }

    if (arg === "--force") {
      hasForce = true;
      continue;
    }

    if (!arg.startsWith("-") || arg.startsWith("--")) {
      continue;
    }

    if (arg.includes("r") || arg.includes("R")) {
      hasRecursive = true;
    }

    if (arg.includes("f")) {
      hasForce = true;
    }
  }

  return hasRecursive && hasForce;
}

function isCurlWrite(args: string[]): boolean {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];

    if (
      arg === "-d" ||
      arg === "--data" ||
      arg === "--data-binary" ||
      arg === "--data-raw" ||
      arg === "-F" ||
      arg === "--form" ||
      arg === "-T" ||
      arg === "--upload-file" ||
      arg.startsWith("--data=") ||
      arg.startsWith("--data-binary=") ||
      arg.startsWith("--data-raw=") ||
      arg.startsWith("--form=") ||
      arg.startsWith("--upload-file=")
    ) {
      return true;
    }

    if ((arg === "-X" || arg === "--request") && next) {
      return !isReadOnlyHttpMethod(next);
    }

    if (arg.startsWith("--request=")) {
      return !isReadOnlyHttpMethod(arg.slice("--request=".length));
    }
  }

  return false;
}

function isWgetWrite(args: string[]): boolean {
  for (const arg of args) {
    if (
      arg === "--body-data" ||
      arg === "--body-file" ||
      arg === "--post-data" ||
      arg === "--post-file" ||
      arg.startsWith("--body-data=") ||
      arg.startsWith("--body-file=") ||
      arg.startsWith("--post-data=") ||
      arg.startsWith("--post-file=")
    ) {
      return true;
    }

    if (arg.startsWith("--method=")) {
      return !isReadOnlyHttpMethod(arg.slice("--method=".length));
    }
  }

  return false;
}

function isReadOnlyHttpMethod(method: string): boolean {
  const normalizedMethod = method.trim().toUpperCase();
  return (
    normalizedMethod === "GET" || normalizedMethod === "HEAD" || normalizedMethod === "OPTIONS"
  );
}

function toPolicyErrorMessage(error: unknown, mode: SpawnMode): string {
  if (error instanceof Error) {
    return `Unable to evaluate command policy in ${mode} mode: ${error.message}`;
  }

  return `Unable to evaluate command policy in ${mode} mode.`;
}

function formatBackgroundCommand(backgroundCommand: BackgroundCommand): string {
  const lines = [`Handle: ${backgroundCommand.handle}`, `Status: ${backgroundCommand.status}`];

  if (backgroundCommand.exitCode !== null) {
    lines.push(`Exit code: ${backgroundCommand.exitCode}`);
  }

  if (backgroundCommand.exitSignal !== null) {
    lines.push(`Signal: ${backgroundCommand.exitSignal}`);
  }

  if (backgroundCommand.timedOut) {
    lines.push("Timed out: true");
  }

  if (backgroundCommand.error) {
    lines.push(`Error: ${backgroundCommand.error}`);
  }

  lines.push("STDOUT:");
  lines.push(formatCapturedOutput(formatRetainedOutput(backgroundCommand.stdout)));
  lines.push("STDERR:");
  lines.push(formatCapturedOutput(formatRetainedOutput(backgroundCommand.stderr)));

  return lines.join("\n");
}

async function defaultRunCommand(
  command: string,
  cwd: string,
  options: RunCommandOptions
): Promise<string> {
  const spawned = spawnShellCommand(command, cwd, options);
  const outcome = await spawned.completion;

  if (outcome.timedOut) {
    throw new Error(
      getCommandTimeoutMessage(
        formatRetainedOutput(spawned.stdout),
        formatRetainedOutput(spawned.stderr),
        options.timeoutMs
      )
    );
  }

  if (outcome.aborted) {
    throw new Error("Command aborted");
  }

  if (outcome.error) {
    throw new Error(`Command failed: ${outcome.error.message}`);
  }

  if (outcome.exitCode !== 0) {
    throw new Error(
      getCommandFailureMessage(
        formatRetainedOutput(spawned.stdout),
        formatRetainedOutput(spawned.stderr),
        outcome
      )
    );
  }

  const combinedOutput = combineOutput(
    formatRetainedOutput(spawned.stdout),
    formatRetainedOutput(spawned.stderr)
  );
  return combinedOutput || "Command completed with no output";
}

function spawnShellCommand(
  command: string,
  cwd: string,
  options: {
    signal?: AbortSignal;
    timeoutMs: number;
    notify?: ToolContext["notify"];
    background?: boolean;
    handle?: string;
  }
): SpawnedCommand {
  const stdout = createRetainedShellOutput();
  const stderr = createRetainedShellOutput();
  let notificationError: Error | undefined;
  const child = spawn(command, {
    cwd,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
    ...(process.platform === "win32" ? {} : { detached: true })
  });

  const notify = (stream: ShellOutputNotification["data"]["stream"], message: string): void => {
    const notifyHook = options.notify;
    if (notifyHook === undefined || message.length === 0) {
      return;
    }

    void Promise.resolve()
      .then(() =>
        notifyHook({
          event: stream === "stdout" ? "shell.stdout" : "shell.stderr",
          message,
          data: {
            background: options.background ?? false,
            command,
            cwd,
            ...(options.handle === undefined ? {} : { handle: options.handle }),
            stream
          }
        } satisfies ShellOutputNotification)
      )
      .catch((error) => {
        if (notificationError === undefined) {
          notificationError = toError(error);
          terminate();
        }
      });
  };

  child.stdout?.setEncoding("utf8");
  child.stdout?.on("data", (chunk: string | Buffer) => {
    const value = chunk.toString();
    appendRetainedOutput(stdout, value);
    notify("stdout", value);
  });

  child.stderr?.setEncoding("utf8");
  child.stderr?.on("data", (chunk: string | Buffer) => {
    const value = chunk.toString();
    appendRetainedOutput(stderr, value);
    notify("stderr", value);
  });

  let terminated = false;
  let aborted = false;
  let timedOut = false;
  let escalationTimer: NodeJS.Timeout | undefined;

  const clearEscalationTimer = (): void => {
    if (escalationTimer === undefined) {
      return;
    }

    clearTimeout(escalationTimer);
    escalationTimer = undefined;
  };

  const killProcess = (signal: NodeJS.Signals): void => {
    try {
      if (process.platform !== "win32" && child.pid !== undefined) {
        process.kill(-child.pid, signal);
        return;
      }

      child.kill(signal);
    } catch {
      return;
    }
  };

  const terminate = (): void => {
    if (terminated) {
      return;
    }

    terminated = true;
    killProcess("SIGTERM");
    escalationTimer = setTimeout(() => {
      killProcess("SIGKILL");
    }, terminateGracePeriodMs);
  };

  const cleanupAbort = bindAbortSignal(options.signal, () => {
    aborted = true;
    terminate();
  });

  const timeout = setTimeout(() => {
    timedOut = true;
    terminate();
  }, options.timeoutMs);

  const completion = new Promise<SpawnedCommandOutcome>((resolve) => {
    const resolveOutcome = (outcome: SpawnedCommandOutcome): void => {
      resolve({
        ...outcome,
        ...(outcome.error === undefined && notificationError ? { error: notificationError } : {})
      });
    };

    child.once("error", (error) => {
      clearTimeout(timeout);
      clearEscalationTimer();
      cleanupAbort();
      resolveOutcome({
        aborted,
        timedOut,
        exitCode: null,
        exitSignal: null,
        error: error instanceof Error ? error : new Error(String(error))
      });
    });

    child.once("close", (code, signal) => {
      clearTimeout(timeout);
      clearEscalationTimer();
      cleanupAbort();
      resolveOutcome({
        aborted,
        timedOut,
        exitCode: code,
        exitSignal: signal,
        ...(notificationError === undefined ? {} : { error: notificationError })
      });
    });
  });

  return {
    stdout,
    stderr,
    terminate,
    completion
  };
}

function bindAbortSignal(signal: AbortSignal | undefined, onAbort: () => void): () => void {
  if (signal === undefined) {
    return () => {};
  }

  if (signal.aborted) {
    onAbort();
    return () => {};
  }

  signal.addEventListener("abort", onAbort, { once: true });

  return () => {
    signal.removeEventListener("abort", onAbort);
  };
}

function toError(error: unknown): Error {
  if (error instanceof Error) {
    return error;
  }

  return new Error(String(error));
}

function createRetainedShellOutput(): RetainedShellOutput {
  return {
    value: "",
    omittedChars: 0
  };
}

function appendRetainedOutput(output: RetainedShellOutput, chunk: string): void {
  if (chunk.length === 0) {
    return;
  }

  if (chunk.length >= maxRetainedOutputChars) {
    output.omittedChars += output.value.length + chunk.length - maxRetainedOutputChars;
    output.value = chunk.slice(-maxRetainedOutputChars);
    return;
  }

  const combinedLength = output.value.length + chunk.length;
  if (combinedLength <= maxRetainedOutputChars) {
    output.value += chunk;
    return;
  }

  const overflow = combinedLength - maxRetainedOutputChars;
  output.omittedChars += overflow;
  output.value = output.value.slice(overflow) + chunk;
}

function formatRetainedOutput(output: RetainedShellOutput): string {
  if (output.omittedChars === 0) {
    return output.value;
  }

  return `[output truncated: ${output.omittedChars} characters omitted]\n${output.value}`;
}

function combineOutput(stdout: string, stderr: string): string {
  return [stdout, stderr]
    .map((output) => output.trim())
    .filter((output) => output.length > 0)
    .join("\n");
}

function formatCapturedOutput(output: string): string {
  const trimmed = output.trim();
  return trimmed.length > 0 ? trimmed : "(empty)";
}

function getCommandFailureMessage(
  stdout: string,
  stderr: string,
  outcome: SpawnedCommandOutcome
): string {
  const combinedOutput = combineOutput(stdout, stderr);
  if (combinedOutput.length > 0) {
    return `Command failed: ${combinedOutput}`;
  }

  if (outcome.exitSignal !== null) {
    return `Command failed with signal ${outcome.exitSignal}`;
  }

  if (outcome.exitCode !== null) {
    return `Command failed with exit code ${outcome.exitCode}`;
  }

  return "Command failed";
}

function getCommandTimeoutMessage(stdout: string, stderr: string, timeoutMs: number): string {
  const message = `Command timed out after ${timeoutMs / 1_000} seconds`;
  const combinedOutput = combineOutput(stdout, stderr);
  return combinedOutput.length > 0 ? `${message}: ${combinedOutput}` : message;
}

export default shellPlugin;

export const spec: PluginSpec<ShellPluginConfigOptions> = {
  name: "shell",
  parseOptions(input) {
    const obj = toOptionsObject(input);
    rejectUnknownKeys(obj, ["cwd", "allowedPaths"]);
    const options: ShellPluginConfigOptions = {};
    const cwd = readOptionalString(obj, "cwd");
    if (cwd !== undefined) {
      options.cwd = cwd;
    }
    const allowedPaths = readOptionalStringArray(obj, "allowedPaths");
    if (allowedPaths !== undefined) {
      options.allowedPaths = allowedPaths;
    }
    return options;
  },
  factory: options => shellPlugin(options),
};
