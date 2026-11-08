import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import type { AgentTraceFileSystem } from "../types.js";
import { mapConcurrent } from "./concurrency.js";
import { readHead } from "./head.js";

describe("readHead", () => {
  it("reads at most maxBytes from a large file", async () => {
    const big = `${JSON.stringify({ id: "one" })}\n${"x".repeat(1_000_000)}`;
    const fs = createFsFromVolume(Volume.fromJSON({ "/t/big.jsonl": big }))
      .promises as unknown as AgentTraceFileSystem;

    const head = await readHead(fs, "/t/big.jsonl", 1024);
    expect(head.length).toBe(1024);
    expect(head.startsWith('{"id":"one"}')).toBe(true);
  });

  it("uses positional reads instead of readFile when open is available", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({ "/t/a.jsonl": "hello world" }))
      .promises as unknown as AgentTraceFileSystem;
    const readFileSpy = vi.spyOn(fs, "readFile");

    const head = await readHead(fs, "/t/a.jsonl", 5);
    expect(head).toBe("hello");
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it("falls back to readFile when open is unavailable", async () => {
    const fs: AgentTraceFileSystem = {
      readFile: async () => "abcdef",
      writeFile: async () => undefined,
      mkdir: async () => undefined,
      readdir: async () => [],
      stat: async () => ({ isFile: () => true, isDirectory: () => false })
    };
    expect(await readHead(fs, "/t/a.jsonl", 3)).toBe("abc");
  });
});

describe("mapConcurrent", () => {
  it("preserves order and bounds concurrency", async () => {
    let running = 0;
    let peak = 0;
    const results = await mapConcurrent([1, 2, 3, 4, 5, 6, 7, 8], 3, async (item) => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 1));
      running -= 1;
      return item * 2;
    });
    expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
    expect(peak).toBeLessThanOrEqual(3);
  });

  it("handles empty input", async () => {
    expect(await mapConcurrent([], 4, async () => 1)).toEqual([]);
  });
});
