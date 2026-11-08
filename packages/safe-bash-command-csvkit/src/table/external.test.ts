import { expect, test } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs";
import { createReplayFile } from "./storage.js";
import { RowStorage, externalSort } from "./external.js";

test("external sort is stable through bounded multi-pass merges and bigint replay", async () => {
  const fs = new MemoryFileSystem();
  const storage = new RowStorage(() => createReplayFile(fs, "/", new AbortController().signal));
  const rows = Array.from({ length: 257 }, (_, ordinal) => ({ key: ordinal % 7, ordinal, time: BigInt(ordinal) }));
  async function* source() { for (const row of rows) yield row; }
  try {
    const sorted = await externalSort(storage, source(), (a, b) => a.key - b.key, () => {}, 256);
    const actual = [];
    for await (const row of sorted.read()) actual.push(row);
    expect(actual).toEqual([...rows].sort((a, b) => a.key - b.key));
    expect((await fs.readdir("/")).length).toBeLessThanOrEqual(2);
  } finally { await storage.close(); }
  expect(await fs.readdir("/")).toEqual([]);
});
