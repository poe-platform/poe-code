import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedText} from "./backed-text.js";

it("retains composed text and transforms long words without resident text collections", async () => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const text = new BackedText(storage, async () => {});
  const collect = async (value: Parameters<BackedText["chunks"]>[0]) => {let result = ""; for await (const chunk of text.chunks(value)) {expect(chunk.length).toBeLessThanOrEqual(4096); result += chunk;} return result;};
  try {
    const value = await text.from((async function* () {yield "  a\t "; for (let i = 0; i < 16; i++) yield "x".repeat(4096); yield " b\n\n尾\n";})());
    const wrapped = await text.wrap(value, 10);
    expect(await collect(wrapped)).toBe("a\n" + "x".repeat(65536) + "\nb\n\n尾\n");
    const trimmed = await text.trimFinalNewline(wrapped);
    const indented = await text.indent(trimmed, "- ", "  ");
    expect(await collect(indented)).toBe("- a\n  " + "x".repeat(65536) + "\n  b\n\n  尾");
    expect(await collect(value)).toBe("  a\t " + "x".repeat(65536) + " b\n\n尾\n");
  } finally {await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});

it("counts Unicode code points for wrapping across chunk edges and retains UTF16", async () => {
  const fs = new MemoryFileSystem();
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const text = new BackedText(storage, async () => {});
  try {
    const value = await text.from(["😀 a \ud83d", "\ude00 b\ud800"]);
    const wrapped = await text.wrap(value, 4);
    let result = ""; for await (const chunk of text.chunks(wrapped)) result += chunk;
    expect(result).toBe("😀 a\n😀 b\ud800");
  } finally {await storage.close();}
});
