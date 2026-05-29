import "@poe-code/agent-spawn/register-factories";
import type { SuperintendentDoc } from "../document/parse.js";
import {
  runAutonomousAgent,
  type AutonomousOutput,
  type McpSpawnConfig
} from "./agent-runner.js";
import { resolveRoleCwd } from "./resolve-cwd.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";

export type BuilderResult = {
  summary: string;
  log: string;
  log_path: string;
};

export type RunBuilderOptions = {
  promptOverride?: string;
  defaultCwd: string;
  logPath?: string;
};

export async function runBuilder(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>,
  options: RunBuilderOptions
): Promise<BuilderResult> {
  const prompt =
    options.promptOverride ??
    resolveTemplate(doc.frontmatter.builder.prompt, buildTemplateContext(doc, context));
  const result = await runAutonomousAgent({
    agent: doc.frontmatter.builder.agent,
    mode: doc.frontmatter.builder.mode,
    prompt,
    cwd: resolveRoleCwd(doc.frontmatter.builder, doc.filePath, options.defaultCwd),
    mcpServers: buildMcpServers(doc),
    ...(options.logPath ? { logPath: options.logPath } : {})
  });
  const log = extractLog(result);

  return {
    summary: extractSummary(result, log),
    log,
    log_path: extractLogPath(result, options)
  };
}

function buildMcpServers(doc: SuperintendentDoc): McpSpawnConfig | undefined {
  const merged = Object.assign(
    Object.create(null) as NonNullable<SuperintendentDoc["frontmatter"]["mcp"]>,
    doc.frontmatter.mcp,
    doc.frontmatter.builder.mcp
  );

  if (Object.keys(merged).length === 0) {
    return undefined;
  }

  const servers = Object.create(null) as McpSpawnConfig;

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

function extractLog(result: AutonomousOutput): string {
  if (typeof result === "string") {
    return result;
  }

  return readString(result.log) ?? readString(result.output) ?? readString(result.stdout) ?? readString(result.text) ?? "";
}

function extractLogPath(result: AutonomousOutput, options: RunBuilderOptions): string {
  if (typeof result !== "string") {
    const logFile = readString(result.logFile);

    if (logFile) {
      return logFile;
    }
  }

  return options.logPath ?? "";
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
