import { dirname } from "node:path";
import type { ExperimentFileSystem, JournalEntry } from "../types.js";

const TSV_HEADER = ["commit", "status", "score", "durationMs", "timestamp", "output"].join("\t");

export class ExperimentJournal {
  constructor(
    private readonly journalPath: string,
    private readonly fs: ExperimentFileSystem
  ) {}

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
      .map((line) => JSON.parse(line) as JournalEntry);
  }

  async format(): Promise<string> {
    const entries = await this.readAll();

    return [
      TSV_HEADER,
      ...entries.map((entry) =>
        [
          entry.commit,
          entry.status,
          entry.score === null ? "null" : String(entry.score),
          String(entry.durationMs),
          entry.timestamp,
          formatOutput(entry.output)
        ].join("\t")
      )
    ].join("\n");
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
