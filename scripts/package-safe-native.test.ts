import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { packageSafeLibraries } from "./package-safe.mjs";
import { buildNativeAssets } from "../packages/safe-fs/scripts/native-assets.mjs";

async function fixture() {
  const registry = {
    version: 1, specifier: "#safe-fs-native-seek", directory: "native/fs-seek", source: "native/seek.c",
    loader: "native/loader.mjs", declaration: "src/native/loader.d.ts", napi: 6, maxBinaryBytes: 1048576,
    targets: [{ platform: "linux", arch: "x64", libc: "glibc", minimumLibc: "2.31" }],
  };
  const volume = Volume.fromJSON({
    "/repo/package.json": JSON.stringify({ license: "MIT", exports: {} }),
    "/repo/packages/safe-fs/package.json": JSON.stringify({ name: "@poe-code/safe-fs", exports: {
      ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
      "./core": { types: "./dist/core.d.ts", import: "./dist/core.js" },
      "./node": { types: "./dist/index.d.ts", import: "./dist/index.js" },
    } }),
    "/repo/packages/safe-js/package.json": JSON.stringify({ name: "private-js", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
    "/repo/packages/safe-bash/package.json": JSON.stringify({ name: "private-bash", exports: { ".": { types: "./dist/index.d.ts", import: "./dist/index.js" } } }),
    "/repo/packages/safe-fs/native/assets.json": JSON.stringify(registry),
    "/repo/packages/safe-fs/native/seek.c": "native source fixture",
    "/repo/packages/safe-fs/native/loader.mjs": "export async function loadBinding() { return {}; }",
    "/repo/packages/safe-fs/src/native/loader.d.ts": "export declare function loadBinding(): Promise<unknown>;",
    "/repo/packages/safe-fs/dist/package.json": JSON.stringify({ type: "module" }),
    "/repo/packages/safe-fs/dist/index.js": 'export async function seek() { return import("#safe-fs-native-seek"); }',
    "/repo/packages/safe-fs/dist/index.d.ts": "export declare function seek(): Promise<unknown>;",
    "/repo/packages/safe-fs/dist/core.js": "export const core = true;",
    "/repo/packages/safe-fs/dist/core.d.ts": "export declare const core: true;",
    "/repo/packages/safe-fs/dist/node-host.js": 'export { seek } from "./index.js";',
    "/repo/packages/safe-fs/dist/node-host.d.ts": 'export { seek } from "./index.js";',
    "/repo/packages/safe-fs/dist/node-unavailable.d.ts": "export {};",
    "/repo/packages/safe-js/dist/index.js": 'export { core } from "poe-code/safe-fs/core";',
    "/repo/packages/safe-js/dist/index.d.ts": 'export { core } from "poe-code/safe-fs/core";',
    "/repo/packages/safe-bash/dist/index.js": 'export { core } from "poe-code/safe-fs/core";',
    "/repo/packages/safe-bash/dist/index.d.ts": 'export { core } from "poe-code/safe-fs/core";',
    ...Object.fromEntries(["safe-fs", "safe-js", "safe-bash"].map(name => [`/repo/packages/${name}/README.md`, `# ${name}`])),
    ...Object.fromEntries(["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"].map(name => [`/headers/${name}`, "header"])),
    "/usr/bin/cc": "compiler",
  });
  const files = createFsFromVolume(volume).promises;
  const binary = Uint8Array.of(255, 0, 128, 245);
  await buildNativeAssets({ rootDir: "/repo", files, host: { platform: "linux", arch: "x64", libc: "glibc", libcVersion: "2.31" },
    headers: { directory: "/headers", version: "1.9.0" },
    compile: async (_command: string, args: string[]) => {
      if (args.includes("-o")) await files.writeFile(args[args.indexOf("-o") + 1]!, binary);
      return { stdout: "compiler", stderr: "" };
    },
  });
  const bundle = vi.fn(async () => ({ outputFiles: [{ path: "/repo/packages/safe-js/dist/index.js",
    contents: Buffer.from('export { core } from "@poe-platform/safe-fs/core";') }] }));
  return { files, binary, options: { rootDir: "/repo", outDir: "/output", version: "0.1.0", files, bundle } };
}

describe("native standalone assets", () => {
  it("copies only SafeFS native assets as opaque bytes with the derived private map", async () => {
    const setup = await fixture();
    const originalRead = setup.files.readFile.bind(setup.files);
    vi.spyOn(setup.files, "readFile").mockImplementation((async (filename: string, options?: unknown) => {
      if (filename.endsWith(".node")) expect(options).not.toBe("utf8");
      return originalRead(filename, options as never);
    }) as typeof setup.files.readFile);
    await packageSafeLibraries(setup.options);
    const manifest = JSON.parse(await setup.files.readFile("/output/safe-fs/package.json", "utf8"));
    expect(manifest.imports["#safe-fs-native-seek"]).toEqual({ types: "./dist/safe-fs/native/fs-seek/loader.d.ts",
      workerd: null, browser: null, default: "./dist/safe-fs/native/fs-seek/loader.mjs" });
    expect(manifest.dependencies).toEqual({});
    expect(await setup.files.readFile("/output/safe-fs/dist/safe-fs/native/fs-seek/linux-x64-glibc.node")).toEqual(Buffer.from(setup.binary));
    for (const name of ["safe-js", "safe-bash"]) {
      await expect(setup.files.stat(`/output/${name}/dist/safe-fs/native`)).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("refuses a changed binary before package assembly", async () => {
    const setup = await fixture();
    await setup.files.writeFile("/repo/packages/safe-fs/dist/native/fs-seek/linux-x64-glibc.node", "changed");
    await expect(packageSafeLibraries(setup.options)).rejects.toThrow("native binary");
  });

  it("does not admit the private native edge in another package", async () => {
    const setup = await fixture();
    await setup.files.writeFile("/repo/packages/safe-bash/dist/index.js", 'export { loadBinding } from "#safe-fs-native-seek";');
    await expect(packageSafeLibraries(setup.options)).rejects.toThrow("Filesystem implementation leaked");
  });
});
