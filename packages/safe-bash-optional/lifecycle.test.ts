import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { createFsFromVolume, Volume } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const compiler = vi.hoisted(() => vi.fn());
const stage = vi.hoisted(() => vi.fn());
const lifecycleURL = new URL("./lifecycle.mjs", import.meta.url).href;
vi.mock("../safe-bash/scripts/build.mjs", () => ({ buildPackage: compiler }));
vi.mock("./build.mjs", () => ({ buildOptionalPackage: stage }));

describe("optional distribution production lifecycle", () => {
  let argv: string[];
  let exitCode: typeof process.exitCode;

  beforeEach(() => {
    argv = process.argv;
    exitCode = process.exitCode;
    process.argv = [process.execPath, fileURLToPath(new URL("./lifecycle.mjs", import.meta.url))];
    process.exitCode = undefined;
    vi.resetModules();
    compiler.mockReset();
    stage.mockReset();
  });

  afterEach(() => {
    process.argv = argv;
    process.exitCode = exitCode;
    vi.restoreAllMocks();
  });

  it("passes the actual compiler identity and module-relative checkout root to the stage", async () => {
    stage.mockResolvedValue({ status: 0 });
    await import(lifecycleURL);
    expect(stage).toHaveBeenCalledExactlyOnceWith({
      rootDir: fileURLToPath(new URL("../..", import.meta.url)),
      compile: compiler
    });
    expect(compiler).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(0);
  });

  it("does not claim success when the stage returns a failing status", async () => {
    stage.mockResolvedValue({ status: 2 });
    await import(lifecycleURL);
    expect(stage).toHaveBeenCalledTimes(1);
    expect(process.exitCode).toBe(2);
  });

  it("refuses caller options before compilation or materialization", async () => {
    process.argv.push("--project", "other.json");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await import(lifecycleURL);
    expect(stage).not.toHaveBeenCalled();
    expect(compiler).not.toHaveBeenCalled();
    expect(process.exitCode).toBe(1);
    expect(error).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ message: "Optional workspace build accepts no arguments" }));
  });

  for (const reason of [undefined, null, false, 0, "", new Error("compiler failure")]) {
    it(`reports the exact rejected stage reason ${String(reason)} without retrying`, async () => {
      stage.mockRejectedValue(reason);
      const error = vi.spyOn(console, "error").mockImplementation(() => {});
      await import(lifecycleURL);
      expect(stage).toHaveBeenCalledTimes(1);
      expect(compiler).not.toHaveBeenCalled();
      expect(process.exitCode).toBe(1);
      expect(error).toHaveBeenCalledExactlyOnceWith(reason);
    });
  }

  it("admits the private checkout manifest without unpublished public install dependencies", async () => {
    const { buildOptionalPackage } = await vi.importActual<{ buildOptionalPackage: (options: unknown) => Promise<unknown> }>("./build.mjs");
    const root = "/repo";
    const core = root + "/packages/safe-bash";
    const manifest = readFileSync(new URL("./package.json", import.meta.url), "utf8");
    const fileSystem = createFsFromVolume(Volume.fromJSON({
      [root + "/packages/safe-bash-optional/package.json"]: manifest,
      [root + "/packages/safe-fs/package.json"]: JSON.stringify({ exports: {} }),
      [core + "/package.json"]: JSON.stringify({ files: ["dist", "!dist/optional.js", "!dist/optional.d.ts"] }),
      [core + "/tsconfig.optional.json"]: JSON.stringify({ compilerOptions: { rootDir: "src", outDir: "dist", declaration: true }, files: ["src/optional.ts"] }),
      [core + "/src/optional.ts"]: "export {};\n"
    }));
    const reachedCompiler = new Error("fresh compiler admitted");
    const compile = vi.fn(async () => { throw reachedCompiler; });
    await expect(buildOptionalPackage({ rootDir: root, compile, fileSystem })).rejects.toBe(reachedCompiler);
    expect(compile).toHaveBeenCalledExactlyOnceWith({ root: core, profile: "optional", fileSystem });
    expect(fileSystem.existsSync(root + "/packages/safe-bash-optional/dist/optional.js")).toBe(false);
  });
});
