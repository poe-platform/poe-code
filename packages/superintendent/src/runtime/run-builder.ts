import path from "node:path";
import { spawn, type SpawnMode } from "@poe-code/agent-spawn";
import type { SuperintendentDoc } from "../document/parse.js";
import { resolveTemplate, type TemplateContext } from "./templates.js";

export type BuilderResult = {
  summary: string;
  log: string;
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
      log?: unknown;
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

export async function runBuilder(
  doc: SuperintendentDoc,
  context: Partial<TemplateContext>
): Promise<BuilderResult> {
  const prompt = resolveTemplate(doc.frontmatter.builder.prompt, buildTemplateContext(doc, context));
  const result = await runAutonomous({
    agent: doc.frontmatter.builder.agent,
    mode: doc.frontmatter.builder.mode,
    prompt,
    cwd: path.dirname(doc.filePath)
  });
  const log = extractLog(result);

  return {
    summary: extractSummary(result, log),
    log
  };
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

function extractLog(result: AutonomousOutput): string {
  if (typeof result === "string") {
    return result;
  }

  return readString(result.log) ?? readString(result.output) ?? readString(result.stdout) ?? readString(result.text) ?? "";
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
