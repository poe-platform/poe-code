import { spawn, type McpSpawnConfig, type SpawnMode } from "@poe-code/agent-spawn";
import type { AgentRoleConfig, SuperintendentDoc } from "../document/parse.js";
import { resolveRoleCwd } from "./resolve-cwd.js";
import { buildInspectorSystemPrompt, prependSystemPrompt } from "./system-prompt.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";

export type InspectorResult = {
  name: string;
  summary: string;
  log_path?: string;
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

export type RunInspectorOptions = {
  promptOverride?: string;
  defaultCwd: string;
  logDir?: string;
  logFileName?: string;
};

export async function runInspector(
  name: string,
  config: AgentRoleConfig,
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>,
  options: RunInspectorOptions
): Promise<InspectorResult> {
  const userPrompt =
    options.promptOverride ??
    resolveTemplate(config.prompt, buildTemplateContext(doc, context));
  const systemPrompt = buildInspectorSystemPrompt({
    inspectorName: name,
    ...(context.builder
      ? {
          builder: {
            summary: context.builder.summary,
            ...(context.builder.log_path ? { log_path: context.builder.log_path } : {})
          }
        }
      : {})
  });
  const prompt = prependSystemPrompt(systemPrompt, userPrompt);
  const output = await runAutonomous({
    agent: config.agent,
    mode: config.mode,
    prompt,
    cwd: resolveRoleCwd(config, doc.filePath, options.defaultCwd),
    mcpServers: buildMcpServers(doc, config),
    ...(options.logDir ? { logDir: options.logDir } : {}),
    ...(options.logFileName ? { logFileName: options.logFileName } : {})
  });

  const logPath = extractLogPath(output);
  return {
    name,
    summary: extractSummary(output),
    ...(logPath ? { log_path: logPath } : {})
  };
}

function buildMcpServers(
  doc: SuperintendentDoc,
  config: AgentRoleConfig
): McpSpawnConfig | undefined {
  const merged = {
    ...(doc.frontmatter.mcp ?? {}),
    ...(config.mcp ?? {})
  };

  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  const servers: McpSpawnConfig = {};

  for (const [name, mcpConfig] of Object.entries(merged)) {
    servers[name] = {
      command: mcpConfig.command,
      ...(mcpConfig.args ? { args: [...mcpConfig.args] } : {}),
      ...(mcpConfig.timeout !== undefined ? { timeout: mcpConfig.timeout } : {})
    };
  }

  return servers;
}

export async function runAllInspectors(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>,
  options: { defaultCwd: string }
): Promise<InspectorResult[]> {
  const inspectors = doc.frontmatter.inspectors;

  if (inspectors === undefined) {
    return [];
  }

  const inspectorSummaries = { ...(context.inspectors ?? {}) };
  const results: InspectorResult[] = [];

  for (const [name, config] of Object.entries(inspectors)) {
    const result = await runInspector(
      name,
      config,
      doc,
      {
        ...context,
        inspectors: inspectorSummaries
      },
      options
    );

    results.push(result);
    inspectorSummaries[name] = result.summary;
  }

  return results;
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

function extractLogPath(result: AutonomousOutput): string | undefined {
  if (typeof result === "string") return undefined;
  return typeof result.logFile === "string" ? result.logFile : undefined;
}

function extractSummary(result: AutonomousOutput): string {
  if (typeof result === "string") {
    return result;
  }

  return (
    readString(result.summary) ??
    readString(result.output) ??
    readString(result.stdout) ??
    readString(result.text) ??
    ""
  );
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}
