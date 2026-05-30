import { dirname, join, parse, resolve, sep } from "node:path";
import type { ExperimentFileSystem, JournalEntry } from "../types.js";

const TSV_HEADER = ["commit", "status", "scores", "durationMs", "timestamp", "output", "agentOutput"].join("\t");

let temporaryFileSequence = 0;

export class ExperimentJournal {
  constructor(
    private readonly journalPath: string,
    private readonly fs: ExperimentFileSystem
  ) {}

  async init(): Promise<void> {
    await this.assertRegularPath();
    await this.fs.mkdir(dirname(this.journalPath), { recursive: true });
    await this.assertRegularPath();

    try {
      await this.fs.readFile(this.journalPath, "utf8");
    } catch (error) {
      if (!isFileNotFoundError(error)) {
        throw error;
      }

      await this.fs.appendFile(this.journalPath, "");
    }
  }

  async log(entry: JournalEntry): Promise<void> {
    await this.assertRegularPath();
    await this.fs.mkdir(dirname(this.journalPath), { recursive: true });
    await this.assertRegularPath();
    await this.fs.appendFile(this.journalPath, `${JSON.stringify(entry)}\n`);
  }

  async readAll(): Promise<JournalEntry[]> {
    await this.assertRegularPath();
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

    const temporaryPath = `${this.journalPath}.${process.pid}.${temporaryFileSequence++}.tmp`;

    try {
      await this.fs.writeFile(
        temporaryPath,
        entries.map((e) => JSON.stringify(e)).join("\n") + "\n"
      );
      await this.fs.rename(temporaryPath, this.journalPath);
    } catch (error) {
      await this.fs.unlink(temporaryPath).catch(() => undefined);
      throw error;
    }

    return updated;
  }

  private async assertRegularPath(): Promise<void> {
    const absolutePath = resolve(this.journalPath);
    const rootPath = parse(absolutePath).root;
    let currentPath = rootPath;

    for (const segment of absolutePath.slice(rootPath.length).split(sep).filter(Boolean)) {
      currentPath = join(currentPath, segment);

      try {
        if ((await this.fs.lstat(currentPath)).isSymbolicLink()) {
          throw new Error("Experiment journal must not contain symbolic links.");
        }
      } catch (error) {
        if (isFileNotFoundError(error)) {
          return;
        }

        throw error;
      }
    }
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
    const entries: JournalEntry[] = [];
    let searchFrom = 0;

    while (searchFrom < line.length) {
      const start = line.indexOf("{", searchFrom);
      if (start === -1) {
        break;
      }

      const end = findObjectEnd(line, start);
      if (end === -1) {
        searchFrom = start + 1;
        continue;
      }

      try {
        entries.push(JSON.parse(line.slice(start, end + 1)) as JournalEntry);
        searchFrom = end + 1;
      } catch {
        searchFrom = start + 1;
      }
    }

    return entries;
  }
}

function findObjectEnd(line: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < line.length; index++) {
    const character = line[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;
      if (depth === 0) {
        return index;
      }
    }
  }

  return -1;
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
