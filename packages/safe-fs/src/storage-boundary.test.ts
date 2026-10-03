import {expect, it} from "vitest";
import {build} from "esbuild";

it("bundles working storage for Workers without shell or host dependencies", async () => {
  const bundle = await build({
    stdin: {contents: 'export {PagedStorage, IntegerTable} from "@poe-code/safe-fs/storage";', resolveDir: process.cwd(), sourcefile: "storage-worker.ts"},
    bundle: true, write: false, metafile: true, platform: "browser", conditions: ["workerd"], format: "esm"
  });
  expect(bundle.outputFiles[0]!.text).toContain("PagedStorage");
  expect(Object.keys(bundle.metafile.inputs).some(path => path.includes("safe-bash"))).toBe(false);
  expect(Object.values(bundle.metafile.outputs).flatMap(output => output.imports)).toEqual([]);
});

it("exposes the same storage classes through the canonical portable core", async () => {
  const core = await import("./core.js");
  const storage = await import("./storage.js");
  expect(core).toHaveProperty("PagedStorage", storage.PagedStorage);
  expect(core).toHaveProperty("IntegerTable", storage.IntegerTable);
});
