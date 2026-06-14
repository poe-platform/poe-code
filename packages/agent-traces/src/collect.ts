import { promises as nodeFs } from "node:fs";
import os from "node:os";
import { traceReaders } from "./readers/index.js";
import type {
  AgentTraceSource,
  CollectHumanPromptsOptions,
  CollectHumanPromptsResult,
  HumanPromptRecord,
  TraceReader
} from "./types.js";

const DEFAULT_SOURCES: AgentTraceSource[] = ["claude", "codex"];

function compareRecordsNewestFirst(first: HumanPromptRecord, second: HumanPromptRecord): number {
  const firstTime = first.timestamp ? new Date(first.timestamp).getTime() : 0;
  const secondTime = second.timestamp ? new Date(second.timestamp).getTime() : 0;
  return secondTime - firstTime;
}

function isInjectedContext(text: string): boolean {
  const trimmed = text.trim();
  return (
    trimmed.startsWith("<codex_internal_context") ||
    trimmed.startsWith("# AGENTS.md instructions") ||
    trimmed.startsWith("## Prior conversation with Codex:") ||
    trimmed.startsWith("<environment_context>") ||
    trimmed.startsWith("<INSTRUCTIONS>") ||
    trimmed.startsWith("<turn_aborted>") ||
    trimmed.startsWith("<subagent_notification>") ||
    trimmed.startsWith("Read this JSONL file of human prompts from coding-agent traces:")
  );
}

function removeContextTags(text: string): string {
  let result = text.trim();
  while (result.startsWith("<ide_opened_file>")) {
    const endIndex = result.indexOf("</ide_opened_file>");
    if (endIndex === -1) {
      return result;
    }
    result = result.slice(endIndex + "</ide_opened_file>".length).trim();
  }
  return result;
}

function recordKey(record: HumanPromptRecord): string {
  return [record.source, record.traceId, record.text].join("\u0000");
}

export async function collectHumanPromptsFromReaders(
  readers: TraceReader[],
  options: CollectHumanPromptsOptions = {}
): Promise<CollectHumanPromptsResult> {
  const sources = options.sources ?? DEFAULT_SOURCES;
  const readerById = new Map(readers.map((reader) => [reader.id, reader]));
  const fs = options.fs ?? nodeFs;
  const homeDir = options.homeDir ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const records: HumanPromptRecord[] = [];
  const seenRecords = new Set<string>();
  let traceCount = 0;

  for (const source of sources) {
    const reader = readerById.get(source);
    if (!reader) {
      throw new Error(`Unsupported trace source: ${source}`);
    }
    const references = await reader.discover({
      cwd,
      homeDir,
      since: options.since,
      allWorkspaces: options.allWorkspaces,
      fs,
      sqlite: options.sqlite
    });
    traceCount += references.length;
    for (const reference of references) {
      const trace = await reader.read(reference, { fs });
      for (const turn of trace.turns) {
        if (turn.role !== "human" || turn.text.trim().length === 0) {
          continue;
        }
        if (options.since && turn.timestamp && turn.timestamp < options.since) {
          continue;
        }
        const text = removeContextTags(turn.text);
        if (text.length === 0) {
          continue;
        }
        if (isInjectedContext(text)) {
          continue;
        }
        const record = {
          traceId: trace.id,
          source: trace.source,
          ...(trace.cwd ? { cwd: trace.cwd } : {}),
          ...(trace.title ? { title: trace.title } : {}),
          ...(turn.timestamp ? { timestamp: turn.timestamp.toISOString() } : {}),
          text
        };
        const key = recordKey(record);
        if (seenRecords.has(key)) {
          continue;
        }
        seenRecords.add(key);
        records.push(record);
      }
    }
  }

  records.sort(compareRecordsNewestFirst);
  return {
    records: options.limit === undefined ? records : records.slice(0, options.limit),
    traceCount
  };
}

export async function collectHumanPrompts(
  options: CollectHumanPromptsOptions = {}
): Promise<HumanPromptRecord[]> {
  return (await collectHumanPromptsWithStats(options)).records;
}

export async function collectHumanPromptsWithStats(
  options: CollectHumanPromptsOptions = {}
): Promise<CollectHumanPromptsResult> {
  return await collectHumanPromptsFromReaders(traceReaders, options);
}
