import { it, expect, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { packageSafeLibraries } from "./package-safe.mjs";

function packagingFixture() {
  const data: Record<string, string> = { "/repo/package.json": JSON.stringify({ license: "MIT" }) };
  for (const name of ["safe-bash", "safe-js", "safe-fs"]) {
    data[`/repo/packages/${name}/package.json`] = JSON.stringify({ name, exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js", ...(name === "safe-bash" ? { browser: "./dist/core.browser.js" } : {}) } }, ...(name === "safe-bash" ? { poeCode: { integration: { privateWorkspaces: {} } } } : {}) });
    data[`/repo/packages/${name}/README.md`] = `# ${name}\n`;
    data[`/repo/packages/${name}/dist/index.js`] = "export {};\n";
    data[`/repo/packages/${name}/dist/index.d.ts`] = "export {};\n";
  }
  data["/repo/packages/safe-fs/dist/core.js"] = "export {};\n";
  data["/repo/packages/safe-fs/dist/core.d.ts"] = "export {};\n";
  data["/repo/packages/safe-bash/dist/core.browser.js"] = "export {};\n";
  const volume = Volume.fromJSON(data);
  const bundle = vi.fn(async (settings: { outdir?: string; sourcemap?: boolean | string }) => ({ outputFiles: settings.outdir === "/repo/packages/safe-js/dist" ? [{ path: "/repo/packages/safe-js/dist/chunk.js.map", contents: Buffer.from("{}\n") }] : [] }));
  return { volume, options: { rootDir: "/repo", version: "0.1.0", files: createFsFromVolume(volume).promises, bundle } };
}

it("omits disposable debug maps while retaining local artifacts", async () => {
  const { volume, options } = packagingFixture();
  for (const name of ["safe-bash", "safe-js", "safe-fs"]) {
    for (const suffix of ["js.map", "d.ts.map"]) volume.writeFileSync(`/repo/packages/${name}/dist/index.${suffix}`, "{}\n");
  }
  volume.writeFileSync("/repo/packages/safe-js/dist/index.js", 'export const data = new URL("./runtime.map", import.meta.url);');
  volume.writeFileSync("/repo/packages/safe-js/dist/runtime.map", "runtime data\n");
  await packageSafeLibraries({ ...options, outDir: "/output" });
  for (const [settings] of options.bundle.mock.calls) expect(settings.sourcemap).toBe(false);
  expect(volume.readFileSync("/output/safe-js/dist/safe-js/runtime.map", "utf8")).toBe("runtime data\n");
  expect(volume.existsSync("/output/safe-js/dist/safe-js/chunk.js.map")).toBe(false);
  for (const name of ["safe-bash", "safe-js", "safe-fs"]) {
    for (const suffix of ["js.map", "d.ts.map"]) {
      expect(volume.existsSync(`/output/${name}/dist/${name}/index.${suffix}`)).toBe(false);
      expect(volume.existsSync(`/repo/packages/${name}/dist/index.${suffix}`)).toBe(true);
    }
    expect(volume.existsSync(`/output/${name}/dist/${name}/index.js`)).toBe(true);
    expect(volume.existsSync(`/output/${name}/dist/${name}/index.d.ts`)).toBe(true);
  }
});

