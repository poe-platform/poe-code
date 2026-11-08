import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {EpubManifest, type ManifestItem} from "./epub-manifest.js";

it("shares manifest records between ID and path indexes and preserves ordered UTF-16 fields", async () => {
  const fs = new MemoryFileSystem(), storage = new PagedStorage({fs, cwd: "/", env: {}, signal: new AbortController().signal}, 1);
  const manifest = new EpubManifest(storage, async () => {});
  const open = vi.spyOn(fs, "open"), read = vi.spyOn(storage, "read");
  vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole-file read forbidden"));
  try {
    const expected: ManifestItem[] = [];
    for (let ordinal = 0; ordinal < 96; ordinal++) {
      const item = {ordinal, id: `id-${ordinal}`, part: `part-${ordinal}`, media: "application/xhtml+xml", properties: ["nav", "a\tb"], fallback: ordinal ? `id-${ordinal - 1}` : "", overlay: ordinal ? "" : "😀\ud800".repeat(8193)};
      await manifest.add(item); expected.push(item);
    }
    expect(manifest.size).toBe(96);
    expect(open).toHaveBeenCalled();
    expect(await manifest.has("absent")).toBe(false);
    expect(await manifest.hasPart("absent")).toBe(false);
    expect(await manifest.get("absent")).toBeUndefined();
    expect(await manifest.getPart("absent")).toBeUndefined();
    const extent = storage.allocate(0), actual: ManifestItem[] = [];
    for await (const item of manifest.values()) {
      actual.push(item);
      expect(await manifest.get(item.id)).toEqual(item);
      expect(await manifest.getPart(item.part)).toEqual(item);
    }
    expect(actual).toEqual(expected);
    expect(storage.allocate(0)).toBe(extent);
    expect(Math.max(...read.mock.calls.map(([, count]) => count))).toBeLessThanOrEqual(8192);
  } finally {read.mockRestore(); await storage.close();}
  expect(await fs.readdir("/")).toEqual([]);
});
