import { randomUUID } from "node:crypto";
import { dirname, join, parse, resolve, sep } from "node:path";
import { hasOwnErrorCode } from "../errors.js";
import type { ExperimentFileSystem, JournalEntry } from "../types.js";

const TSV_HEADER = ["commit", "status", "scores", "durationMs", "timestamp", "output", "agentOutput"].join("\t");

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

    await this.publish(entries);

    return updated;
  }

  async retainLatestNewEntry(previousLength: number): Promise<JournalEntry | null> {
    const entries = await this.readAll();

    if (entries.length <= previousLength) {
      return null;
    }

    const latest = entries[entries.length - 1]!;
    if (entries.length > previousLength + 1) {
      await this.publish([...entries.slice(0, previousLength), latest]);
    }

    return latest;
  }

  async removeNewEntries(previousLength: number): Promise<void> {
    const entries = await this.readAll();

    if (entries.length > previousLength) {
      await this.publish(entries.slice(0, previousLength));
    }
  }

  private async publish(entries: JournalEntry[]): Promise<void> {
    await this.assertRegularPath();
    const temporaryPath = `${this.journalPath}.${process.pid}.${randomUUID()}.tmp`;
    let temporaryCreated = false;

    try {
      await this.fs.writeFile(
        temporaryPath,
        entries.length === 0 ? "" : entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
        { encoding: "utf8", flag: "wx" }
      );
      temporaryCreated = true;
      await this.assertRegularPath();
      await this.fs.rename(temporaryPath, this.journalPath);
    } catch (error) {
      if (temporaryCreated || !isFileAlreadyExistsError(error)) {
        await this.fs.unlink(temporaryPath).catch(() => undefined);
      }
      throw error;
    }
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
    const value: unknown = JSON.parse(line);

    return isJournalEntry(value) ? [value] : [];
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
        const value: unknown = JSON.parse(line.slice(start, end + 1));
        if (isJournalEntry(value)) {
          entries.push(value);
        }
        searchFrom = end + 1;
      } catch {
        searchFrom = start + 1;
      }
    }

    return entries;
  }
}

function isJournalEntry(value: unknown): value is JournalEntry {
  if (!isRecord(value)) {
    return false;
  }

  if (
    typeof value.commit !== "string" ||
    value.commit.length === 0 ||
    (value.status !== "keep" && value.status !== "discard") ||
    typeof value.output !== "string" ||
    typeof value.agentOutput !== "string" ||
    typeof value.durationMs !== "number" ||
    !Number.isFinite(value.durationMs) ||
    typeof value.timestamp !== "string"
  ) {
    return false;
  }

  if (value.scores === undefined) {
    return true;
  }

  return (
    isRecord(value.scores) &&
    Object.values(value.scores).every((score) => typeof score === "number" && Number.isFinite(score))
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
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
  return hasOwnErrorCode(error, "ENOENT");
}

function isFileAlreadyExistsError(error: unknown): error is NodeJS.ErrnoException {
  return hasOwnErrorCode(error, "EEXIST");
}
