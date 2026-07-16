import { promises as nodeFs } from "node:fs";
import os from "node:os";
import path from "node:path";
import parseDuration from "parse-duration";
import { collectHumanPromptsWithStats } from "@poe-code/agent-traces";
import { spawn as defaultSpawn } from "@poe-code/agent-spawn";
import { parseGaslightConfig } from "./config.js";
import type { HumanPromptRecord } from "@poe-code/agent-traces";
import type {
  GaslightCollectHumanPrompts,
  GaslightFileSystem,
  GaslightIngestOptions,
  GaslightIngestResult,
  GaslightSpawn
} from "./types.js";

type WritableGaslightFileSystem = GaslightFileSystem & {
  lstat?(path: string): Promise<{ isSymbolicLink(): boolean }>;
  unlink?(path: string): Promise<void>;
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

function requireNonEmptyString(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return trimmed;
}

function resolveOptionalNonEmptyString(
  value: string | undefined,
  label: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    throw new Error(`${label} must be a non-empty string when provided.`);
  }
  return trimmed;
}

async function resolveOutputPath(
  fs: GaslightFileSystem,
  cwd: string,
  analysisAgent: string,
  outputPath?: string
): Promise<{ absolutePath: string; resultPath: string }> {
  const normalizedOutputPath = resolveOptionalNonEmptyString(outputPath, "outputPath");
  if (normalizedOutputPath) {
    const absolutePath = resolvePath(cwd, normalizedOutputPath);
    return { absolutePath, resultPath: normalizedOutputPath };
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
    if (!Number.isFinite(value.getTime())) {
      throw new Error(`Invalid since date "${String(value)}".`);
    }
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
    `human-prompts-${process.pid}-${Date.now()}-${process.hrtime.bigint()}.md`
  );
  return { absolutePath: path.join(cwd, resultPath), resultPath };
}

function resolveLimit(value: number | undefined): number {
  const limit = value ?? 200;
  if (!Number.isInteger(limit) || limit <= 0) {
    throw new Error("limit must be a positive integer.");
  }
  return limit;
}

function buildAnalysisPrompt(dataPath: string): string {
  return [
    "Read this curated Markdown file of human prompts from coding-agent traces:",
    dataPath,
    "",
    "Generate a gaslight.yaml file that captures recurring follow-up prompts the human uses after agent work.",
    "Be clever: infer workflow-level prompts from the evidence instead of copying frequent strings.",
    "Return only YAML with this exact shape:",
    "prompt: <string>",
    "followups:",
    "  - <string>",
    "",
    "Rules:",
    "- The `prompt` value is the initial command prefix that gaslight sends together with a plan path.",
    "- The `prompt` must compose naturally as `<prompt> docs/plans/example.md`; prefer `Implement` unless the evidence clearly shows another reusable plan-starting command.",
    "- Do not put review questions, validation checks, cleanup checks, commit checks, or release checks in `prompt`; those belong in `followups`.",
    "- Prefer concise followups that generalize across tasks.",
    "- Do not produce two followups for the same workflow step; merge semantic duplicates.",
    '- Repeated short prompts like "commit" are evidence for one well-placed workflow check, not multiple followups.',
    "- Order followups as a useful review sequence: quality, verification, cleanup, then commit or release when supported by the evidence.",
    "- Do not include project secrets, file paths, names, tokens, or one-off task details.",
    "- Preserve the user's direct style when it is reusable.",
    "- Use 3 to 8 followups."
  ].join("\n");
}

function replaceEvery(value: string, search: string, replacement: string): string {
  if (search.length === 0) {
    return value;
  }
  return value.split(search).join(replacement);
}

function redactKnownPaths(value: string, cwd: string, homeDir: string): string {
  const replacements = [
    { value: cwd, label: "<workspace>" },
    { value: homeDir, label: "<home>" }
  ].sort((left, right) => right.value.length - left.value.length);
  let redacted = value;
  for (const replacement of replacements) {
    redacted = replaceEvery(redacted, replacement.value, replacement.label);
  }
  return redacted;
}

function stripIdeSelection(value: string): string {
  let stripped = value;
  const openTag = "<ide_selection>";
  const closeTag = "</ide_selection>";
  while (true) {
    const startIndex = stripped.indexOf(openTag);
    if (startIndex === -1) {
      return stripped;
    }
    const endIndex = stripped.indexOf(closeTag, startIndex + openTag.length);
    if (endIndex === -1) {
      return stripped;
    }
    stripped = stripped.slice(0, startIndex) + stripped.slice(endIndex + closeTag.length);
  }
}

function normalizePromptText(value: string, cwd: string, homeDir: string): string {
  const normalizedLineEndings = stripIdeSelection(value)
    .split("\r\n")
    .join("\n")
    .split("\r")
    .join("\n");
  const lines: string[] = [];
  let blankLines = 0;
  for (const line of normalizedLineEndings.split("\n")) {
    const trimmedRight = line.trimEnd();
    if (trimmedRight.trim().length === 0) {
      blankLines += 1;
      if (blankLines <= 1) {
        lines.push("");
      }
      continue;
    }
    blankLines = 0;
    lines.push(trimmedRight);
  }
  return redactKnownPaths(lines.join("\n").trim(), cwd, homeDir);
}

function truncateForAnalysis(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }
  const preferredCut = value.lastIndexOf("\n", maxLength);
  const minimumUsefulCut = Math.floor(maxLength * 0.65);
  const cutIndex = preferredCut >= minimumUsefulCut ? preferredCut : maxLength;
  return `${value.slice(0, cutIndex).trimEnd()}\n[truncated]`;
}

function markdownBlock(value: string): string {
  return value
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function markdownInline(value: string): string {
  return value.split("\n").join(" ").split("`").join("'");
}

interface TracePromptGroup {
  traceId: string;
  source: string;
  title?: string;
  prompts: HumanPromptRecord[];
}

function groupPromptsByTrace(records: HumanPromptRecord[]): TracePromptGroup[] {
  const groups = new Map<string, TracePromptGroup>();
  for (const record of records) {
    const key = `${record.source}:${record.traceId}`;
    const existing = groups.get(key);
    if (existing) {
      existing.prompts.push(record);
      if (!existing.title && record.title) {
        existing.title = record.title;
      }
      continue;
    }
    groups.set(key, {
      traceId: record.traceId,
      source: record.source,
      ...(record.title ? { title: record.title } : {}),
      prompts: [record]
    });
  }
  return [...groups.values()];
}

function shortPromptKey(
  record: HumanPromptRecord,
  cwd: string,
  homeDir: string
): string | undefined {
  const text = normalizePromptText(record.text, cwd, homeDir);
  if (text.length === 0 || text.length > 80 || text.includes("\n")) {
    return undefined;
  }
  return text.toLowerCase();
}

function buildRepeatedShortPromptSection(
  records: HumanPromptRecord[],
  cwd: string,
  homeDir: string
): string[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const key = shortPromptKey(record, cwd, homeDir);
    if (!key) {
      continue;
    }
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const repeated = [...counts.entries()]
    .filter((entry) => entry[1] > 1)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 12);
  if (repeated.length === 0) {
    return ["## Repeated short prompts", "", "No repeated short prompts were found.", ""];
  }
  return [
    "## Repeated short prompts",
    "",
    "Treat these as frequency evidence. Do not copy them blindly or create duplicate followups.",
    "",
    ...repeated.map(([text, count]) => `- \`${markdownInline(text)}\` - ${count} occurrences`),
    ""
  ];
}

function buildAnalysisInput(records: HumanPromptRecord[], cwd: string, homeDir: string): string {
  const groups = groupPromptsByTrace(records);
  const lines = [
    "# Gaslight ingest analysis input",
    "",
    "This file is curated evidence for generating a reusable gaslight.yaml.",
    "Infer durable follow-up behavior from the prompts. Do not copy task-specific text.",
    "",
    "## Summary",
    "",
    `- Prompts: ${records.length}`,
    `- Traces: ${groups.length}`,
    "",
    ...buildRepeatedShortPromptSection(records, cwd, homeDir),
    "## Prompt evidence",
    ""
  ];

  groups.forEach((group, groupIndex) => {
    const title = group.title
      ? truncateForAnalysis(markdownInline(normalizePromptText(group.title, cwd, homeDir)), 90)
      : group.traceId;
    lines.push(`### Trace ${groupIndex + 1}: ${title}`);
    lines.push("");
    lines.push(`- Source: ${group.source}`);
    lines.push(`- Prompts in trace: ${group.prompts.length}`);
    lines.push("");
    group.prompts.forEach((record, promptIndex) => {
      const text = truncateForAnalysis(normalizePromptText(record.text, cwd, homeDir), 1200);
      lines.push(`#### Prompt ${promptIndex + 1}`);
      lines.push("");
      if (record.timestamp) {
        lines.push(`- Timestamp: ${record.timestamp}`);
        lines.push("");
      }
      lines.push(markdownBlock(text));
      lines.push("");
    });
  });

  return `${lines.join("\n").trimEnd()}\n`;
}

async function writeAnalysisInput(
  fs: GaslightFileSystem,
  records: HumanPromptRecord[],
  filePath: string,
  cwd: string,
  homeDir: string
): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, buildAnalysisInput(records, cwd, homeDir), { encoding: "utf8" });
}

async function removeAnalysisInput(
  fs: WritableGaslightFileSystem,
  filePath: string
): Promise<void> {
  if (!fs.unlink) {
    return;
  }
  try {
    await fs.unlink(filePath);
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }
    throw error;
  }
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
  const outputDirectory = path.dirname(absoluteOutputPath);
  await assertNotSymlink(fs, outputDirectory, "Output directory");
  await fs.mkdir(outputDirectory, { recursive: true });
  await assertNotSymlink(fs, outputDirectory, "Output directory");
  const temporaryPath = `${absoluteOutputPath}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporaryPath, `${yaml}\n`, { encoding: "utf8" });
  if (fs.rename) {
    await fs.rename(temporaryPath, absoluteOutputPath);
    return;
  }
  await fs.writeFile(absoluteOutputPath, `${yaml}\n`, { encoding: "utf8" });
}

async function assertNotSymlink(
  fs: WritableGaslightFileSystem,
  targetPath: string,
  label: string
): Promise<void> {
  if (!fs.lstat) {
    return;
  }
  try {
    const stats = await fs.lstat(targetPath);
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} cannot be a symbolic link: ${targetPath}`);
    }
  } catch (error) {
    if (isMissingFile(error)) {
      return;
    }
    throw error;
  }
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
  const analysisAgent = requireNonEmptyString(options.analysisAgent, "analysisAgent");
  const model = resolveOptionalNonEmptyString(options.model, "model");
  const limit = resolveLimit(options.limit);
  const outputPathOption = resolveOptionalNonEmptyString(options.outputPath, "outputPath");
  const since = resolveSince(options.since);

  const collection = await collectHumanPrompts({
    sources: options.sources,
    cwd,
    homeDir,
    since,
    limit,
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

  if (options.dryRun === true) {
    const previewOutputPath = await resolveOutputPath(fs, cwd, analysisAgent, outputPathOption);
    return {
      outputPath: previewOutputPath.resultPath,
      dataPath: dataPath.resultPath,
      promptCount: collection.records.length,
      traceCount: collection.traceCount
    };
  }

  await writeAnalysisInput(fs, collection.records, dataPath.absolutePath, cwd, homeDir);
  const shouldRemoveAnalysisInput = options.keepDataPath === undefined;

  try {
    options.onEvent?.({
      type: "analysis.started",
      agent: analysisAgent,
      dataPath: dataPath.absolutePath
    });
    const result = await spawn(analysisAgent, {
      prompt: buildAnalysisPrompt(dataPath.absolutePath),
      cwd,
      mode: "read",
      ...(model ? { model } : {})
    });
    if (result.exitCode !== 0) {
      const message =
        result.stderr.trim() || result.stdout.trim() || `exit code ${result.exitCode}`;
      throw new Error(`Gaslight ingest analysis failed: ${message}`);
    }

    const outputPath = await resolveOutputPath(fs, cwd, analysisAgent, outputPathOption);
    await writeGeneratedConfig(fs, result.stdout, outputPath.absolutePath);
    options.onEvent?.({ type: "config.written", path: outputPath.resultPath });

    return {
      outputPath: outputPath.resultPath,
      dataPath: dataPath.resultPath,
      promptCount: collection.records.length,
      traceCount: collection.traceCount
    };
  } finally {
    if (shouldRemoveAnalysisInput) {
      await removeAnalysisInput(fs, dataPath.absolutePath);
    }
  }
}
