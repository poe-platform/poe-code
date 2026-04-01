import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { ExperimentJournal } from "./journal.js";
import type { ExperimentFileSystem, JournalEntry } from "../types.js";

function createFs(files: Record<string, string> = {}): ExperimentFileSystem {
  const volume = Volume.fromJSON(files, "/");
  return createFsFromVolume(volume).promises as unknown as ExperimentFileSystem;
}

function createEntry(overrides: Partial<JournalEntry> = {}): JournalEntry {
  return {
    commit: "a1b2c3d",
    status: "keep",
    score: 1.04,
    output: "test_duration: 1.04",
    durationMs: 5023,
    timestamp: "2026-03-30T10:00:00.000Z",
    ...overrides
  };
}

describe("ExperimentJournal", () => {
  it("initializes a missing journal file without clobbering future entries", async () => {
    const fs = createFs();
    const journalPath = "/repo/experiment.journal.jsonl";
    const journal = new ExperimentJournal(journalPath, fs);

    await journal.init();

    await expect(fs.readFile(journalPath, "utf8")).resolves.toBe("");

    const entry = createEntry();
    await journal.log(entry);

    await expect(fs.readFile(journalPath, "utf8")).resolves.toBe(`${JSON.stringify(entry)}\n`);
  });

  it("logs a single entry and reads it back", async () => {
    const fs = createFs();
    const journalPath = "/repo/docs/experiment.journal.jsonl";
    const journal = new ExperimentJournal(journalPath, fs);
    const entry = createEntry();

    await journal.log(entry);

    await expect(fs.readFile(journalPath, "utf8")).resolves.toBe(`${JSON.stringify(entry)}\n`);
    await expect(journal.readAll()).resolves.toEqual([entry]);
  });

  it("logs multiple entries and returns them in order", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);
    const first = createEntry();
    const second = createEntry({
      commit: "e4f5g6h",
      status: "discard",
      score: 1.12,
      output: "test_duration: 1.12",
      durationMs: 4987,
      timestamp: "2026-03-30T10:11:00.000Z"
    });
    const third = createEntry({
      commit: "f7g8h9i",
      status: "keep",
      score: 0.98,
      output: "test_duration: 0.98",
      durationMs: 4700,
      timestamp: "2026-03-30T10:22:00.000Z"
    });

    await journal.log(first);
    await journal.log(second);
    await journal.log(third);

    await expect(journal.readAll()).resolves.toEqual([first, second, third]);
  });

  it("returns an empty array when the journal file is missing", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/missing.journal.jsonl", fs);

    await expect(journal.readAll()).resolves.toEqual([]);
  });

  it("formats entries as a readable TSV table", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await journal.log(
      createEntry({
        output: "line 1\nline\t2"
      })
    );
    await journal.log(
      createEntry({
        commit: "e4f5g6h",
        status: "discard",
        score: 1.12,
        output: "test_duration: 1.12",
        durationMs: 4987,
        timestamp: "2026-03-30T10:11:00.000Z"
      })
    );

    await expect(journal.format()).resolves.toBe(
      [
        "commit\tstatus\tscore\tdurationMs\ttimestamp\toutput",
        "a1b2c3d\tkeep\t1.04\t5023\t2026-03-30T10:00:00.000Z\tline 1\\nline\\t2",
        "e4f5g6h\tdiscard\t1.12\t4987\t2026-03-30T10:11:00.000Z\ttest_duration: 1.12"
      ].join("\n")
    );
  });

  it("formats a missing journal as a header-only TSV table", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/missing.journal.jsonl", fs);

    await expect(journal.format()).resolves.toBe(
      "commit\tstatus\tscore\tdurationMs\ttimestamp\toutput"
    );
  });

  it("escapes carriage returns and backslashes in formatted output", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await journal.log(
      createEntry({
        output: String.raw`path\to\file\rnext line`
      })
    );

    await expect(journal.format()).resolves.toContain(
      "a1b2c3d\tkeep\t1.04\t5023\t2026-03-30T10:00:00.000Z\tpath\\\\to\\\\file\\\\rnext line"
    );
  });

  it("reads concatenated JSON objects on a single line", async () => {
    const first = createEntry({ commit: "aaa1111" });
    const second = createEntry({ commit: "bbb2222", status: "discard" });
    const fs = createFs({
      "/repo/experiment.journal.jsonl": `${JSON.stringify(first)}${JSON.stringify(second)}\n`
    });
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);

    await expect(journal.readAll()).resolves.toEqual([first, second]);
  });

  it("handles crash entries with a null score", async () => {
    const fs = createFs();
    const journal = new ExperimentJournal("/repo/experiment.journal.jsonl", fs);
    const entry = createEntry({
      commit: "cr4sh00",
      status: "crash",
      score: null,
      output: "SyntaxError: unexpected token",
      durationMs: 102,
      timestamp: "2026-03-30T10:05:30.000Z"
    });

    await journal.log(entry);

    await expect(journal.readAll()).resolves.toEqual([entry]);
    await expect(journal.format()).resolves.toContain(
      "cr4sh00\tcrash\tnull\t102\t2026-03-30T10:05:30.000Z\tSyntaxError: unexpected token"
    );
  });
});
