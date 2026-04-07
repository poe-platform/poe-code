import { dirname } from "node:path";
import type { ExperimentFileSystem, JournalEntry } from "../types.js";

const TSV_HEADER = ["commit", "status", "scores", "durationMs", "timestamp", "output", "agentOutput"].join("\t");

export class ExperimentJournal {
  constructor(
    private readonly journalPath: string,
    private readonly fs: ExperimentFileSystem
  ) {}

  async init(): Promise<void> {
    await this.fs.mkdir(dirname(this.journalPath), { recursive: true });

    try {
      await this.fs.readFile(this.journalPath, "utf8");
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }

      await this.fs.writeFile(this.journalPath, "");
    }
  }

  async log(entry: JournalEntry): Promise<void> {
    await this.fs.mkdir(dirname(this.journalPath), { recursive: true });
    await this.fs.appendFile(this.journalPath, `${JSON.stringify(entry)}\n`);
  }

  async readAll(): Promise<JournalEntry[]> {
    let content: string;

    try {
      content = await this.fs.readFile(this.journalPath, "utf8");
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return [];
      }

      throw error;
    }

    return content
      .split("\n")
      .filter((line) => line.length > 0)
      .flatMap((line) => parseLine(line));
  }

  async updateLast(updates: Partial<JournalEntry>): Promise<JournalEntry | null> {
    const entries = await this.readAll();

    if (entries.length === 0) {
      return null;
    }

    const last = entries[entries.length - 1]!;
    const updated = { ...last, ...updates };
    entries[entries.length - 1] = updated;

    await this.fs.writeFile(
      this.journalPath,
      entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
    );

    return updated;
  }

  async format(): Promise<string> {
    const entries = await this.readAll();

    return [
      TSV_HEADER,
      ...entries.map((entry) =>
        [
          entry.commit,
          entry.status,
          entry.scores ? JSON.stringify(entry.scores) : "-",
          String(entry.durationMs),
          entry.timestamp,
          formatOutput(entry.output),
          formatOutput(entry.agentOutput ?? "")
        ].join("\t")
      )
    ].join("\n");
  }
}

export function baselineFromEntry(entry: JournalEntry): Record<string, number> | null {
  return entry.scores ?? null;
}

function parseLine(line: string): JournalEntry[] {
  try {
    return [JSON.parse(line) as JournalEntry];
  } catch {
    // Handle concatenated JSON objects (e.g. {...}{...}) on a single line
    const entries: JournalEntry[] = [];
    let depth = 0;
    let start = 0;

    for (let i = 0; i < line.length; i++) {
      if (line[i] === "{") {
        depth++;
      } else if (line[i] === "}") {
        depth--;
        if (depth === 0) {
          entries.push(JSON.parse(line.slice(start, i + 1)) as JournalEntry);
          start = i + 1;
        }
      }
    }

    return entries;
  }
}

function formatOutput(output: string): string {
  return output
    .replaceAll("\\", "\\\\")
    .replaceAll("\r", "\\r")
    .replaceAll("\n", "\\n")
    .replaceAll("\t", "\\t");
}

function isFileNotFoundError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
