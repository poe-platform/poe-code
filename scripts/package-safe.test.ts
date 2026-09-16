import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createFsFromVolume, Volume } from "memfs";
import ts from "typescript";
import { packageSafeLibraries, parsePackageSafeArguments, rewriteModuleSpecifiers } from "./package-safe.mjs";

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
  const targets: unknown[] = Object.values(bashManifest.exports);
  while (targets.length) {
    const target = targets.pop();
    if (typeof target === "string") data["/repo/packages/safe-bash/" + target.replace("./", "").replaceAll("*", "probe")] = "export {};\n";
    else if (target && typeof target === "object") targets.push(...Object.values(target));
  }
  const excluded = (bashManifest.files as string[]).filter(file => file.startsWith("!"));
  for (const file of excluded.filter(file => file !== "!dist/opt-in")) {
    const relative = file.slice(1);
    if (relative.endsWith(".js") || relative.endsWith(".ts") || relative.endsWith(".map")) data["/repo/packages/safe-bash/" + relative] = relative.endsWith(".map") ? "{}\n" : "export {};\n";
    else for (const suffix of ["index.js", "index.d.ts", "index.js.map", "nested/data.json"]) data[`/repo/packages/safe-bash/${relative}/${suffix}`] = suffix.endsWith(".js") || suffix.endsWith(".ts") ? "export {};\n" : "{}\n";
  }
  for (const file of ["shell/arrays/state.js", "shell/extensions.js", "shell/extensions/read-extra/index.js", "optional.js-helper/index.js", "commands/dd-extra/index.js", "contracts/worker.mjs", "contracts/schema.json"]) {
    data["/repo/packages/safe-bash/dist/" + file] = file.endsWith(".json") ? "{}\n" : "export {};\n";
  }
  data["/repo/packages/safe-bash/dist/index.js.map"] = "{}\n";
  data["/repo/packages/safe-bash/dist/opt-in/optional.js"] = "export {};\n";
  data["/repo/packages/safe-bash/dist/opt-in/optional.d.ts"] = "export {};\n";
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
    const expected = Object.fromEntries(Object.entries(data).filter(([filename]) => filename.startsWith(prefix + "dist/") && !excluded.filter(entry => entry !== "!dist/opt-in").some(entry => {
      const omitted = prefix + entry.slice(1);
      return filename === omitted || filename.startsWith(omitted + "/");
    })).map(([filename, contents]) => [filename.replace(prefix + "dist/", "/output/safe-bash/dist/safe-bash/"), contents]));
    const actual = Object.fromEntries(Object.entries(volume.toJSON()).filter(([filename]) => filename.startsWith("/output/safe-bash/dist/")));
    expect(actual).toEqual(expected);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(Object.keys(manifest.exports)).toEqual(Object.keys(bashManifest.exports));
    for (const [key, target] of Object.entries(bashManifest.exports)) {
      expect(manifest.exports[key]).toEqual(JSON.parse(JSON.stringify(target, (_key, value: unknown) => typeof value === "string" ? value.replace("./dist/", "./dist/safe-bash/") : value)));
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
        "./safe-js/workerd": { types: "./packages/safe-js/dist/workerd.d.ts", workerd: "./packages/safe-js/dist/workerd.js", browser: null, import: "./packages/safe-js/dist/workerd.js" },
        "./safe-fs": { types: "./packages/safe-fs/dist/index.d.ts", import: "./packages/safe-js/dist/safe-fs.js" },
      } }),
      "/repo/packages/safe-js/package.json": JSON.stringify({ name: "private-js", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./workerd": { types: "./dist/workerd.d.ts", import: "./dist/workerd.js" } } }),
      "/repo/packages/safe-fs/package.json": JSON.stringify({ name: "@poe-code/safe-fs", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" }, "./core": { types: "./dist/core.d.ts", import: "./dist/core.js" }, "./node": { types: "./dist/node-host.d.ts", import: "./dist/node-host.js" } } }),
      "/repo/packages/safe-bash/package.json": JSON.stringify({ name: "private-bash", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
      "/repo/packages/safe-js/README.md": "# SafeJS\n",
      "/repo/packages/safe-fs/README.md": "# SafeFS\n",
      "/repo/packages/safe-bash/README.md": "# Safe Bash\n",
      "/repo/packages/safe-js/dist/index.js": 'export { value } from "./chunks/shared.js";',
      "/repo/packages/safe-js/dist/chunks/shared.js": 'import external from "external"; export const value = external;',
      "/repo/packages/safe-js/dist/index.d.ts": 'export type { HostOptions } from "private-host"; export type { Value } from "../../helper/dist/index.js"; export { FsError } from "../../safe-fs/dist/index.js";',
      "/repo/packages/safe-js/dist/workerd.d.ts": 'export { value } from "./index.js";',
      "/repo/packages/private-host/package.json": JSON.stringify({ name: "private-host", private: true, types: "./dist/index.d.ts" }),
      "/repo/packages/private-host/dist/index.d.ts": 'export interface HostOptions { signal?: AbortSignal; }',
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
    const bundle = vi.fn(async (options: { conditions?: string[]; entryPoints?: Record<string, string> }) => ({ outputFiles: options.conditions?.includes("workerd")
      ? [{ path: "/repo/packages/safe-js/dist/workerd.js", contents: Buffer.from('export const value = "workerd-context";') }]
      : [{ path: "/repo/packages/safe-js/dist/index.js", contents: Buffer.from('export { value } from "./chunks/shared.js"; export { FsError } from "@poe-platform/safe-fs";') }] }));
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
    expect(js.exports["./workerd"].workerd).toBe("./dist/safe-js/workerd.js");
    expect(js.exports["./workerd"].browser).toBeNull();
    expect(read("/output/safe-js/dist/safe-js/workerd.js")).toContain("workerd-context");
    expect(bundle).toHaveBeenCalledWith(expect.objectContaining({ conditions: ["workerd"], splitting: false }));
    expect(Object.keys(bundle.mock.calls[0]![0].entryPoints!)).not.toContain("workerd");
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
    expect(read("/output/safe-js/dist/safe-js/index.d.ts")).toContain('"../private-host/index.js"');
    expect(read("/output/safe-js/dist/private-host/index.d.ts")).toContain("signal?: AbortSignal");
    expect(volume.existsSync("/output/safe-js/dist/private-host/index.js")).toBe(false);
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'import host from "private-host";');
    await expect(packageSafeLibraries({ ...options, outDir: "/private-runtime" })).rejects.toThrow("Private or CLI dependency leaked: private-host");
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'export { FsError } from "poe-code/safe-fs";');
    volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type { HostOptions } from "private-host/hidden";');
    await expect(packageSafeLibraries({ ...options, outDir: "/unexported-private-type" })).rejects.toThrow("Missing private workspace declaration entrypoint: private-host/hidden");
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toMatchObject({ code: "EEXIST" });
    await expect(packageSafeLibraries({ ...options, outDir: "/repo/packages/output" })).rejects.toThrow("overwrite workspace");
    await expect(packageSafeLibraries({ ...options, outDir: "/bad-version", version: "latest" })).rejects.toThrow("valid explicit");
    volume.writeFileSync("/repo/packages/safe-js/dist/index.d.ts", 'export type { HostOptions } from "private-host";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/index.js", 'import cli from "poe-code";');
    await expect(packageSafeLibraries({ ...options, outDir: "/private-leak" })).rejects.toThrow("CLI dependency leaked");
  });
});

function optionalArtifact() {
  const fixture = optionalLeftovers();
  const { volume } = fixture;
  volume.mkdirSync("/repo/packages/safe-bash/dist/opt-in/commands/yq", { recursive: true });
  volume.mkdirSync("/repo/packages/safe-bash/dist/opt-in/fs/devices", { recursive: true });
  const exports = Object.fromEntries(Object.entries(bashManifest.exports).filter(([, value]) => !(value as { import?: string }).import?.startsWith("./dist/opt-in/")));
  Object.assign(exports, {
    "./yq": { types: "./dist/opt-in/commands/yq/mike.d.ts", import: "./dist/opt-in/commands/yq/mike.js" },
    "./devices": { types: "./dist/opt-in/fs/devices/index.d.ts", import: "./dist/opt-in/fs/devices/index.js" },
  });
  volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "./fs/devices/index.js"; export * from "./commands/yq/mike.js";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export * from "./fs/devices/index.js"; export * from "./commands/yq/mike.js";');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/index.js", 'import { FsError } from "@poe-platform/safe-fs"; import { host } from "@poe-platform/safe-bash/optional-host"; const asset = new URL("./profile.json", import.meta.url); export { FsError, host, asset };');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/index.d.ts", 'export type Value = import("@poe-platform/safe-bash").Value; export type FS = import("@poe-platform/safe-fs").FS;');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/profile.json", '{"profile":"fixture"}\n');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/commands/yq/mike.js", 'export const yaml = () => import("yaml");');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/commands/yq/mike.d.ts", 'export type YAML = import("yaml").Document;');
  volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/unreachable.js", 'import "private-unused";');
  return fixture;
}

describe("explicit optional safe package artifact", () => {
  it("ships the optional closure through the core package's explicit subpath without changing its default entry", async () => {
    const { volume, options } = optionalArtifact();
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.map(entry => entry.name)).toEqual(["@poe-platform/safe-fs", "@poe-platform/safe-js", "@poe-platform/safe-bash"]);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(manifest.exports["./yq"]).toEqual({ types: "./dist/safe-bash/opt-in/commands/yq/mike.d.ts", import: "./dist/safe-bash/opt-in/commands/yq/mike.js" });
    expect(manifest.exports["./optional"]).toBeUndefined();
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/opt-in/optional.js", "utf8")).toBe(volume.readFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", "utf8"));
    expect(volume.readFileSync("/output/safe-bash/dist/safe-bash/index.js", "utf8")).toBe("export {};\n");
    expect(manifest.dependencies.yaml).toBeUndefined();
    expect(manifest.peerDependencies).toEqual({ yaml: "2.9.0" });
    expect(manifest.peerDependenciesMeta).toEqual({ yaml: { optional: true } });
    expect(volume.existsSync("/output/safe-bash-optional")).toBe(false);
  });

  it("keeps default runtime bytes identical when optional output is present", async () => {
    const baseline = optionalLeftovers();
    const optional = optionalArtifact();
    await packageSafeLibraries({ ...baseline.options, outDir: "/output" });
    const result = await packageSafeLibraries({ ...optional.options, outDir: "/output" });
    expect(result.map(entry => entry.name)).toEqual(["@poe-platform/safe-fs", "@poe-platform/safe-js", "@poe-platform/safe-bash"]);
    const artifacts = (volume: Volume) => Object.fromEntries(Object.entries(volume.toJSON()).filter(([name]) => name.startsWith("/output/")));
    const baselineFiles = artifacts(baseline.volume);
    const optionalFiles = artifacts(optional.volume);
    for (const [filename, contents] of Object.entries(baselineFiles)) {
      if (filename !== "/output/safe-bash/package.json" && !filename.includes("/opt-in/")) expect(optionalFiles[filename]).toEqual(contents);
    }
    expect(optional.volume.existsSync("/output/safe-bash-optional")).toBe(false);
  });

  it("embeds only the optional runtime/declaration/asset closure in the core tarball", async () => {
    const { volume, options } = optionalArtifact();
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.map(entry => entry.name)).toEqual(["@poe-platform/safe-fs", "@poe-platform/safe-js", "@poe-platform/safe-bash"]);
    const manifest = JSON.parse(volume.readFileSync("/output/safe-bash/package.json", "utf8").toString());
    expect(manifest).toMatchObject({
      name: "@poe-platform/safe-bash", version: "0.1.0", type: "module", license: "MIT", engines: { node: ">=22" }, files: ["dist"],
      exports: { "./yq": { types: "./dist/safe-bash/opt-in/commands/yq/mike.d.ts", import: "./dist/safe-bash/opt-in/commands/yq/mike.js" } },
      peerDependencies: { yaml: "2.9.0" },
      peerDependenciesMeta: { yaml: { optional: true } }, publishConfig: { access: "public" },
      repository: { type: "git", url: "git+https://github.com/poe-platform/poe-code.git", directory: "packages/safe-bash" },
    });
    expect(manifest.dependencies["@poe-platform/safe-bash"]).toBeUndefined();
    expect(manifest.devDependencies).toBeUndefined();
    expect(manifest.private).toBeUndefined();
    const copied = Object.entries(volume.toJSON()).filter(([name]) => name.startsWith("/output/safe-bash/dist/safe-bash/opt-in/"));
    expect(copied).toHaveLength(7);
    for (const [filename, contents] of copied) expect(contents).toEqual(volume.readFileSync(filename.replace("/output/safe-bash/dist/safe-bash/opt-in/", "/repo/packages/safe-bash/dist/opt-in/"), "utf8"));
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/unreachable.js")).toBe(false);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/safe-bash")).toBe(false);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/safe-fs")).toBe(false);
  });

  for (const missing of ["optional.js", "optional.d.ts"]) it(`refuses missing optional prerequisite before any output: ${missing}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.unlinkSync("/repo/packages/safe-bash/dist/opt-in/" + missing);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow(missing);
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const source of [
    'import "virtual-bash";', 'import "poe-code/safe-fs";', 'import "@poe-code/safe-fs";',
    'import "@poe-platform/safe-bash/private-unexported";', 'import "@poe-platform/safe-fs/private-unexported";',
    'import "@poe-platform/safe-js";', 'import "yaml/private";', 'import "#safe-fs-platform";',
    'import "../../safe-bash/dist/index.js";', 'import "../../safe-fs/dist/index.js";',
    'const edge = "./optional.js"; import(edge);', 'require(variable);',
    'new URL(variable, import.meta.url);', 'new URL("https://example.com/asset", import.meta.url);',
  ]) it(`refuses an unmapped or nonliteral optional runtime edge: ${source}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", source);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const source of [
    'export type Value = import("virtual-bash").Value;',
    'export type Value = import("@poe-platform/safe-bash/private-unexported").Value;',
    '/// <reference path="../../safe-bash/dist/index.d.ts" />\nexport {};',
    'import Value = require("virtual-bash"); export { Value };',
  ]) it(`refuses unmapped declaration edges: ${source}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", source);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("refuses copying a core identity module under the optional dist tree", async () => {
    const { volume, options } = optionalArtifact();
    volume.mkdirSync("/repo/packages/safe-bash/dist/opt-in/contracts", { recursive: true });
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/contracts/errors.js", "export class FsError extends Error {};");
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "./contracts/errors.js";');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("optional-owned");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("requires declaration targets rather than falling back to a runtime module", async () => {
    const { volume, options } = optionalArtifact();
    volume.unlinkSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/index.d.ts");
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("index.d.ts");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("handles cycles without copying a module twice", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/commands/yq/mike.js", 'export * from "../../optional.js";');
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.at(-1)?.name).toBe("@poe-platform/safe-bash");
    expect(Object.keys(volume.toJSON()).filter(filename => filename.startsWith("/output/safe-bash/dist/safe-bash/opt-in/"))).toHaveLength(7);
  });

  it("validates JavaScript URL assets as runtime graph nodes", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/fs/devices/worker.js", 'import "virtual-bash";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'new URL("./fs/devices/worker.js", import.meta.url);');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Unmapped optional peer");
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const link of ["file", "directory"] as const) it(`refuses symlinked optional graph ${link} inputs`, async () => {
    const { volume, options } = optionalArtifact();
    if (link === "file") {
      volume.unlinkSync("/repo/packages/safe-bash/dist/opt-in/optional.js");
      volume.symlinkSync("/repo/packages/safe-bash/dist/index.js", "/repo/packages/safe-bash/dist/opt-in/optional.js");
    } else {
      volume.renameSync("/repo/packages/safe-bash/dist/opt-in/fs", "/repo/optional-fs");
      volume.symlinkSync("/repo/optional-fs", "/repo/packages/safe-bash/dist/opt-in/fs");
    }
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("regular optional input");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("resolves declared public wildcard peer routes without copying their modules", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "@poe-platform/safe-bash/contracts/probe";');
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.d.ts", 'export * from "@poe-platform/safe-bash/contracts/probe";');
    const result = await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(result.at(-1)?.name).toBe("@poe-platform/safe-bash");
    expect(Object.keys(volume.toJSON()).filter(filename => filename.startsWith("/output/safe-bash/dist/safe-bash/opt-in/"))).toHaveLength(7);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
  });

  for (const extension of ["js", "d.ts"]) it(`rejects raw dot-segment public wildcard edges before normalization: ${extension}`, async () => {
    const { volume, options } = optionalArtifact();
    const packageDir = "/consumer/node_modules/@poe-platform/safe-bash";
    volume.mkdirSync(packageDir + "/dist/contracts", { recursive: true });
    volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports: bashManifest.exports }));
    volume.writeFileSync(packageDir + "/dist/index.d.ts", "export {};\n");
    volume.writeFileSync(packageDir + "/dist/contracts/probe.d.ts", "export {};\n");
    const host: ts.ModuleResolutionHost = {
      fileExists: filename => volume.existsSync(filename),
      readFile: filename => volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined,
      directoryExists: filename => volume.existsSync(filename) && volume.statSync(filename).isDirectory(),
      getCurrentDirectory: () => "/consumer",
      realpath: filename => filename,
    };
    const resolve = (specifier: string) => ts.resolveModuleName(specifier, "/consumer/main.mts", {
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }, host, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
    expect(resolve("@poe-platform/safe-bash/contracts/probe")?.resolvedFileName).toBe(packageDir + "/dist/contracts/probe.d.ts");
    const specifier = "@poe-platform/safe-bash/contracts/../index";
    expect(resolve(specifier)).toBeUndefined();
    volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, `export * from ${JSON.stringify(specifier)};`);
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
    expect(volume.existsSync("/output")).toBe(false);
    expect(options.bundle).not.toHaveBeenCalled();
  });

  for (const segment of [".", "%2e%2E", "node_modules", "%6eode_modules"]) {
    for (const extension of ["js", "d.ts"]) it(`rejects invalid public wildcard segment ${segment}: ${extension}`, async () => {
      const { volume, options } = optionalArtifact();
      const directory = `/repo/packages/safe-bash/dist/contracts/${segment}`;
      volume.mkdirSync(directory, { recursive: true });
      volume.writeFileSync(`${directory}/probe.${extension}`, "export {};\n");
      const specifier = `@poe-platform/safe-bash/contracts/${segment}/probe`;
      volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, `export * from ${JSON.stringify(specifier)};`);
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }

  it("refuses peer exports that target excluded optional modules", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports: { ...bashManifest.exports, "./leak": { import: "./dist/optional.js", types: "./dist/optional.d.ts" } } }));
    volume.writeFileSync("/repo/packages/safe-bash/dist/opt-in/optional.js", 'export * from "@poe-platform/safe-bash/leak";');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Unexported optional peer route");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("requires yaml to remain an optional peer", async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, peerDependenciesMeta: { yaml: { optional: false } } }));
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("optional yaml 2.9.0");
    expect(volume.existsSync("/output")).toBe(false);
  });

  for (const yaml of ["*", "^2.9.0", "2.8.0"]) it(`refuses an unqualified yaml peer version: ${yaml}`, async () => {
    const { volume, options } = optionalArtifact();
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, peerDependencies: { ...bashManifest.peerDependencies, yaml } }));
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("yaml");
    expect(volume.existsSync("/output")).toBe(false);
  });

  it("packages optional entries automatically without a separate artifact flag", () => {
    expect(parsePackageSafeArguments(["--out-dir", "/output", "--version", "1.2.3"])).toEqual({ outDir: "/output", version: "1.2.3" });
    expect(() => parsePackageSafeArguments(["--out-dir", "/output", "--version", "1.2.3", "--include-optional"])).toThrow();
    expect(() => parsePackageSafeArguments([])).toThrow("Usage:");
    expect(() => parsePackageSafeArguments(["--out-dir", "/output", "--version", "1.2.3", "--include-optional=false"])).toThrow();
  });
});

describe("optional peer export-pattern segment admission", () => {
  function peerFixture(fragment: string, extension: string) {
    const fixture = optionalArtifact();
    const { volume } = fixture;
    const packageDir = "/consumer/node_modules/@poe-platform/safe-bash";
    volume.mkdirSync(packageDir, { recursive: true });
    volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports: bashManifest.exports }));
    for (const directory of ["/repo/packages/safe-bash", packageDir]) {
      for (const name of ["probe", fragment]) {
        for (const suffix of ["js", "d.ts"]) {
          const filename = `${directory}/dist/contracts/${name}.${suffix}`;
          volume.mkdirSync(filename.slice(0, filename.lastIndexOf("/")), { recursive: true });
          volume.writeFileSync(filename, "export {};\n");
        }
      }
    }
    const host: ts.ModuleResolutionHost = {
      fileExists: filename => volume.existsSync(filename),
      readFile: filename => volume.existsSync(filename) ? volume.readFileSync(filename, "utf8").toString() : undefined,
      directoryExists: filename => volume.existsSync(filename) && volume.statSync(filename).isDirectory(),
      getCurrentDirectory: () => "/consumer",
      realpath: filename => filename,
    };
    const resolve = (specifier: string) => ts.resolveModuleName(specifier, "/consumer/main.mts", {
      module: ts.ModuleKind.NodeNext, moduleResolution: ts.ModuleResolutionKind.NodeNext,
    }, host, undefined, undefined, ts.ModuleKind.ESNext).resolvedModule;
    const specifier = `@poe-platform/safe-bash/contracts/${fragment}`;
    const statement = `export * from ${JSON.stringify(specifier)};`;
    volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, statement);
    return { ...fixture, resolve, specifier, statement, packageDir };
  }

  for (const fragment of [
    "nested\\..\\probe", "nested/..\\probe", "nested\\../probe", "nested\\.\\probe",
    "nested\\%2e%2E/probe", "nested\\.%2e\\probe", "nested\\node_modules\\probe",
    "nested/NoDe_MoDuLeS\\probe", "nested\\%6eode%5Fmodules/probe", "%2fprobe", "nested%5Cprobe",
  ]) {
    for (const extension of ["js", "d.ts"]) it(`rejects forbidden pattern fragment ${fragment}: ${extension}`, async () => {
      const { volume, options, resolve, specifier } = peerFixture(fragment, extension);
      expect(resolve("@poe-platform/safe-bash/contracts/probe")).toBeDefined();
      if (!fragment.includes("%2f") && !fragment.includes("%5C")) expect(resolve(specifier)).toBeUndefined();
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }

  for (const fragment of ["probe", ".probe", "...", "node_modules-extra", "nested/probe", "%70robe", "%2eprobe", "%252e%252e", "nested//probe"]) {
    for (const extension of ["js", "d.ts"]) it(`preserves allowed raw wildcard bytes ${fragment}: ${extension}`, async () => {
      const { volume, options, resolve, specifier, statement } = peerFixture(fragment, extension);
      expect(resolve(specifier)).toBeDefined();
      const result = await packageSafeLibraries({ ...options, outDir: "/output" });
      expect(result.at(-1)?.name).toBe("@poe-platform/safe-bash");
      expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/opt-in/optional.${extension}`, "utf8")).toBe(statement);
      expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
    });
  }

  for (const extension of ["js", "d.ts"]) it(`validates the substituted fragment independently of its export suffix: ${extension}`, async () => {
    const { volume, options } = optionalArtifact();
    const exports = { ...bashManifest.exports, "./contracts/*.js": { import: "./dist/contracts/*.js", types: "./dist/contracts/*.d.ts" } };
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
    volume.writeFileSync(`/repo/packages/safe-bash/dist/contracts/..${extension}`, "export {};\n");
    volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, 'export * from "@poe-platform/safe-bash/contracts/..js";');
    await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
    expect(volume.existsSync("/output")).toBe(false);
    expect(options.bundle).not.toHaveBeenCalled();
  });

  for (const extension of ["js", "d.ts"]) it(`preserves an exact export alias without treating its key as a wildcard fragment: ${extension}`, async () => {
    const { volume, options, resolve, specifier, statement, packageDir } = peerFixture("../probe", extension);
    const exports = { ...bashManifest.exports, "./contracts/../probe": { import: "./dist/contracts/probe.js", types: "./dist/contracts/probe.d.ts" } };
    volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
    volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports }));
    expect(resolve(specifier)?.resolvedFileName).toBe(packageDir + "/dist/contracts/probe.d.ts");
    await packageSafeLibraries({ ...options, outDir: "/output" });
    expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/opt-in/optional.${extension}`, "utf8")).toBe(statement);
    expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
  });

  for (const [fragment, pattern] of [["76alue", "%*"], ["%", "*76alue"]]) {
    for (const extension of ["js", "d.ts"]) it(`admits a percent escape completed by pattern substitution ${pattern}: ${extension}`, async () => {
      const { volume, options, resolve, specifier, statement, packageDir } = peerFixture(fragment, extension);
      const exports = { ...bashManifest.exports, "./contracts/*": { import: `./dist/contracts/${pattern}.js`, types: `./dist/contracts/${pattern}.d.ts` } };
      volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
      volume.writeFileSync(packageDir + "/package.json", JSON.stringify({ name: "@poe-platform/safe-bash", type: "module", exports }));
      for (const directory of ["/repo/packages/safe-bash", packageDir]) {
        for (const suffix of ["js", "d.ts"]) {
          volume.writeFileSync(`${directory}/dist/contracts/%76alue.${suffix}`, "export {};\n");
          volume.writeFileSync(`${directory}/dist/contracts/value.${suffix}`, "export {};\n");
        }
      }
      expect(resolve(specifier)?.resolvedFileName).toBe(packageDir + "/dist/contracts/%76alue.d.ts");
      const template = new URL(`./dist/contracts/${pattern}.${extension}`, pathToFileURL("/repo/packages/safe-bash/package.json"));
      const completed = new URL(template.href.replaceAll("*", fragment));
      expect(fileURLToPath(completed)).toBe(`/repo/packages/safe-bash/dist/contracts/value.${extension}`);
      expect(volume.existsSync(fileURLToPath(completed))).toBe(true);
      await packageSafeLibraries({ ...options, outDir: "/output" });
      expect(volume.readFileSync(`/output/safe-bash/dist/safe-bash/opt-in/optional.${extension}`, "utf8")).toBe(statement);
      expect(volume.existsSync("/output/safe-bash/dist/safe-bash/opt-in/contracts")).toBe(false);
    });
  }

  for (const fragment of ["2fvalue", "5Cvalue", "zz"]) {
    for (const extension of ["js", "d.ts"]) it(`refuses invalid completed URL encoding ${fragment}: ${extension}`, async () => {
      const { volume, options } = peerFixture(fragment, extension);
      const exports = { ...bashManifest.exports, "./contracts/*": { import: "./dist/contracts/%*.js", types: "./dist/contracts/%*.d.ts" } };
      volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
      for (const suffix of ["js", "d.ts"]) volume.writeFileSync(`/repo/packages/safe-bash/dist/contracts/%${fragment}.${suffix}`, "export {};\n");
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow();
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }

  for (const target of ["./dist/contracts/../contracts/*", "./dist/contracts/nested\\..\\*", "./dist/contracts/node_modules/*", "./dist/contracts/%2E%2e/*"]) {
    for (const extension of ["js", "d.ts"]) it(`refuses invalid selected export target ${target}: ${extension}`, async () => {
      const { volume, options } = optionalArtifact();
      const exports = { ...bashManifest.exports, "./contracts/*": { import: target + ".js", types: target + ".d.ts" } };
      volume.writeFileSync("/repo/packages/safe-bash/package.json", JSON.stringify({ ...bashManifest, exports }));
      const filename = "/repo/packages/safe-bash/" + target.replace("*", "probe") + "." + extension;
      volume.mkdirSync(filename.slice(0, filename.lastIndexOf("/")), { recursive: true });
      volume.writeFileSync(filename, "export {};\n");
      volume.writeFileSync(`/repo/packages/safe-bash/dist/opt-in/optional.${extension}`, 'export * from "@poe-platform/safe-bash/contracts/probe";');
      await expect(packageSafeLibraries({ ...options, outDir: "/output" })).rejects.toThrow("Invalid optional peer");
      expect(volume.existsSync("/output")).toBe(false);
      expect(options.bundle).not.toHaveBeenCalled();
    });
  }
});
