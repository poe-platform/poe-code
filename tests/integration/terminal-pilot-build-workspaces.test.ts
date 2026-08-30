import { readFileSync, statSync } from "node:fs";
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { compileFunction } from "node:vm";
import { describe, expect, it } from "vitest";
import { resolveBundleGraph } from "../../scripts/bundle-graph.mjs";

const ROOT = path.resolve(import.meta.dirname, "..", "..");

type ReadManifest = (file: string, encoding: "utf8") => Promise<string>;
type WorkspaceScan = {
  aliases: Record<string, string>;
  names: string[];
  external: string[];
};
type Scanner = (
  readdir: typeof fs.readdir,
  readFile: ReadManifest,
  paths: typeof path,
  rootDir: string,
  packageDir: string,
  resolveGraph: typeof resolveBundleGraph
) => Promise<WorkspaceScan>;

function loadScanner(script: string, rootBundle: boolean): Scanner {
  const filename = path.join(ROOT, script);
  const metadata = statSync(filename);
  expect(metadata.isFile()).toBe(true);
  expect(metadata.size).toBeLessThanOrEqual(64 * 1024);
  const source = readFileSync(filename, "utf8");
  const first = 'const packagesDir = path.join(rootDir, "packages");';
  const last = rootBundle
    ? "const consumerBuildOptions = {"
    : 'async function getEntryPoints(directory, relative = "") {';
  expect(source.split(first)).toHaveLength(2);
  expect(source.split(last)).toHaveLength(2);
  expect(source.indexOf(last)).toBeGreaterThan(source.indexOf(first));
  const body = source.slice(source.indexOf(first), source.indexOf(last));
  expect(body).not.toContain("esbuild.build(");
  expect(body).not.toContain("copyTerminalPngAssets(");
  return compileFunction(
    `return (async () => {
${body}
return { aliases: workspaceAliases, names: [...workspacePackageNames], external: ${rootBundle ? "externalDeps" : "external"} };
})();`,
    ["readdir", "readFile", "path", "rootDir", "packageDir", "resolveBundleGraph"]
  ) as Scanner;
}

const scanners = [
  {
    name: "terminal-pilot",
    script: "packages/terminal-pilot/scripts/build.mjs",
    packageName: "terminal-pilot",
    rootBundle: false
  },
  {
    name: "terminal-pilot-mcp",
    script: "packages/terminal-pilot-mcp/scripts/build.mjs",
    packageName: "terminal-pilot-mcp",
    rootBundle: false
  },
  {
    name: "root bundle",
    script: "scripts/bundle.mjs",
    packageName: "terminal-pilot",
    rootBundle: true
  }
].map(scanner => ({ ...scanner, scan: loadScanner(scanner.script, scanner.rootBundle) }));

async function withWorkspace(
  scanner: (typeof scanners)[number],
  operation: (fixture: {
    root: string;
    reads: string[];
    readFile: ReadManifest;
    invoke: (read?: ReadManifest, enumerate?: typeof fs.readdir) => Promise<WorkspaceScan>;
  }) => Promise<void>
): Promise<void> {
  const root = await fs.mkdtemp(path.join(tmpdir(), "terminal-pilot-workspaces-"));
  try {
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({
      dependencies: { "@poe-code/safe-js": "*", commander: "1" },
      optionalDependencies: { "optional-only": "1" }
    }), { flag: "wx" });
    const manifests = {
      [scanner.packageName]: {
        name: scanner.packageName,
        dependencies: { "@poe-code/safe-js": "*", commander: "1" }
      },
      "safe-fs": {
        name: "@poe-code/safe-fs",
        exports: {
          ".": { types: "./dist/index.d.ts", import: "./dist/index.js" },
          "./errors": "./dist/errors.js"
        },
        dependencies: { yaml: "1" },
        peerDependencies: { jose: "1" }
      },
      "safe-js": {
        name: "@poe-code/safe-js",
        exports: { "./commands": { import: "./dist/commands/index.js" } },
        dependencies: { "@poe-code/safe-fs": "*" }
      }
    };
    for (const [directory, manifest] of Object.entries(manifests)) {
      const packageDir = path.join(root, "packages", directory);
      await fs.mkdir(packageDir, { recursive: true });
      await fs.writeFile(path.join(packageDir, "package.json"), JSON.stringify(manifest), {
        flag: "wx"
      });
    }
    const reads: string[] = [];
    const readFile: ReadManifest = (file, encoding) => {
      reads.push(file);
      return fs.readFile(file, encoding);
    };
    await operation({
      root,
      reads,
      readFile,
      invoke: (read = readFile, enumerate = fs.readdir) =>
        scanner.scan(
          enumerate,
          read,
          path,
          root,
          path.join(root, "packages", scanner.packageName),
          (directory, packages) => resolveBundleGraph(directory, packages, { readFile: read })
        )
    });
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function expectCanonical(
  result: WorkspaceScan,
  root: string,
  scanner: (typeof scanners)[number]
): void {
  expect(result.names.sort()).toEqual([
    "@poe-code/safe-fs",
    "@poe-code/safe-js",
    scanner.packageName
  ]);
  const main = scanner.rootBundle ? "src/index.ts" : "src";
  expect(result.aliases).toEqual({
    "@poe-code/safe-fs": path.join(root, "packages/safe-fs", main),
    "@poe-code/safe-fs/errors": path.join(root, "packages/safe-fs/src/errors.ts"),
    "@poe-code/safe-js": path.join(root, "packages/safe-js", main),
    "@poe-code/safe-js/commands": path.join(root, "packages/safe-js/src/commands/index.ts"),
    [scanner.packageName]: path.join(root, "packages", scanner.packageName, main)
  });
  expect(result.external.sort()).toEqual(scanner.rootBundle
    ? ["commander", "node:*", "optional-only", "yaml"]
    : ["commander", "jose", "node:*", "yaml"]);
}

describe.each(scanners)("$name build workspace manifests", scanner => {
  it("retains canonical names, actual exports and dependency externalization", () =>
    withWorkspace(scanner, async ({ root, invoke }) => {
      expectCanonical(await invoke(), root, scanner);
    }));

  it("ignores manifestless old safejs output without reading or changing assets", () =>
    withWorkspace(scanner, async ({ root, reads, invoke }) => {
      const stale = path.join(root, "packages/safejs/dist/index.js");
      await fs.mkdir(path.dirname(stale), { recursive: true });
      await fs.writeFile(stale, "excluded old output must remain unchanged\n", { flag: "wx" });
      await fs.mkdir(path.join(root, "packages/not-a-package"));
      await fs.writeFile(path.join(root, "packages/readme.txt"), "not a directory", { flag: "wx" });
      const before = await fs.stat(stale);

      expectCanonical(await invoke(), root, scanner);

      expect(reads).not.toContain(stale);
      expect(reads.every(file => path.basename(file) === "package.json")).toBe(true);
      expect(await fs.readFile(stale, "utf8")).toBe("excluded old output must remain unchanged\n");
      const after = await fs.stat(stale);
      expect([after.ino, after.size, after.mtimeMs, after.mode]).toEqual([
        before.ino, before.size, before.mtimeMs, before.mode
      ]);
    }));

  it("does not hide a malformed real manifest beside a manifestless legacy directory", () =>
    withWorkspace(scanner, async ({ root, invoke }) => {
      await fs.mkdir(path.join(root, "packages/safejs/dist"), { recursive: true });
      await fs.writeFile(path.join(root, "packages/safe-js/package.json"), "{broken");
      await expect(invoke()).rejects.toMatchObject({ name: "SyntaxError" });
    }));

  it("preserves its existing type-only subpath export contract", () =>
    withWorkspace(scanner, async ({ root, invoke }) => {
      const filename = path.join(root, "packages/safe-fs/package.json");
      const manifest = JSON.parse(await fs.readFile(filename, "utf8")) as {
        exports: Record<string, unknown>;
      };
      manifest.exports["./types"] = { types: "./dist/types.d.ts" };
      await fs.writeFile(filename, JSON.stringify(manifest));
      if (scanner.rootBundle) {
        await expect(invoke()).rejects.toThrow(
          '@poe-code/safe-fs export "./types" must target ./dist/*.js'
        );
      } else {
        expectCanonical(await invoke(), root, scanner);
      }
    }));

  it("rejects a package.json directory", () =>
    withWorkspace(scanner, async ({ root, invoke }) => {
      await fs.mkdir(path.join(root, "packages/bad/package.json"), { recursive: true });
      await expect(invoke()).rejects.toMatchObject({ code: "EISDIR" });
    }));

  it.each(["EACCES", "ENOTDIR", "EIO"])("preserves real-manifest %s failures", code =>
    withWorkspace(scanner, async ({ root, readFile, invoke }) => {
      const failure = Object.assign(new Error(code), { code });
      await expect(invoke((file, encoding) =>
        file === path.join(root, "packages/safe-js/package.json")
          ? Promise.reject(failure)
          : readFile(file, encoding)
      )).rejects.toBe(failure);
    }));

  it.each([
    ["undefined", undefined],
    ["null", null],
    ["false", false],
    ["zero", 0],
    ["negative-zero", -0],
    ["empty", ""],
    ["NaN", NaN]
  ] as const)("preserves falsey real-manifest failures: %s", (_label, reason) =>
    withWorkspace(scanner, async ({ root, readFile, invoke }) => {
      await expect(invoke((file, encoding) =>
        file === path.join(root, "packages/safe-js/package.json")
          ? Promise.reject(reason)
          : readFile(file, encoding)
      )).rejects.toBe(reason);
    }));

  it("keeps workspace enumeration errors fatal", () =>
    withWorkspace(scanner, async ({ readFile, invoke }) => {
      const failure = Object.assign(new Error("enumeration failed"), { code: "EIO" });
      await expect(invoke(readFile, async () => { throw failure; })).rejects.toBe(failure);
    }));

  it("does not mistake a missing packages root for a manifestless child", () =>
    withWorkspace(scanner, async ({ root, invoke }) => {
      await fs.rm(path.join(root, "packages"), { recursive: true });
      await expect(invoke()).rejects.toMatchObject({ code: "ENOENT" });
    }));
});
