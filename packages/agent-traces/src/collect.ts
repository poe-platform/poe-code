import { promises as nodeFs } from "node:fs";
import os from "node:os";
import { openTraceIndex } from "./index-store/store.js";
import { traceReaders } from "./readers/index.js";
import type {
  AgentTraceSource,
  CollectHumanPromptsOptions,
  CollectHumanPromptsResult,
  HumanPromptRecord,
  TraceReader,
  TraceReference
} from "./types.js";

const DEFAULT_SOURCES: AgentTraceSource[] = traceReaders.map((reader) => reader.id);

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
  return [record.source, record.traceId, record.timestamp ?? "", record.text].join("\u0000");
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime());
}

export async function collectHumanPromptsFromReaders(
  readers: TraceReader[],
  options: CollectHumanPromptsOptions = {}
): Promise<CollectHumanPromptsResult> {
  if (options.since !== undefined && !isValidDate(options.since)) {
    throw new Error("since must be a valid Date.");
  }
  if (
    options.limit !== undefined &&
    (!Number.isInteger(options.limit) || options.limit < 0 || !Number.isFinite(options.limit))
  ) {
    throw new Error("limit must be a non-negative integer.");
  }

  const sources = options.sources ?? DEFAULT_SOURCES;
  const readerById = new Map(readers.map((reader) => [reader.id, reader]));
  const fs = options.fs ?? nodeFs;
  const homeDir = options.homeDir ?? os.homedir();
  const cwd = options.cwd ?? process.cwd();
  const records: HumanPromptRecord[] = [];
  const seenRecords = new Set<string>();
  let traceCount = 0;

  let indexedReferences: Map<AgentTraceSource, TraceReference[]> | undefined;
  if (options.indexDir !== undefined) {
    try {
      const indexable = sources
        .map((source) => readerById.get(source))
        .filter(
          (reader): reader is TraceReader =>
            reader !== undefined &&
            reader.scan !== undefined &&
            reader.readHeadMetadata !== undefined
        );
      const index = await openTraceIndex({ dir: options.indexDir, fs });
      await index.sync({ readers: indexable, homeDir });
      const references = await index.query({
        cwd,
        allWorkspaces: options.allWorkspaces,
        since: options.since,
        sources: indexable.map((reader) => reader.id),
        limit: Number.POSITIVE_INFINITY
      });
      indexedReferences = new Map(indexable.map((reader) => [reader.id, []]));
      for (const reference of references) {
        indexedReferences.get(reference.source)?.push(reference);
      }
    } catch {
      indexedReferences = undefined;
    }
  }

  for (const source of sources) {
    const reader = readerById.get(source);
    if (!reader) {
      throw new Error(`Unsupported trace source: ${source}`);
    }
    const references =
      indexedReferences?.get(source) ??
      (await reader.discover({
        cwd,
        homeDir,
        since: options.since,
        allWorkspaces: options.allWorkspaces,
        fs,
        sqlite: options.sqlite
      }));
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
        const timestamp =
          turn.timestamp && isValidDate(turn.timestamp) ? turn.timestamp.toISOString() : undefined;
        const record = {
          traceId: trace.id,
          source: trace.source,
          ...(trace.cwd ? { cwd: trace.cwd } : {}),
          ...(trace.title ? { title: trace.title } : {}),
          ...(timestamp ? { timestamp } : {}),
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
