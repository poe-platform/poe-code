import { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import parseDuration from "parse-duration";
import { collectHumanPromptsWithStats, writeHumanPromptJsonl } from "@poe-code/agent-traces";
import { spawn as defaultSpawn } from "@poe-code/agent-spawn";
import { parseGaslightConfig } from "./config.js";
import type {
  GaslightCollectHumanPrompts,
  GaslightFileSystem,
  GaslightIngestOptions,
  GaslightIngestResult,
  GaslightSpawn
} from "./types.js";

type WritableGaslightFileSystem = GaslightFileSystem & {
  rename?(oldPath: string, newPath: string): Promise<void>;
};

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function exists(fs: Pick<GaslightFileSystem, "stat">, filePath: string): Promise<boolean> {
  try {
    return (await fs.stat(filePath)).isFile();
  } catch (error) {
    if (isMissingFile(error)) {
      return false;
    }
    throw error;
  }
}

function sanitizeAgentForFileName(agent: string): string {
  const parts: string[] = [];
  let previousWasDash = false;
  for (const char of agent.toLowerCase()) {
    const code = char.charCodeAt(0);
    const isLowercaseLetter = code >= 97 && code <= 122;
    const isNumber = code >= 48 && code <= 57;
    if (isLowercaseLetter || isNumber) {
      parts.push(char);
      previousWasDash = false;
      continue;
    }
    if (!previousWasDash) {
      parts.push("-");
      previousWasDash = true;
    }
  }
  while (parts[0] === "-") {
    parts.shift();
  }
  while (parts[parts.length - 1] === "-") {
    parts.pop();
  }
  return parts.join("") || "agent";
}

function resolvePath(cwd: string, filePath: string): string {
  return path.isAbsolute(filePath) ? filePath : path.join(cwd, filePath);
}

async function resolveOutputPath(
  fs: GaslightFileSystem,
  cwd: string,
  analysisAgent: string,
  outputPath?: string
): Promise<{ absolutePath: string; resultPath: string }> {
  if (outputPath) {
    const absolutePath = resolvePath(cwd, outputPath);
    return { absolutePath, resultPath: outputPath };
  }

  const configDirectory = path.join(cwd, ".poe-code");
  const defaultPath = path.join(configDirectory, "gaslight.yaml");
  if (!(await exists(fs, defaultPath))) {
    return { absolutePath: defaultPath, resultPath: ".poe-code/gaslight.yaml" };
  }

  const prefix = sanitizeAgentForFileName(analysisAgent);
  let index = 1;
  while (true) {
    const basename = index === 1 ? `${prefix}-gaslight.yaml` : `${prefix}-gaslight-${index}.yaml`;
    const candidate = path.join(configDirectory, basename);
    if (!(await exists(fs, candidate))) {
      return { absolutePath: candidate, resultPath: path.join(".poe-code", basename) };
    }
    index += 1;
  }
}

function resolveSince(value: string | Date | undefined): Date | undefined {
  if (value === undefined) {
    const milliseconds = parseDuration("30d");
    return milliseconds === null ? undefined : new Date(Date.now() - milliseconds);
  }
  if (value instanceof Date) {
    return value;
  }
  const milliseconds = parseDuration(value);
  if (milliseconds === null || milliseconds <= 0) {
    throw new Error(`Invalid since duration "${value}".`);
  }
  return new Date(Date.now() - milliseconds);
}

async function resolveDataPath(
  cwd: string,
  keepDataPath: string | undefined
): Promise<{ absolutePath: string; resultPath: string }> {
  if (keepDataPath) {
    const absolutePath = resolvePath(cwd, keepDataPath);
    return { absolutePath, resultPath: keepDataPath };
  }
  const resultPath = path.join(
    ".poe-code",
    "ingest",
    `human-prompts-${process.pid}-${Date.now()}-${process.hrtime.bigint()}.jsonl`
  );
  return { absolutePath: path.join(cwd, resultPath), resultPath };
}

function buildAnalysisPrompt(dataPath: string): string {
  return [
    "Read this JSONL file of human prompts from coding-agent traces:",
    dataPath,
    "",
    "Generate a gaslight.yaml file that captures recurring follow-up prompts the human uses after agent work.",
    "Return only YAML with this exact shape:",
    "prompt: <string>",
    "followups:",
    "  - <string>",
    "",
    "Rules:",
    "- Prefer concise followups that generalize across tasks.",
    "- Do not include project secrets, file paths, names, tokens, or one-off task details.",
    "- Preserve the user's direct style when it is reusable.",
    "- Use 3 to 8 followups."
  ].join("\n");
}

function stripMarkdownFence(value: string): string {
  const lines = value.trim().split("\n");
  if (
    lines.length >= 2 &&
    lines[0]?.startsWith("```") &&
    lines[lines.length - 1]?.startsWith("```")
  ) {
    return lines.slice(1, -1).join("\n").trim();
  }
  return value.trim();
}

function extractFencedYaml(value: string): string | undefined {
  const match = value.match(/```(?:yaml|yml)?\s*\n([\s\S]*?)\n```/i);
  return match?.[1]?.trim();
}

function extractPromptSection(value: string): string | undefined {
  const lines = value.trim().split("\n");
  const startIndex = lines.findIndex((line) => /^\s*prompt\s*:/.test(line));
  if (startIndex === -1) {
    return undefined;
  }

  const selected: string[] = [];
  let sawFollowups = false;
  for (const line of lines.slice(startIndex)) {
    if (/^\s*followups\s*:/.test(line)) {
      sawFollowups = true;
      selected.push(line);
      continue;
    }
    if (
      sawFollowups &&
      line.trim().length > 0 &&
      !line.startsWith(" ") &&
      !line.startsWith("-") &&
      !/^\s*-\s+/.test(line)
    ) {
      break;
    }
    selected.push(line);
  }

  return selected.join("\n").trim();
}

function extractYamlCandidate(value: string): string {
  const trimmed = value.trim();
  return extractFencedYaml(trimmed) ?? extractPromptSection(trimmed) ?? stripMarkdownFence(trimmed);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function extractTextBlocks(value: unknown): string[] {
  if (typeof value === "string") {
    return [value];
  }
  if (!Array.isArray(value)) {
    return [];
  }
  const blocks: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      blocks.push(item);
      continue;
    }
    const record = asRecord(item);
    if (
      record?.type === "text" &&
      typeof record.text === "string" &&
      record.text.trim().length > 0
    ) {
      blocks.push(record.text);
    }
  }
  return blocks;
}

function extractAgentMessagesFromJsonl(value: string): string | undefined {
  const messages: string[] = [];
  for (const rawLine of value.split("\n")) {
    const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1).trim() : rawLine.trim();
    if (line.length === 0) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(line) as unknown;
    } catch {
      return undefined;
    }
    const record = asRecord(parsed);
    const item = asRecord(record?.item);
    if (
      record?.type === "item.completed" &&
      item?.type === "agent_message" &&
      typeof item.text === "string" &&
      item.text.trim().length > 0
    ) {
      messages.push(item.text.trim());
      continue;
    }

    const message = asRecord(record?.message);
    if (record?.type === "assistant" && message) {
      for (const text of extractTextBlocks(message.content)) {
        if (text.trim().length > 0) {
          messages.push(text.trim());
        }
      }
    }
  }
  return messages.length === 0 ? undefined : messages.join("\n");
}

function extractGeneratedConfigContent(stdout: string): string {
  return extractAgentMessagesFromJsonl(stdout) ?? stdout;
}

async function writeGeneratedConfig(
  fs: WritableGaslightFileSystem,
  content: string,
  absoluteOutputPath: string
): Promise<void> {
  const yaml = extractYamlCandidate(extractGeneratedConfigContent(content));
  parseGaslightConfig(yaml, "generated gaslight config", { rejectExtraKeys: true });
  await fs.mkdir(path.dirname(absoluteOutputPath), { recursive: true });
  const temporaryPath = `${absoluteOutputPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${yaml}\n`, { encoding: "utf8" });
  if (fs.rename) {
    await fs.rename(temporaryPath, absoluteOutputPath);
    return;
  }
  await fs.writeFile(absoluteOutputPath, `${yaml}\n`, { encoding: "utf8" });
}

export async function ingestGaslight(
  options: GaslightIngestOptions
): Promise<GaslightIngestResult> {
  const cwd = options.cwd ?? process.cwd();
  const homeDir = options.homeDir ?? os.homedir();
  const fs = (options.fs ?? nodeFs) as WritableGaslightFileSystem;
  const spawn: GaslightSpawn = options.spawn ?? defaultSpawn;
  const collectHumanPrompts: GaslightCollectHumanPrompts =
    options.collectHumanPrompts ?? collectHumanPromptsWithStats;
  const since = resolveSince(options.since);

  const collection = await collectHumanPrompts({
    sources: options.sources,
    cwd,
    homeDir,
    since,
    limit: options.limit ?? 200,
    allWorkspaces: options.allWorkspaces,
    fs
  });
  options.onEvent?.({ type: "traces.discovered", count: collection.traceCount });
  options.onEvent?.({
    type: "prompts.extracted",
    traces: collection.traceCount,
    prompts: collection.records.length
  });

  if (collection.records.length === 0) {
    throw new Error("No human prompts found in selected traces.");
  }

  const dataPath = await resolveDataPath(cwd, options.keepDataPath);
  await writeHumanPromptJsonl(collection.records, dataPath.absolutePath, fs);

  options.onEvent?.({
    type: "analysis.started",
    agent: options.analysisAgent,
    dataPath: dataPath.absolutePath
  });
  const result = await spawn(options.analysisAgent, {
    prompt: buildAnalysisPrompt(dataPath.absolutePath),
    cwd,
    mode: "read",
    ...(options.model ? { model: options.model } : {})
  });
  if (result.exitCode !== 0) {
    const message = result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
    throw new Error(`Gaslight ingest analysis failed: ${message}`);
  }

  const outputPath = await resolveOutputPath(fs, cwd, options.analysisAgent, options.outputPath);
  await writeGeneratedConfig(fs, result.stdout, outputPath.absolutePath);
  options.onEvent?.({ type: "config.written", path: outputPath.resultPath });

  return {
    outputPath: outputPath.resultPath,
    dataPath: dataPath.resultPath,
    promptCount: collection.records.length,
    traceCount: collection.traceCount
  };
}
