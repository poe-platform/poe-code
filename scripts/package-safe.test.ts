import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createFsFromVolume, Volume } from "memfs";
import { packageSafeLibraries, rewriteModuleSpecifiers } from "./package-safe.mjs";

const bashManifest = JSON.parse(readFileSync(new URL("../packages/safe-bash/package.json", import.meta.url), "utf8"));

function optionalLeftovers() {
  const data: Record<string, string> = {
    "/repo/package.json": JSON.stringify({ license: "MIT", exports: {
      "./safe-js": { types: "./packages/safe-js/dist/index.d.ts", import: "./packages/safe-js/dist/index.js" },
    } }),
    "/repo/packages/safe-js/package.json": JSON.stringify({ name: "private-js", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
    "/repo/packages/safe-fs/package.json": JSON.stringify({ name: "private-fs", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
    "/repo/packages/safe-bash/package.json": JSON.stringify(bashManifest),
  };
  for (const name of ["safe-js", "safe-fs", "safe-bash"]) {
    data[`/repo/packages/${name}/README.md`] = `# ${name}\n`;
    data[`/repo/packages/${name}/dist/index.js`] = "export {};\n";
    data[`/repo/packages/${name}/dist/index.d.ts`] = "export {};\n";
  }
  data["/repo/packages/safe-fs/dist/core.js"] = "export {};\n";
  data["/repo/packages/safe-fs/dist/core.d.ts"] = "export {};\n";
  for (const target of Object.values(bashManifest.exports) as Record<string, string>[]) {
    for (const file of Object.values(target)) data["/repo/packages/safe-bash/" + file.replace("./", "").replaceAll("*", "probe")] = "export {};\n";
  }
  const excluded = (bashManifest.files as string[]).filter(file => file.startsWith("!"));
  for (const file of excluded) {
    const relative = file.slice(1);
    if (relative.endsWith(".js") || relative.endsWith(".ts") || relative.endsWith(".map")) data["/repo/packages/safe-bash/" + relative] = relative.endsWith(".map") ? "{}\n" : "export {};\n";
    else for (const suffix of ["index.js", "index.d.ts", "index.js.map", "nested/data.json"]) data[`/repo/packages/safe-bash/${relative}/${suffix}`] = suffix.endsWith(".js") || suffix.endsWith(".ts") ? "export {};\n" : "{}\n";
  }
  for (const file of ["shell/arrays/state.js", "shell/extensions.js", "shell/extensions/read-extra/index.js", "optional.js-helper/index.js", "commands/dd-extra/index.js", "contracts/worker.mjs", "contracts/schema.json"]) {
    data["/repo/packages/safe-bash/dist/" + file] = file.endsWith(".json") ? "{}\n" : "export {};\n";
  }
  data["/repo/packages/safe-bash/dist/index.js.map"] = "{}\n";
  const volume = Volume.fromJSON(data);
  const files = createFsFromVolume(volume).promises;
  const bundle = vi.fn(async () => ({ outputFiles: [{ path: "/repo/packages/safe-js/dist/index.js", contents: Buffer.from(volume.readFileSync("/repo/packages/safe-js/dist/index.js")) }] }));
  return { volume, data, excluded, options: { rootDir: "/repo", version: "0.1.0", files, bundle } };
}

describe("scoped safe package artifacts", () => {
  it("excludes all currently declared optional leftovers while preserving every default member", async () => {
    const { volume, data, excluded, options } = optionalLeftovers();
    await packageSafeLibraries({ ...options, outDir: "/output" });
    const prefix = "/repo/packages/safe-bash/";
    const expected = Object.fromEntries(Object.entries(data).filter(([filename]) => filename.startsWith(prefix + "dist/") && !excluded.some(entry => {
      const omitted = prefix + entry.slice(1);
      return filename === omitted || filename.startsWith(omitted + "/");
    })).map(([filename, contents]) => [filename.replace(prefix + "dist/", "/output/safe-bash/dist/safe-bash/"), contents]));
    const actual = Object.fromEntries(Object.entries(volume.toJSON()).filter(([filename]) => filename.startsWith("/output/safe-bash/dist/")));
    expect(actual).toEqual(expected);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(Object.keys(manifest.exports)).toEqual(Object.keys(bashManifest.exports));
    for (const [key, target] of Object.entries(bashManifest.exports) as [string, Record<string, string>][]) {
      expect(manifest.exports[key]).toEqual(Object.fromEntries(Object.entries(target).map(([condition, filename]) => [condition, filename.replace("./dist/", "./dist/safe-bash/")])));
    }
  });

  for (const route of ["export", "runtime", "declaration", "dynamic", "asset"] as const) it(`rejects a default ${route} edge into an excluded optional member`, async () => {
    const { volume, options } = optionalLeftovers();
    if (route === "export") volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports: { ...bashManifest.exports, "./leak": { import: "./dist/optional.js" } } }));
    else if (route === "declaration") volume.writeFileSync("/repo/packages/safe-bash/dist/index.d.ts", 'export type Leak = import("./optional.js").Leak;');
    else volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", route === "runtime" ? 'export * from "./optional.js";' : route === "dynamic" ? 'export const leak = () => import("./shell/extensions/read/index.js");' : 'export const leak = new URL("./commands/dd/nested/data.json", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Excluded package file referenced:");
  });

  for (const route of ["export", "runtime", "declaration", "dynamic", "asset"] as const) it(`uses the referenced workspace's exclusions for a cross-package ${route} edge`, async () => {
    const { volume, options } = optionalLeftovers();
    if (route === "export") {
      const manifest = JSON.parse(volume.readFileSync("/repo/package.json", "utf8").toString());
      manifest.exports["./safe-js/leak"] = { import: "./packages/safe-bash/dist/optional.js" };
      volume.writeFileSync("/repo/package.json", JSON.stringify(manifest));
    } else if (route === "declaration") volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type Leak = import("../../safe-bash/dist/optional.js").Leak;');
    else volume.writeFileSync("/repo/packages/safe-js/dist/index.js", route === "runtime" ? 'export * from "../../safe-bash/dist/optional.js";' : route === "dynamic" ? 'export const leak = () => import("../../safe-bash/dist/shell/extensions/read/index.js");' : 'export const leak = new URL("../../safe-bash/dist/commands/dd/nested/data.json", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Excluded package file referenced:");
    expect(Object.keys(volume.toJSON()).filter(filename => filename.startsWith("/output/safe-js/dist/safe-bash/"))).toEqual([]);
  });

  for (const excludeMap of [false, true]) it(`preserves cross-package core runtime, declaration and asset members with owner source-map policy: excluded=${excludeMap}`, async () => {
    const { volume, options } = optionalLeftovers();
    volume.writeFileSync("/repo/packages/safe-js/dist/index.js", 'export * from "../../safe-bash/dist/contracts/worker.mjs"; export const data = new URL("../../safe-bash/dist/contracts/schema.json", import.meta.url);');
    volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type Core = import("../../safe-bash/dist/contracts/probe.js").Core;');
    volume.writeFileSync("/repo/packages/safe-bash/dist/contracts/probe.d.ts", "export interface Core { ok: true }\n");
    volume.writeFileSync("/repo/packages/safe-bash/dist/contracts/worker.mjs.map", "{}\n");
    if (excludeMap) volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, files: [...bashManifest.files, "!dist/contracts/worker.mjs.map"] }));
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync("/output/safe-js/dist/safe-bash/contracts/worker.mjs", "utf8")).toBe("export {};\n");
    expect(volume.readFileSync("/output/safe-js/dist/safe-bash/contracts/schema.json", "utf8")).toBe("{}\n");
    expect(volume.readFileSync("/output/safe-js/dist/safe-bash/contracts/probe.d.ts", "utf8")).toBe("export interface Core { ok: true }\n");
    expect(volume.existsSync("/output/safe-js/dist/safe-bash/contracts/worker.mjs.map")).toBe(!excludeMap);
    expect(volume.readFileSync("/output/safe-js/dist/safe-js/index.d.ts", "utf8")).toBe('export type Core = import("../safe-bash/contracts/probe.js").Core;');
  });

  it("honors additional literal exclusions, including auxiliary source maps", async () => {
    const { volume, options } = optionalLeftovers();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, files: [...bashManifest.files, "!dist/contracts/worker.mjs", "!dist/index.js.map"] }));
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/contracts/worker.mjs")).toBe(false);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/index.js.map")).toBe(false);
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8")).toBe("export {};\n");
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/contracts/schema.json", "utf8")).toBe("{}\n");
  });

  for (const exclusion of ["!dist/commands/*", "!../outside", "!/absolute", "!", "!."]) it(`refuses an unsupported exclusion rather than guessing its members: ${exclusion}`, async () => {
    const { volume, options } = optionalLeftovers();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, files: [...bashManifest.files, exclusion] }));
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow(`Unsupported package file exclusion: ${exclusion}`);
  });
  it("rewrites module references without touching ordinary strings", () => {
    const source = 'import { FsError } from "poe-code/safe-fs"; export type F = import("poe-code/safe-js").F; const label = "poe-code/safe-fs"; new URL("poe-code/safe-fs", "https://example.com");';
    const result = rewriteModuleSpecifiers("api.d.ts", source, specifier => specifier.replace("poe-code/", "@poe-platform/"));
    expect(result).toContain('from "@poe-platform/safe-fs"');
    expect(result).toContain('import("@poe-platform/safe-js")');
    expect(result).toContain('label = "poe-code/safe-fs"');
    expect(result).toContain('new URL("poe-code/safe-fs", "https://example.com")');
  });

  it("packages canonical runtime and declaration closures without private dependencies", async () => {
    const volume = Volume.fromJSON({
      "/repo/package.json": JSON.stringify({ license: "MIT", dependencies: { external: "^2.0.0" }, exports: {
        "./safe-js": { types: "./packages/safe-js/dist/index.d.ts", import: "./packages/safe-js/dist/index.js" },
        "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: "./packages/safe-js/dist/safe-fs.js" },
      } }),
      "/repo/packages/safe-js/package.json": JSON.stringify({ name: "private-js", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
      "/repo/packages/safe-fs/package.json": JSON.stringify({ name: "@poe-code/safe-fs", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./core": { types: "./dist/core.d.ts", import: "./dist/core.js" }, "./node": { types: "./dist/node-host.d.ts", import: "./dist/node-host.js" } } }),
      "/repo/packages/safe-bash/package.json": JSON.stringify({ name: "private-bash", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
      "/repo/packages/safe-js/README.md": "# SafeJS\n",
      "/repo/packages/safe-fs/README.md": "# SafeFS\n",
      "/repo/packages/safe-bash/README.md": "# Safe Bash\n",
      "/repo/packages/safe-js/dist/index.js": 'export { value } from "./chunks/shared.js";',
      "/repo/packages/safe-js/dist/chunks/shared.js": 'import external from "external"; export const value = external;',
      "/repo/packages/safe-js/dist/index.d.ts": 'export type { Value } from "../../helper/dist/index.js"; export { FsError } from "../../safe-fs/dist/index.js";',
      "/repo/packages/helper/dist/index.d.ts": 'export interface Value { ok: boolean }',
      "/repo/packages/safe-js/dist/safe-fs.js": 'export class FsError extends Error {}',
      "/repo/packages/safe-fs/dist/index.d.ts": 'export declare class FsError extends Error {}',
      "/repo/packages/safe-fs/dist/index.js": 'export class FsError extends Error {}',
      "/repo/packages/safe-fs/dist/core.js": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/core.d.ts": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/node-host.js": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/node-host.d.ts": 'export { FsError } from "./index.js";',
      "/repo/packages/safe-fs/dist/node-unavailable.d.ts": 'export {};',
      "/repo/packages/safe-bash/dist/index.js": 'export { FsError } from "poe-code/safe-fs";',
      "/repo/packages/safe-bash/dist/index.d.ts": 'export { FsError } from "poe-code/safe-fs";',
    });
    const files = createFsFromVolume(volume).promises;
    const bundle = vi.fn(async () => ({ outputFiles: [{ path: "/repo/packages/safe-js/dist/index.js", contents: Buffer.from('export { value } from "./chunks/shared.js"; export { FsError } from "@poe-platform/safe-fs";') }] }));
    const options = { rootDir: "/repo", version: "0.1.0", files, bundle };
    await packageSafeLibraries({ ...options, outDir: "/output" });
    const read = (path: string) => volume.readFileSync(path, "utf8").toString();
    const js = JSON.parse(read("/output/safe-js/package.json"));
    const bash = JSON.parse(read("/output/safe-bash/package.json"));
    const filesystem = JSON.parse(read("/output/safe-fs/package.json"));
    expect(filesystem.name).toBe("@poe-platform/safe-fs");
    expect(filesystem.private).toBeUndefined();
    expect(filesystem.dependencies).toEqual({});
    expect(filesystem.exports["."].browser).toBe("./dist/safe-fs/core.js");
    expect(filesystem.exports["./node"].browser).toBeNull();
    expect(filesystem.imports["#safe-fs-platform"].browser).toBe("./dist/safe-fs/platform/browser.js");
    expect(bundle).toHaveBeenCalledWith(expect.objectContaining({
      alias: expect.objectContaining({ "@poe-code/safe-fs": "@poe-platform/safe-fs" }),
      external: expect.arrayContaining(["@poe-platform/safe-fs"]), write: false,
    }));
    expect(js.name).toBe("@poe-platform/safe-js");
    expect(js.private).toBeUndefined();
    expect(js.files).toEqual(["dist"]);
    expect(js.repository.directory).toBe("packages/safe-js");
    expect(js.dependencies).toEqual({ external: "^2.0.0", "@poe-platform/safe-fs": "0.1.0" });
    expect(read("/output/safe-js/" + js.exports["./fs"].import)).toContain('"@poe-platform/safe-fs"');
    expect(volume.existsSync("/output/safe-js/dist/safe-fs")).toBe(false);
    expect(bash.dependencies).toEqual({ "@poe-platform/safe-fs": "0.1.0" });
    expect(read("/output/safe-bash/dist/safe-bash/index.js")).toContain('"@poe-platform/safe-fs"');
    expect(read("/output/safe-js/dist/safe-js/index.d.ts")).toContain('"@poe-platform/safe-fs"');
    expect(read("/output/safe-js/dist/safe-js/index.d.ts")).toContain('"../helper/index.js"');
    expect(read("/output/safe-js/dist/helper/index.d.ts")).toContain("interface Value");
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(packageSafeLibraries({ ...options, outDir: "/repo/packages/output" })).rejects.toThrow("overwrite workspace");
    await expect(packageSafeLibraries({ ...options, outDir: "/bad-version", version: "latest" })).rejects.toThrow("valid explicit");
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'import cli from "poe-code";');
    await expect(packageSafeLibraries({ ...options, outDir: "/private-leak" })).rejects.toThrow("CLI dependency leaked");
  });
});
