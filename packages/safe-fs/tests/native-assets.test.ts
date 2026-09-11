import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { createHash } from "node:crypto";
import { buildNativeAssets, copyNativeAssets, readBuiltNativeAssets, readNativeRegistry } from "../scripts/native-assets.mjs";

const registry = {
  version: 1, specifier: "#safe-fs-native-seek", directory: "native/fs-seek",
  source: "native/seek.c", loader: "native/loader.mjs", declaration: "src/native/loader.d.ts",
  napi: 6, maxBinaryBytes: 1048576,
  targets: [{ platform: "linux", arch: "x64", libc: "glibc", minimumLibc: "2.31" }],
};
const host = { platform: "linux", arch: "x64", libc: "glibc", libcVersion: "2.31" };
const headerNames = ["node_api.h", "node_api_types.h", "js_native_api.h", "js_native_api_types.h"];

function fixture() {
  const volume = Volume.fromJSON({
    "/repo/packages/safe-fs/native/assets.json": JSON.stringify(registry),
    "/repo/packages/safe-fs/native/seek.c": "original native source",
    "/repo/packages/safe-fs/native/loader.mjs": "export const loadBinding = async () => ({});",
    "/repo/packages/safe-fs/src/native/loader.d.ts": "export declare function loadBinding(): Promise<unknown>;",
    "/repo/packages/safe-fs/dist/package.json": JSON.stringify({ type: "module", imports: { "#safe-fs-platform": { default: "./platform/node.js" } } }),
    "/usr/bin/cc": "compiler fixture",
    ...Object.fromEntries(headerNames.map(name => [`/headers/${name}`, `header ${name}`])),
  });
  const filesystem = createFsFromVolume(volume);
  const files = filesystem.promises;
  const binary = Uint8Array.from([255, 0, 128, 13, 10, 250]);
  const compile = vi.fn(async (_command: string, args: string[]) => {
    if (args.includes("--version")) return { stdout: "fixture compiler 1.0\n", stderr: "" };
    await files.writeFile(args[args.indexOf("-o") + 1]!, binary);
    return { stdout: "", stderr: "" };
  });
  const options = { rootDir: "/repo", files, host, headers: { directory: "/headers", version: "1.9.0" }, compile };
  return { volume, files, binary, compile, options };
}

describe("native build assets", () => {
  it.each([false, null, 0, "", undefined])("preserves falsey read failures over cleanup failures: %s", async reason => {
    const setup = fixture();
    const close = vi.fn().mockRejectedValue(new Error("cleanup"));
    vi.spyOn(setup.files, "open").mockResolvedValue({ stat: vi.fn().mockRejectedValue(reason), close } as never);
    await expect(readNativeRegistry({ rootDir: "/repo", files: setup.files })).rejects.toBe(reason);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([false, null, 0, "", undefined])("preserves falsey compiler failures over staging cleanup failures: %s", async reason => {
    const setup = fixture();
    setup.compile.mockRejectedValueOnce(reason);
    const cleanup = vi.spyOn(setup.files, "rm").mockRejectedValue(new Error("cleanup"));
    await expect(buildNativeAssets(setup.options)).rejects.toBe(reason);
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("emits a bounded opaque binary and derived private mapping without replacing other imports", async () => {
    const setup = fixture();
    const result = await buildNativeAssets(setup.options);
    const output = "/repo/packages/safe-fs/dist/native/fs-seek";
    expect(await setup.files.readFile(`${output}/linux-x64-glibc.node`)).toEqual(Buffer.from(setup.binary));
    expect(result.manifest.targets).toEqual([{ ...registry.targets[0], size: setup.binary.length,
      sha256: createHash("sha256").update(setup.binary).digest("hex") }]);
    const manifest = JSON.parse(await setup.files.readFile("/repo/packages/safe-fs/dist/package.json", "utf8"));
    expect(manifest.imports["#safe-fs-platform"]).toEqual({ default: "./platform/node.js" });
    expect(manifest.imports[registry.specifier]).toEqual({ types: "./native/fs-seek/loader.d.ts", workerd: null,
      browser: null, default: "./native/fs-seek/loader.mjs" });
    const invocation = setup.compile.mock.calls.find(([, args]) => args.includes("-o"))!;
    expect(invocation[0]).toBe("/usr/bin/cc");
    expect(invocation[1]).toContain("-DNAPI_VERSION=6");
    expect(invocation[1]).toContain("-D_FILE_OFFSET_BITS=64");
    expect((await setup.files.readdir("/repo/packages/safe-fs/dist")).filter(name => name.startsWith(".native-build-"))).toEqual([]);
  });

  it("copies exactly the authenticated workspace closure and preserves nontext bytes", async () => {
    const setup = fixture();
    await buildNativeAssets(setup.options);
    await copyNativeAssets({ rootDir: "/repo", outDir: "/consumer/dist/safe-fs", files: setup.files });
    const directory = "/consumer/dist/safe-fs/native/fs-seek";
    expect((await setup.files.readdir(directory)).sort()).toEqual(["linux-x64-glibc.node", "loader.d.ts", "loader.mjs", "manifest.json"]);
    expect(await setup.files.readFile(`${directory}/linux-x64-glibc.node`)).toEqual(Buffer.from(setup.binary));
  });

  it.each(["../outside", "/outside", "native/../../outside", "native\\outside"])("rejects escaping registry directory %s before compilation", async directory => {
    const setup = fixture();
    await setup.files.writeFile("/repo/packages/safe-fs/native/assets.json", JSON.stringify({ ...registry, directory }));
    await expect(buildNativeAssets(setup.options)).rejects.toThrow();
    expect(setup.compile).not.toHaveBeenCalled();
  });

  it("rejects missing headers before compiler dispatch", async () => {
    const setup = fixture();
    await setup.files.unlink("/headers/node_api.h");
    await expect(buildNativeAssets(setup.options)).rejects.toThrow();
    expect(setup.compile).not.toHaveBeenCalled();
  });

  it("rejects symlinked source inputs", async () => {
    const setup = fixture();
    await setup.files.rename("/repo/packages/safe-fs/native/seek.c", "/outside.c");
    await setup.files.symlink("/outside.c", "/repo/packages/safe-fs/native/seek.c");
    await expect(buildNativeAssets(setup.options)).rejects.toThrow();
    expect(setup.compile).not.toHaveBeenCalled();
  });

  it.each(["binary", "loader", "source"])("rejects stale %s before copying", async kind => {
    const setup = fixture();
    await buildNativeAssets(setup.options);
    const filename = kind === "source" ? "/repo/packages/safe-fs/native/seek.c"
      : `/repo/packages/safe-fs/dist/native/fs-seek/${kind === "binary" ? "linux-x64-glibc.node" : "loader.mjs"}`;
    await setup.files.writeFile(filename, "changed");
    await expect(readBuiltNativeAssets({ rootDir: "/repo", files: setup.files })).rejects.toThrow();
  });

  it("keeps unsupported hosts portable without invoking a compiler", async () => {
    const setup = fixture();
    const result = await buildNativeAssets({ ...setup.options, host: { platform: "darwin", arch: "arm64" } });
    expect(result.manifest.targets).toEqual([]);
    expect(result.manifest.build.compiler).toBeNull();
    expect(setup.compile).not.toHaveBeenCalled();
  });

  it("retires only registered stale binaries when rebuilding and copying an unsupported target", async () => {
    const setup = fixture();
    await buildNativeAssets(setup.options);
    await copyNativeAssets({ rootDir: "/repo", outDir: "/consumer", files: setup.files });
    setup.compile.mockClear();
    await buildNativeAssets({ ...setup.options, host: { platform: "darwin", arch: "arm64" } });
    await copyNativeAssets({ rootDir: "/repo", outDir: "/consumer", files: setup.files });
    for (const directory of ["/repo/packages/safe-fs/dist/native/fs-seek", "/consumer/native/fs-seek"]) {
      expect((await setup.files.readdir(directory)).sort()).toEqual(["loader.d.ts", "loader.mjs", "manifest.json"]);
    }
    expect(setup.compile).not.toHaveBeenCalled();
  });

  it("preserves unexpected files and registered binaries when publication admission fails", async () => {
    const setup = fixture();
    await buildNativeAssets(setup.options);
    const directory = "/repo/packages/safe-fs/dist/native/fs-seek";
    await setup.files.writeFile(`${directory}/unowned.node`, "preserve");
    await expect(buildNativeAssets({ ...setup.options, host: { platform: "darwin", arch: "arm64" } })).rejects.toThrow("unexpected native output");
    expect(await setup.files.readFile(`${directory}/unowned.node`, "utf8")).toBe("preserve");
    expect(await setup.files.readFile(`${directory}/linux-x64-glibc.node`)).toEqual(Buffer.from(setup.binary));
  });

  it("does not publish an oversized compiler result", async () => {
    const setup = fixture();
    setup.compile.mockImplementation(async (_command, args) => {
      if (args.includes("-o")) await setup.files.writeFile(args[args.indexOf("-o") + 1]!, new Uint8Array(1048577));
      return { stdout: "compiler", stderr: "" };
    });
    await expect(buildNativeAssets(setup.options)).rejects.toThrow();
    await expect(setup.files.stat("/repo/packages/safe-fs/dist/native/fs-seek/manifest.json")).rejects.toMatchObject({ code: "ENOENT" });
  });
});
