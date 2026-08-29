import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("node:fs/promises");
  vi.doUnmock("esbuild");
  vi.resetModules();
});

it("preserves the previous SafeJS bundle when compilation fails", async () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const previousChunk = path.join(root, "packages/safejs/dist/chunks/chunk-OLD.js");
  const volume = Volume.fromJSON({
    [path.join(root, "package.json")]: "{}",
    [path.join(root, "packages/safejs/package.json")]: '{"name":"@poe-code/safejs"}',
    [path.join(root, "packages/memory/package.json")]: '{"name":"@poe-code/memory"}',
    [path.join(root, "packages/safejs/dist/index.js")]: 'export * from "./chunks/chunk-OLD.js";',
    [previousChunk]: "export const previous = true;",
    [path.join(root, "dist/metafile.json")]: "{}"
  });
  volume.mkdirSync(path.join(root, "src/providers"), { recursive: true });
  const failure = new Error("SafeJS compilation failed");
  const build = vi.fn(async (options: { outdir?: string }) => {
    if (options.outdir === path.join(root, "packages/safejs/dist")) throw failure;
    return { metafile: { outputs: {} } };
  });
  vi.doMock("node:fs/promises", () => createFsFromVolume(volume).promises);
  vi.doMock("esbuild", () => ({ build }));

  await expect(import("./bundle.mjs")).rejects.toBe(failure);

  expect(build).toHaveBeenLastCalledWith(expect.objectContaining({ write: false, metafile: true }));
  expect(volume.existsSync(previousChunk)).toBe(true);
  expect(volume.readFileSync(previousChunk, "utf8")).toBe("export const previous = true;");
});
