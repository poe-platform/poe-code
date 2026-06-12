import os from "node:os";
import path from "node:path";
import fsPromises from "node:fs/promises";
import { Command } from "commander";
import { renderAcpStream, type McpSpawnConfig } from "@poe-code/agent-spawn";
import { log } from "toolcraft-design";
import {
  createConfigStore,
  resolveConfigPath,
  resolveProjectConfigPath
} from "@poe-code/poe-code-config";
import type { FileSystem } from "../utils/file-system.js";
import { agentConfigScope } from "../services/config.js";
import { FEEDBACK_URL } from "./constants.js";
import { ValidationError } from "./errors.js";

function parseMcpSpawnConfig(input?: string): McpSpawnConfig | undefined {
  if (!input) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ValidationError(
      "--mcp-servers must be valid JSON in this shape: {name: {command, args?, env?}}"
    );
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new ValidationError(
      "--mcp-servers must be an object in this shape: {name: {command, args?, env?}}"
    );
  }

  const servers: McpSpawnConfig = {};
  for (const [name, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new ValidationError(
        `--mcp-servers entry "${name}" must be an object: {command, args?, env?}`
      );
    }

    const entry = value as Record<string, unknown>;
    const command = entry.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new ValidationError(
        `--mcp-servers entry "${name}" must include a non-empty string "command"`
      );
    }

    let args: string[] | undefined;
    if ("args" in entry && entry.args !== undefined) {
      if (!Array.isArray(entry.args) || entry.args.some((a: unknown) => typeof a !== "string")) {
        throw new ValidationError(`--mcp-servers entry "${name}".args must be an array of strings`);
      }
      args = entry.args as string[];
    }

    let env: Record<string, string> | undefined;
    if ("env" in entry && entry.env !== undefined) {
      if (typeof entry.env !== "object" || entry.env === null || Array.isArray(entry.env)) {
        throw new ValidationError(
          `--mcp-servers entry "${name}".env must be an object of string values`
        );
      }
      const entries = Object.entries(entry.env as Record<string, unknown>);
      for (const [, envValue] of entries) {
        if (typeof envValue !== "string") {
          throw new ValidationError(
            `--mcp-servers entry "${name}".env must be an object of string values`
          );
        }
      }
      env = Object.fromEntries(entries) as Record<string, string>;
    }

    Object.defineProperty(servers, name, {
      value: {
        command,
        ...(args ? { args } : {}),
        ...(env ? { env } : {})
      },
      enumerable: true,
      configurable: true,
      writable: true
    });
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}

function resolveWorkingDirectory(baseDir: string, candidate?: string): string | undefined {
  if (!candidate || candidate.trim().length === 0) {
    return undefined;
  }
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.resolve(baseDir, candidate);
}

type PoeAgentConfigFs = Pick<FileSystem, "mkdir" | "readFile" | "writeFile">;

interface PoeAgentProgramOptions {
  cwd?: string;
  homeDir?: string;
  fs?: PoeAgentConfigFs;
}

type PoeAgentRunCommandOptions = {
  yes?: boolean;
  model?: string;
  prompt?: string;
  cwd?: string;
  stdin?: boolean;
  mcpServers?: string;
  mcpConfig?: string;
  resumeThreadId?: string;
};

function configurePoeAgentRunOptions(command: Command): Command {
  return command
    .option("-y, --yes", "Accept configured defaults without prompting")
    .option("--model <model>", "Model identifier override")
    .option("--prompt <text>", "Prompt text to send")
    .option("-C, --cwd <path>", "Working directory for the agent")
    .option("--stdin", "Read the prompt from stdin")
    .option("--resume-thread-id <id>", "Resume a prior poe-agent thread")
    .option("--mcp-servers <json>", "MCP server config JSON: {name: {command, args?, env?}}")
    .option("--mcp-config <json>", "[deprecated: use --mcp-servers]")
    .argument("[prompt]", "Prompt text to send (or '-' / stdin)")
    .argument("[args...]", "Additional arguments forwarded to the agent");
}

async function runPoeAgentCommand(options: {
  baseDir: string;
  homeDir: string;
  fs: PoeAgentConfigFs;
  promptText?: string;
  commandOptions: PoeAgentRunCommandOptions;
}): Promise<void> {
  const mcpServers = parseMcpSpawnConfig(
    options.commandOptions.mcpServers ?? options.commandOptions.mcpConfig
  );
  const cwdOverride = resolveWorkingDirectory(options.baseDir, options.commandOptions.cwd);
  const cwd = cwdOverride ?? options.baseDir;
  const configStore = createConfigStore({
    fs: options.fs as unknown as Parameters<typeof createConfigStore>[0]["fs"],
    filePath: resolveConfigPath(options.homeDir),
    projectFilePath: resolveProjectConfigPath(cwd)
  });
  const configuredModel = (await configStore.scope(agentConfigScope).get("model")).trim();
  const model =
    options.commandOptions.model ??
    (options.commandOptions.resumeThreadId ? undefined : configuredModel || undefined);

  if (options.commandOptions.yes && !options.commandOptions.resumeThreadId && !model) {
    throw new ValidationError(
      "Error: --model is required in non-interactive mode (--yes) and no agent.model is configured."
    );
  }

  let promptText = options.commandOptions.prompt ?? options.promptText;
  const wantsStdinFlag = options.commandOptions.stdin === true;
  const shouldReadFromStdin =
    wantsStdinFlag || promptText === "-" || (!promptText && !process.stdin.isTTY);

  if (wantsStdinFlag || promptText === "-") {
    promptText = undefined;
  }

  if (!promptText && shouldReadFromStdin) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    promptText = Buffer.concat(chunks).toString("utf8").trim();
  }

  if (!promptText) {
    throw new ValidationError("No prompt provided via argument or stdin");
  }

  const { spawnPoeAgentWithAcp } = await import("../providers/poe-agent.js");

  const { events, done } = spawnPoeAgentWithAcp({
    prompt: promptText,
    model,
    cwd,
    resumeThreadId: options.commandOptions.resumeThreadId,
    mcpServers,
    homeDir: options.homeDir,
    configPath: resolveConfigPath(options.homeDir),
    projectConfigPath: resolveProjectConfigPath(cwd),
    fs: options.fs
  });

  await renderAcpStream(events);

  const result = await done;

  if (result.exitCode !== 0) {
    const detail = result.stderr.trim() || result.stdout.trim();
    const suffix = detail ? `: ${detail}` : "";
    throw new Error(`poe-agent failed with exit code ${result.exitCode}${suffix}`);
  }

  const trimmedStdout = result.stdout.trim();
  if (trimmedStdout) {
    log.info(trimmedStdout);
  }
  if (result.threadId) {
    log.info(`Resume: poe-agent --resume-thread-id ${result.threadId}`);
  }

  process.exitCode = result.exitCode;
}

export function createPoeAgentProgram(options: PoeAgentProgramOptions = {}): Command {
  const program = new Command();
  const baseDir = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const fs = options.fs ?? (fsPromises as unknown as PoeAgentConfigFs);

  const runAction = async function (
    promptText: string | undefined,
    _args: string[] = [],
    commandOptions: PoeAgentRunCommandOptions
  ) {
    await runPoeAgentCommand({
      baseDir,
      homeDir,
      fs,
      promptText,
      commandOptions
    });
  };

  configurePoeAgentRunOptions(
    program
      .name("poe-agent")
      .description("Run a single prompt through the Poe agent runtime.")
      .version("0.0.0")
  ).action(runAction);

  return program;
}

export function normalizePoeAgentArgv(argv: string[]): string[] {
  if (argv[2] !== "run") {
    return argv;
  }

  return [argv[0] ?? "node", argv[1] ?? "poe-agent", ...argv.slice(3)];
}

export async function poeAgentMain(): Promise<void> {
  const program = createPoeAgentProgram();

  try {
    await program.parseAsync(normalizePoeAgentArgv(process.argv));
  } catch (error) {
    if (error instanceof Error) {
      if (error instanceof ValidationError) {
        log.error(error.message);
      } else {
        log.error(`Error: ${error.message}`);
      }
      log.message(`Problems? ${FEEDBACK_URL}`);
      process.exit(1);
    }
    throw error;
  }
}
