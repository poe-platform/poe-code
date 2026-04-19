import { spawn, type McpSpawnConfig, type SpawnMode } from "@poe-code/agent-spawn";
import type { SuperintendentDoc } from "../document/parse.js";
import { resolveRoleCwd } from "./resolve-cwd.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";

export type BuilderResult = {
  summary: string;
  log: string;
  log_path: string;
};

type AutonomousInput = {
  agent: string;
  mode?: string;
  prompt: string;
  cwd?: string;
  mcpServers?: McpSpawnConfig;
  logDir?: string;
  logFileName?: string;
};

type AutonomousOutput =
  | string
  | {
      summary?: unknown;
      log?: unknown;
      output?: unknown;
      stdout?: unknown;
      text?: unknown;
      logFile?: unknown;
    };

type SpawnWithAutonomous = typeof spawn & {
  autonomous?: (
    agent: string,
    options: Omit<AutonomousInput, "agent">
  ) => Promise<AutonomousOutput>;
};

export type RunBuilderOptions = {
  promptOverride?: string;
  logDir?: string;
  logFileName?: string;
};

export async function runBuilder(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>,
  options: RunBuilderOptions = {}
): Promise<BuilderResult> {
  const prompt =
    options.promptOverride ??
    resolveTemplate(doc.frontmatter.builder.prompt, buildTemplateContext(doc, context));
  const result = await runAutonomous({
    agent: doc.frontmatter.builder.agent,
    mode: doc.frontmatter.builder.mode,
    prompt,
    cwd: resolveRoleCwd(doc.frontmatter.builder, doc.filePath),
    mcpServers: buildMcpServers(doc),
    ...(options.logDir ? { logDir: options.logDir } : {}),
    ...(options.logFileName ? { logFileName: options.logFileName } : {})
  });
  const log = extractLog(result);

  return {
    summary: extractSummary(result, log),
    log,
    log_path: extractLogPath(result)
  };
}

function buildMcpServers(doc: SuperintendentDoc): McpSpawnConfig | undefined {
  const merged = {
    ...(doc.frontmatter.mcp ?? {}),
    ...(doc.frontmatter.builder.mcp ?? {})
  };

  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  const servers: McpSpawnConfig = {};

  for (const [name, config] of Object.entries(merged)) {
    servers[name] = {
      command: config.command,
      ...(config.args ? { args: [...config.args] } : {}),
      ...(config.timeout !== undefined ? { timeout: config.timeout } : {})
    };
  }

  return servers;
}

function buildTemplateContext(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>
): Partial<TemplateContext> {
  return {
    ...context,
    plan: {
      ...(context.plan ?? { path: doc.filePath }),
      path: doc.filePath
    }
  };
}

async function runAutonomous(input: AutonomousInput): Promise<AutonomousOutput> {
  const spawnApi = spawn as SpawnWithAutonomous;

  if (typeof spawnApi.autonomous === "function") {
    return spawnApi.autonomous(input.agent, {
      cwd: input.cwd,
      prompt: input.prompt,
      mode: input.mode,
      ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
      ...(input.logDir ? { logDir: input.logDir } : {}),
      ...(input.logFileName ? { logFileName: input.logFileName } : {})
    });
  }

  const result = await spawn(input.agent, {
    cwd: input.cwd,
    prompt: input.prompt,
    mode: input.mode as SpawnMode | undefined,
    ...(input.mcpServers ? { mcpServers: input.mcpServers } : {}),
    ...(input.logDir ? { logDir: input.logDir } : {}),
    ...(input.logFileName ? { logFileName: input.logFileName } : {})
  });

  return {
    stdout: result.stdout,
    ...(result.logFile ? { logFile: result.logFile } : {})
  };
}

function extractLog(result: AutonomousOutput): string {
  if (typeof result === "string") {
    return result;
  }

  return readString(result.log) ?? readString(result.output) ?? readString(result.stdout) ?? readString(result.text) ?? "";
}

function extractLogPath(result: AutonomousOutput): string {
  if (typeof result === "string") {
    return "";
  }

  return readString(result.logFile) ?? "";
}

function extractSummary(result: AutonomousOutput, log: string): string {
  if (typeof result !== "string") {
    const explicitSummary = readString(result.summary)?.trim();

    if (explicitSummary) {
      return explicitSummary;
    }
  }

  const firstNonEmptyLine = log
    .split("\n")
    .map((line) => (line.endsWith("\r") ? line.slice(0, -1) : line).trim())
    .find((line) => line.length > 0);

  return firstNonEmptyLine ?? "Builder completed without output.";
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
