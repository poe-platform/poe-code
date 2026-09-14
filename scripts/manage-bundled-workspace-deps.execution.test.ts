import path from "node:path";
import { fileURLToPath } from "node:url";
import { vol } from "memfs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { execFileSync } = vi.hoisted(() => ({ execFileSync: vi.fn() }));

vi.mock("node:child_process", () => ({ execFileSync }));
vi.mock("node:fs", async () => (await import("memfs")).fs);

const scriptPath = fileURLToPath(new URL("./manage-bundled-workspace-deps.mjs", import.meta.url));
const root = path.dirname(path.dirname(scriptPath));
const packageDir = path.join(root, "packages", "pack-fixture");
const dependencyDir = path.join(root, "packages", "pack-dependency");
const originalArgv = process.argv;
const dependency = { name: "pack-dependency", version: "1.0.0", license: "MIT" };

beforeEach(() => {
  vi.resetModules();
  execFileSync.mockReset();
  vol.reset();
  vol.fromJSON({
    [path.join(packageDir, "package.json")]: JSON.stringify({
      name: "pack-fixture", version: "1.0.0", license: "MIT"
    }),
    [path.join(packageDir, "dist", "composition.json")]: "original composition",
    [path.join(dependencyDir, "package.json")]: JSON.stringify(dependency)
  });
  process.argv = [process.execPath, scriptPath, "prepare", packageDir, dependency.name];
  execFileSync.mockImplementation((command: string, args: string[]) => {
    if (command === "tar") {
      const destination = path.join(args[args.indexOf("-C") + 1], "package");
      vol.mkdirSync(destination, { recursive: true });
      vol.writeFileSync(path.join(destination, "package.json"), JSON.stringify(dependency));
      return "";
    }
    return JSON.stringify([{ filename: "pack-dependency-1.0.0.tgz" }]);
  });
});

afterEach(() => {
  process.argv = originalArgv;
  vi.unstubAllEnvs();
  vol.reset();
});

describe("bundled workspace packaging execution", () => {
  it.each([
    "/compatible/npm/bin/npm-cli.js",
    "/manager with spaces/npm-cli.js",
    "/manager-λ/npm-cli.js",
    undefined,
    ""
  ])("retains the invoking npm executable %s without changing archive arguments", async (npmExecPath) => {
    vi.stubEnv("npm_execpath", npmExecPath);

    await import("./manage-bundled-workspace-deps.mjs");

    expect(execFileSync).toHaveBeenCalledTimes(2);
    const [command, args, options] = execFileSync.mock.calls[0];
    expect(command).toBe(npmExecPath ? process.execPath : "npm");
    expect(args).toEqual([
      ...(npmExecPath ? [npmExecPath] : []),
      "pack", dependencyDir, "--json", "--pack-destination", expect.any(String), "--dry-run=false"
    ]);
    expect(options).toEqual({ cwd: root, encoding: "utf8" });
    expect(execFileSync.mock.calls[1][0]).toBe("tar");
    expect(process.env.npm_execpath).toBe(npmExecPath);
    expect(JSON.parse(vol.readFileSync(path.join(packageDir, "dist", "composition.json"), "utf8") as string))
      .toMatchObject({ schemaVersion: 1, packages: expect.arrayContaining([dependency]) });

    vi.resetModules();
    process.argv = [process.execPath, scriptPath, "cleanup", packageDir];
    await import("./manage-bundled-workspace-deps.mjs");

    expect(execFileSync).toHaveBeenCalledTimes(2);
    expect(vol.existsSync(path.join(packageDir, "node_modules"))).toBe(false);
    expect(vol.existsSync(path.join(packageDir, ".bundled-workspace-deps.json"))).toBe(false);
    expect(vol.readFileSync(path.join(packageDir, "dist", "composition.json"), "utf8"))
      .toBe("original composition");
  });

  it.each(["/compatible/npm/bin/npm-cli.js", undefined])(
    "propagates the selected manager failure without invoking tar (%s)",
    async (npmExecPath) => {
      vi.stubEnv("npm_execpath", npmExecPath);
      const failure = new Error("pack failed");
      execFileSync.mockImplementation(() => { throw failure; });

      await expect(import("./manage-bundled-workspace-deps.mjs")).rejects.toBe(failure);

      expect(execFileSync).toHaveBeenCalledTimes(1);
      expect(execFileSync.mock.calls[0][0]).toBe(npmExecPath ? process.execPath : "npm");
      expect(vol.existsSync(path.join(packageDir, ".bundled-workspace-deps.json"))).toBe(false);
      expect(vol.readFileSync(path.join(packageDir, "dist", "composition.json"), "utf8"))
        .toBe("original composition");
    }
  );
});
