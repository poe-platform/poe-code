import path from "node:path";
import { asRecord, newestDate, parseDate, parseJsonLines } from "../line-json.js";
import type {
  AgentTraceFileSystem,
  NormalizedTrace,
  NormalizedTraceTurn,
  TraceReader,
  TraceReference
} from "../types.js";

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

function turnFromRecord(record: Record<string, unknown>): NormalizedTraceTurn | undefined {
  const message = asRecord(record.message);
  if (!message) {
    return undefined;
  }
  const text = textFromContent(message.content);
  if (text.length === 0) {
    return undefined;
  }
  return {
    ...(typeof record.uuid === "string" ? { id: record.uuid } : {}),
    role: roleFromClaude(record.type, message.role),
    text,
    ...(parseDate(record.timestamp) ? { timestamp: parseDate(record.timestamp) } : {}),
    ...(typeof record.type === "string" ? { sourceKind: record.type } : {})
  };
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
    const timestamp = parseDate(record.timestamp);
    createdAt = createdAt ?? timestamp;
    updatedAt = newestDate(updatedAt, timestamp);
    const turn = turnFromRecord(record);
    if (turn) {
      turns.push(turn);
    }
  }

  return {
    source: "claude",
    id: sessionId ?? fileId(filePath),
    path: filePath,
    ...(cwd ? { cwd } : {}),
    ...(title ? { title } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
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
