import path from "node:path";
import { asRecord, newestDate, parseDate, parseJsonLines } from "../line-json.js";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  NormalizedTraceTurn,
  TraceUsage,
  TraceReader,
  TraceReference
} from "../types.js";

interface ToolAttribution {
  toolName?: string;
  mcpServer?: string;
}

interface ClaudeReadState {
  toolUses: Map<string, ToolAttribution>;
  spawnToolUseIds: string[];
  pendingSkillName?: string;
}

interface SkillListingEntry {
  name: string;
  text: string;
}

function isMissingFile(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    Object.prototype.hasOwnProperty.call(error, "code") &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

function encodeClaudeProjectPath(cwd: string): string {
  return cwd.split(path.sep).join("-");
}

async function listJsonlFiles(fs: AgentTraceFileSystem, directory: string): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
  return names
    .filter((name) => name.endsWith(".jsonl"))
    .sort()
    .map((name) => path.join(directory, name));
}

async function listDirectory(fs: AgentTraceFileSystem, directory: string): Promise<string[]> {
  try {
    return await fs.readdir(directory);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }
}

async function listProjectDirectories(
  fs: AgentTraceFileSystem,
  projectsRoot: string
): Promise<string[]> {
  let names: string[];
  try {
    names = await fs.readdir(projectsRoot);
  } catch (error) {
    if (isMissingFile(error)) {
      return [];
    }
    throw error;
  }

  const directories: string[] = [];
  for (const name of names.sort()) {
    const candidate = path.join(projectsRoot, name);
    try {
      if ((await fs.stat(candidate)).isDirectory()) {
        directories.push(candidate);
      }
    } catch (error) {
      if (!isMissingFile(error)) {
        throw error;
      }
    }
  }
  return directories;
}

function fileId(filePath: string): string {
  const name = path.basename(filePath);
  return name.endsWith(".jsonl") ? name.slice(0, -".jsonl".length) : name;
}

function subagentsDirectoryForTrace(filePath: string): string {
  const directory = path.dirname(filePath);
  if (path.basename(directory) === "subagents" && path.basename(filePath).startsWith("agent-")) {
    return directory;
  }
  return path.join(directory, fileId(filePath), "subagents");
}

function agentIdFromMetaFilename(name: string): string | undefined {
  const prefix = "agent-";
  const suffix = ".meta.json";
  if (!name.startsWith(prefix) || !name.endsWith(suffix)) {
    return undefined;
  }
  const agentId = name.slice(prefix.length, -suffix.length);
  return agentId.length > 0 ? agentId : undefined;
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return "";
  }
  const parts: string[] = [];
  for (const item of value) {
    if (typeof item === "string") {
      parts.push(item);
      continue;
    }
    const record = asRecord(item);
    if (!record) {
      continue;
    }
    const type = typeof record.type === "string" ? record.type : undefined;
    if (type !== undefined && type !== "text" && type !== "input_text") {
      continue;
    }
    if (typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join("\n");
}

function stringifyJson(value: unknown): string {
  const text = JSON.stringify(value);
  return typeof text === "string" ? text : "";
}

function mcpServerFromToolName(toolName: string): string | undefined {
  if (!toolName.startsWith("mcp__")) {
    return undefined;
  }
  const server = toolName.split("__")[1];
  return server && server.length > 0 ? server : undefined;
}

function skillNameFromInput(input: unknown): string | undefined {
  const record = asRecord(input);
  return typeof record?.skill === "string" && record.skill.length > 0 ? record.skill : undefined;
}

function skillNameFromInstructions(text: string): string | undefined {
  const firstLine = text.split("\n")[0]?.trim();
  if (!firstLine) {
    return undefined;
  }
  const marker = "/skills/";
  const markerIndex = firstLine.indexOf(marker);
  if (markerIndex === -1) {
    return undefined;
  }
  const skillName = firstLine.slice(markerIndex + marker.length).split("/")[0];
  return skillName.length > 0 ? skillName : undefined;
}

function normalizeSkillListingText(parts: string[]): string {
  return parts
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .join(" ");
}

function skillListingEntriesFromContent(content: string): SkillListingEntry[] {
  const entries: SkillListingEntry[] = [];
  let current: { name: string; parts: string[] } | undefined;

  const flush = (): void => {
    if (!current) {
      return;
    }
    const text = normalizeSkillListingText(current.parts);
    entries.push({
      name: current.name,
      text: text.length > 0 ? text : current.name
    });
    current = undefined;
  };

  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    if (line.startsWith("- ")) {
      flush();
      const body = line.slice(2).trim();
      const colonIndex = body.indexOf(":");
      const name = (colonIndex === -1 ? body : body.slice(0, colonIndex)).trim();
      if (name.length === 0) {
        continue;
      }
      current = { name, parts: [body] };
      continue;
    }

    current?.parts.push(line);
  }

  flush();
  return entries;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === "string" && item.length > 0);
}

function skillListingEntries(attachment: Record<string, unknown>): SkillListingEntry[] {
  if (typeof attachment.content === "string") {
    const entries = skillListingEntriesFromContent(attachment.content);
    if (entries.length > 0) {
      return entries;
    }
  }

  return stringArray(attachment.names).map((name) => ({ name, text: name }));
}

function turnsFromSkillListingAttachment(
  record: Record<string, unknown>
): NormalizedTraceTurn[] {
  if (record.type !== "attachment") {
    return [];
  }

  const attachment = asRecord(record.attachment);
  if (!attachment || attachment.type !== "skill_listing") {
    return [];
  }

  const timestamp = parseDate(record.timestamp);
  const base = {
    ...(typeof record.uuid === "string" ? { id: record.uuid } : {}),
    ...(timestamp ? { timestamp } : {})
  };

  return skillListingEntries(attachment).map((entry) => ({
    ...base,
    role: "system",
    text: entry.text,
    sourceKind: "skill_listing",
    skillName: entry.name
  }));
}

function isSubagentSpawnTool(toolName: string): boolean {
  return toolName === "Agent" || toolName === "Task";
}

function roleFromClaude(recordType: unknown, messageRole: unknown): NormalizedTraceTurn["role"] {
  if (messageRole === "user" || recordType === "user") {
    return "human";
  }
  if (messageRole === "assistant" || recordType === "assistant") {
    return "assistant";
  }
  if (recordType === "system") {
    return "system";
  }
  return "tool";
}

function textTurnFromClaude(
  text: string,
  base: Omit<NormalizedTraceTurn, "role" | "text">,
  recordType: unknown,
  messageRole: unknown,
  state: ClaudeReadState
): NormalizedTraceTurn | undefined {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  if (messageRole === "user" || recordType === "user") {
    if (trimmed.startsWith("Base directory for this skill:")) {
      const skillName = state.pendingSkillName ?? skillNameFromInstructions(trimmed);
      state.pendingSkillName = undefined;
      return {
        ...base,
        role: "system",
        text: trimmed,
        sourceKind: "skill_instructions",
        ...(skillName ? { skillName } : {})
      };
    }
    if (trimmed.includes("<system-reminder>")) {
      return {
        ...base,
        role: "system",
        text: trimmed,
        sourceKind: "system_reminder"
      };
    }
  }

  return {
    ...base,
    role: roleFromClaude(recordType, messageRole),
    text: trimmed,
    ...(typeof recordType === "string" ? { sourceKind: recordType } : {})
  };
}

function tokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function usageFromRecord(
  record: Record<string, unknown>
): { model?: string; usage: TraceUsage } | undefined {
  if (record.type !== "assistant") {
    return undefined;
  }
  const message = asRecord(record.message);
  const usage = asRecord(message?.usage);
  if (!message || !usage) {
    return undefined;
  }

  const inputTokens = tokenCount(usage.input_tokens) ?? 0;
  const outputTokens = tokenCount(usage.output_tokens) ?? 0;
  const cachedTokens = tokenCount(usage.cache_read_input_tokens);
  const cacheCreationTokens = tokenCount(usage.cache_creation_input_tokens);

  return {
    ...(typeof message.model === "string" ? { model: message.model } : {}),
    usage: {
      source: "reported",
      inputTokens,
      outputTokens,
      ...(cachedTokens !== undefined ? { cachedTokens } : {}),
      ...(cacheCreationTokens !== undefined ? { cacheCreationTokens } : {}),
      contextTokens: inputTokens + outputTokens + (cachedTokens ?? 0) + (cacheCreationTokens ?? 0)
    }
  };
}

function turnsFromRecord(
  record: Record<string, unknown>,
  state: ClaudeReadState
): NormalizedTraceTurn[] {
  const message = asRecord(record.message);
  if (!message) {
    return [];
  }
  const timestamp = parseDate(record.timestamp);
  const base = {
    ...(typeof record.uuid === "string" ? { id: record.uuid } : {}),
    ...(timestamp ? { timestamp } : {})
  };

  if (typeof message.content === "string") {
    const turn = textTurnFromClaude(message.content, base, record.type, message.role, state);
    return turn ? [turn] : [];
  }

  if (!Array.isArray(message.content)) {
    return [];
  }

  const turns: NormalizedTraceTurn[] = [];
  for (const item of message.content) {
    if (typeof item === "string") {
      const turn = textTurnFromClaude(item, base, record.type, message.role, state);
      if (turn) {
        turns.push(turn);
      }
      continue;
    }

    const block = asRecord(item);
    if (!block) {
      continue;
    }
    const blockType = typeof block.type === "string" ? block.type : undefined;

    if (
      (blockType === undefined || blockType === "text" || blockType === "input_text") &&
      typeof block.text === "string"
    ) {
      const turn = textTurnFromClaude(block.text, base, record.type, message.role, state);
      if (turn) {
        turns.push(turn);
      }
      continue;
    }

    if (blockType === "thinking" && typeof block.thinking === "string") {
      const text = block.thinking.trim();
      if (text.length > 0) {
        turns.push({
          ...base,
          role: "assistant",
          text,
          sourceKind: "reasoning"
        });
      }
      continue;
    }

    if (blockType === "tool_use" && typeof block.name === "string") {
      const toolName = block.name;
      const mcpServer = mcpServerFromToolName(toolName);
      const attribution = {
        toolName,
        ...(mcpServer ? { mcpServer } : {})
      };
      if (typeof block.id === "string") {
        state.toolUses.set(block.id, attribution);
        if (isSubagentSpawnTool(toolName)) {
          state.spawnToolUseIds.push(block.id);
        }
      }
      if (toolName === "Skill") {
        state.pendingSkillName = skillNameFromInput(block.input) ?? state.pendingSkillName;
      }
      turns.push({
        ...base,
        role: "tool",
        text: stringifyJson(block.input),
        sourceKind: "tool_use",
        ...attribution
      });
      continue;
    }

    if (blockType === "tool_result") {
      const text = textFromContent(block.content);
      const attribution =
        typeof block.tool_use_id === "string" ? state.toolUses.get(block.tool_use_id) : undefined;
      turns.push({
        ...base,
        role: "tool",
        text,
        sourceKind: "tool_result",
        ...(attribution ?? {})
      });
    }
  }
  return turns;
}

async function readSubagentMeta(
  fs: AgentTraceFileSystem,
  metaPath: string
): Promise<Record<string, unknown> | undefined> {
  try {
    return asRecord(JSON.parse(await fs.readFile(metaPath, "utf8")));
  } catch (error) {
    if (isMissingFile(error) || error instanceof SyntaxError) {
      return undefined;
    }
    throw error;
  }
}

async function fileUpdatedAt(
  fs: AgentTraceFileSystem,
  filePath: string
): Promise<Date | undefined> {
  try {
    const mtime = (await fs.stat(filePath)).mtime;
    return mtime instanceof Date && !Number.isNaN(mtime.getTime()) ? mtime : undefined;
  } catch (error) {
    if (isMissingFile(error)) {
      return undefined;
    }
    throw error;
  }
}

async function childReferencesFromSubagents(
  filePath: string,
  fs: AgentTraceFileSystem,
  toolUseIds: string[],
  cwd: string | undefined
): Promise<TraceReference[] | undefined> {
  if (toolUseIds.length === 0) {
    return undefined;
  }

  const subagentsDirectory = subagentsDirectoryForTrace(filePath);
  const names = (await listDirectory(fs, subagentsDirectory)).sort();
  if (names.length === 0) {
    return undefined;
  }

  const referencesByToolUseId = new Map<string, TraceReference[]>();
  for (const name of names) {
    const agentId = agentIdFromMetaFilename(name);
    if (!agentId) {
      continue;
    }

    const metadata = await readSubagentMeta(fs, path.join(subagentsDirectory, name));
    if (!metadata || typeof metadata.toolUseId !== "string") {
      continue;
    }

    const childPath = path.join(subagentsDirectory, `agent-${agentId}.jsonl`);
    const updatedAt = await fileUpdatedAt(fs, childPath);
    const reference: TraceReference = {
      source: "claude",
      id: agentId,
      path: childPath,
      ...(cwd ? { cwd } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      ...(typeof metadata.description === "string" ? { title: metadata.description } : {}),
      ...(typeof metadata.agentType === "string" ? { agentType: metadata.agentType } : {}),
      ...(typeof metadata.spawnDepth === "number" && Number.isFinite(metadata.spawnDepth)
        ? { spawnDepth: metadata.spawnDepth }
        : {})
    };

    const references = referencesByToolUseId.get(metadata.toolUseId) ?? [];
    references.push(reference);
    referencesByToolUseId.set(metadata.toolUseId, references);
  }

  const orderedReferences: TraceReference[] = [];
  for (const toolUseId of toolUseIds) {
    orderedReferences.push(...(referencesByToolUseId.get(toolUseId) ?? []));
  }
  return orderedReferences.length > 0 ? orderedReferences : undefined;
}

async function readTrace(filePath: string, fs: AgentTraceFileSystem): Promise<NormalizedTrace> {
  const records = parseJsonLines(await fs.readFile(filePath, "utf8"))
    .map(asRecord)
    .filter((record): record is Record<string, unknown> => record !== undefined);
  const turns: NormalizedTraceTurn[] = [];
  let cwd: string | undefined;
  let createdAt: Date | undefined;
  let updatedAt: Date | undefined;
  let title: string | undefined;
  let sessionId: string | undefined;
  let reportedUsage: { model?: string; usage: TraceUsage } | undefined;
  const state: ClaudeReadState = {
    toolUses: new Map(),
    spawnToolUseIds: []
  };

  for (const record of records) {
    if (typeof record.cwd === "string" && cwd === undefined) {
      cwd = record.cwd;
    }
    if (typeof record.sessionId === "string" && sessionId === undefined) {
      sessionId = record.sessionId;
    }
    if (typeof record.aiTitle === "string" && title === undefined) {
      title = record.aiTitle;
    }
    reportedUsage = usageFromRecord(record) ?? reportedUsage;
    const timestamp = parseDate(record.timestamp);
    createdAt = createdAt ?? timestamp;
    updatedAt = newestDate(updatedAt, timestamp);
    turns.push(...turnsFromSkillListingAttachment(record));
    turns.push(...turnsFromRecord(record, state));
  }

  const children = await childReferencesFromSubagents(filePath, fs, state.spawnToolUseIds, cwd);

  return {
    source: "claude",
    id: sessionId ?? fileId(filePath),
    path: filePath,
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    ...(reportedUsage?.model ? { model: reportedUsage.model } : {}),
    ...(reportedUsage ? { usage: reportedUsage.usage } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(children ? { children } : {}),
    turns
  };
}

export const claudeTraceReader: TraceReader = {
  id: "claude",
  defaultRoots(homeDir: string): string[] {
    return [path.join(homeDir, ".claude", "projects")];
  },
  async discover(options): Promise<TraceReference[]> {
    const projectsRoot = path.join(options.homeDir, ".claude", "projects");
    const directories =
      options.allWorkspaces || !options.cwd
        ? await listProjectDirectories(options.fs, projectsRoot)
        : [path.join(projectsRoot, encodeClaudeProjectPath(options.cwd))];
    const references: TraceReference[] = [];

    for (const directory of directories) {
      for (const filePath of await listJsonlFiles(options.fs, directory)) {
        const trace = await readTrace(filePath, options.fs);
        if (options.since && trace.updatedAt && trace.updatedAt < options.since) {
          continue;
        }
        references.push({
          source: "claude",
          id: trace.id,
          path: filePath,
          ...(trace.cwd ? { cwd: trace.cwd } : {}),
          ...(trace.updatedAt ? { updatedAt: trace.updatedAt } : {}),
          ...(trace.title ? { title: trace.title } : {})
        });
      }
    }

    return references;
  },
  async read(reference, options): Promise<NormalizedTrace> {
    if (!reference.path) {
      throw new Error(`Claude trace ${reference.id} has no path.`);
    }
    return await readTrace(reference.path, options.fs);
  }
};
