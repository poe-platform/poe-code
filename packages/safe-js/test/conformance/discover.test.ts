import { fs, vol } from "memfs";
import { afterEach, expect, it, vi } from "vitest";
import { discoverTest262 } from "./discover.js";

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return { ...fs.promises, default: fs.promises };
});
afterEach(() => vol.reset());

it("discovers sorted JavaScript sources while retaining fixture classification inputs", async () => {
  vol.fromJSON({
    "/corpus/test/language/z.js": "0", "/corpus/test/language/a.js": "0",
    "/corpus/test/language/dep_FIXTURE.js": "0", "/corpus/test/language/data.json": "{}",
    "/corpus/harness/assert.js": "0"
  });
  expect(await discoverTest262("/corpus")).toEqual([
    "language/a.js", "language/dep_FIXTURE.js", "language/z.js"
  ]);
});

it("supports explicit files and directories without duplicating overlapping selections", async () => {
  vol.fromJSON({ "/corpus/test/a/one.js": "0", "/corpus/test/a/two.js": "0", "/corpus/test/b/other.js": "0" });
  expect(await discoverTest262("/corpus", ["a/one.js", "a", "a"]))
    .toEqual(["a/one.js", "a/two.js"]);
});

it.each(["../harness", "/outside", "a/../../outside"])("rejects a selection outside the test tree: %s", async selection => {
  vol.fromJSON({ "/corpus/test/a/one.js": "0", "/outside/other.js": "0" });
  await expect(discoverTest262("/corpus", [selection])).rejects.toThrow();
});

it("rejects symbolic links instead of silently traversing outside the pinned tree", async () => {
  vol.fromJSON({ "/corpus/test/a.js": "0", "/outside/other.js": "0" });
  fs.symlinkSync("/outside", "/corpus/test/link");
  await expect(discoverTest262("/corpus")).rejects.toThrow("symbolic link");
});

it("rejects an empty or missing selection instead of reporting a vacuous success", async () => {
  vol.fromJSON({ "/corpus/test/a.js": "0" });
  await expect(discoverTest262("/corpus", [])).rejects.toThrow();
  await expect(discoverTest262("/corpus", ["missing"])).rejects.toThrow();
});
