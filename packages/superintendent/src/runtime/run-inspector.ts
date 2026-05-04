import "@poe-code/agent-spawn/register-factories";
import type { AgentRunnerSession } from "@poe-code/agent-harness-tools";
import type { AgentRoleConfig, SuperintendentDoc } from "../document/parse.js";
import { runAutonomousAgent, type AutonomousOutput, type McpSpawnConfig } from "./agent-runner.js";
import { resolveRoleCwd } from "./resolve-cwd.js";
import { buildInspectorSystemPrompt, prependSystemPrompt } from "./system-prompt.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";

export type InspectorResult = {
  name: string;
  summary: string;
  log_path?: string;
};

export type RunInspectorOptions = {
  promptOverride?: string;
  defaultCwd: string;
  logPath?: string;
  agentSession?: AgentRunnerSession;
};

export async function runInspector(
  name: string,
  config: AgentRoleConfig,
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>,
  options: RunInspectorOptions
): Promise<InspectorResult> {
  const userPrompt =
    options.promptOverride ?? resolveTemplate(config.prompt, buildTemplateContext(doc, context));
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
  const output = await runAutonomousAgent({
    agent: config.agent,
    mode: config.mode,
    prompt,
    cwd: resolveRoleCwd(config, doc.filePath, options.defaultCwd),
    mcpServers: buildMcpServers(doc, config),
    ...(options.logPath ? { logPath: options.logPath } : {}),
    ...(options.agentSession ? { session: options.agentSession } : {})
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
  options: { defaultCwd: string; agentSession?: AgentRunnerSession }
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
