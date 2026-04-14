import path from "node:path";
import { spawn, type SpawnMode } from "@poe-code/agent-spawn";
import type { AgentRoleConfig, SuperintendentDoc } from "../document/parse.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";

export type InspectorResult = {
  name: string;
  summary: string;
};

type AutonomousInput = {
  agent: string;
  mode?: string;
  prompt: string;
  cwd?: string;
};

type AutonomousOutput =
  | string
  | {
      summary?: unknown;
      output?: unknown;
      stdout?: unknown;
      text?: unknown;
    };

type SpawnWithAutonomous = typeof spawn & {
  autonomous?: (
    agent: string,
    options: Omit<AutonomousInput, "agent">
  ) => Promise<AutonomousOutput>;
};

export async function runInspector(
  name: string,
  config: AgentRoleConfig,
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>
): Promise<InspectorResult> {
  const prompt = resolveTemplate(config.prompt, buildTemplateContext(doc, context));
  const output = await runAutonomous({
    agent: config.agent,
    mode: config.mode,
    prompt,
    cwd: path.dirname(doc.filePath)
  });

  return {
    name,
    summary: extractSummary(output)
  };
}

export async function runAllInspectors(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>
): Promise<InspectorResult[]> {
  const inspectors = doc.frontmatter.inspectors;

  if (inspectors === undefined) {
    return [];
  }

  const inspectorSummaries = { ...(context.inspectors ?? {}) };
  const results: InspectorResult[] = [];

  for (const [name, config] of Object.entries(inspectors)) {
    const result = await runInspector(name, config, doc, {
      ...context,
      inspectors: inspectorSummaries
    });

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
      mode: input.mode
    });
  }

  const result = await spawn(input.agent, {
    cwd: input.cwd,
    prompt: input.prompt,
    mode: input.mode as SpawnMode | undefined
  });

  return {
    stdout: result.stdout
  };
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
