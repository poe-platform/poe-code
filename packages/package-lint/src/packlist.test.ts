import { describe, expect, it } from "vitest";
import { memLintFs } from "./fixtures.js";
import type { PackageInfo, WorkspaceModel } from "./model.js";
import { createNpmPacklistProvider, loadPackageFileView } from "./packlist.js";

const root: PackageInfo = {
  name: "root",
  dir: ".",
  isRoot: true,
  private: true,
  version: "1.0.0",
  dependencies: {},
  peerDependencies: {},
  optionalDependencies: {},
  bundledDependencies: [],
  repositoryDirectory: undefined,
  ecosystem: "npm",
  exports: undefined,
  bin: {},
  files: [],
  scripts: {},
  runtimeAssets: [],
  hasReadme: true
};

const agent: PackageInfo = {
  ...root,
  name: "agent",
  dir: "packages/agent",
  isRoot: false
};

describe("loadPackageFileView", () => {
  it("loads root and package packlists through the provider", async () => {
    const model: Pick<WorkspaceModel, "root" | "packages"> = {
      root,
      packages: [agent]
    };
    const calls: string[] = [];
    const view = await loadPackageFileView(
      {
        async listPackageFiles(rootDir, packageDir) {
          calls.push(`${rootDir}:${packageDir}`);
          return new Set(packageDir === "." ? ["dist/index.js"] : ["dist/templates/x.md"]);
        }
      },
      { rootDir: "/repo", model }
    );

    expect(calls).toEqual(["/repo:.", "/repo:packages/agent"]);
    expect(view.get(".")?.files.has("dist/index.js")).toBe(true);
    expect(view.get("packages/agent")?.files.has("dist/templates/x.md")).toBe(true);
  });
});

describe("createNpmPacklistProvider", () => {
  it("expands real declaration globs without packaging runtime or source-map files", async () => {
    const fs = memLintFs({
      "/repo/package.json": JSON.stringify({ files: ["dist", "packages/safe-fs/dist/**/*.d.ts"] }),
      "/repo/dist/index.js": "export {};",
      "/repo/packages/safe-fs/dist/index.d.ts": 'export * from "./contracts/filesystem.js";',
      "/repo/packages/safe-fs/dist/contracts/filesystem.d.ts": "export interface FileSystem {}",
      "/repo/packages/safe-fs/dist/index.js": "throw new Error('duplicate runtime');",
      "/repo/packages/safe-fs/dist/index.d.ts.map": "{}",
      "/repo/packages/safe-fs/dist/contracts/filesystem.js": "export {};"
    });
    expect(await createNpmPacklistProvider(fs).listPackageFiles("/repo", ".")).toEqual(
      new Set([
        "dist/index.js",
        "packages/safe-fs/dist/index.d.ts",
        "packages/safe-fs/dist/contracts/filesystem.d.ts"
      ])
    );
  });

  it("does not invent an entry for a declaration glob whose directory is missing", async () => {
    const fs = memLintFs({
      "/repo/package.json": JSON.stringify({ files: ["packages/safe-fs/dist/**/*.d.ts"] })
    });
    expect(await createNpmPacklistProvider(fs).listPackageFiles("/repo", ".")).toEqual(new Set());
  });

  it("lists package files from package.json files entries through the provided filesystem", async () => {
    const fs = memLintFs({
      "/repo/packages/agent/package.json": JSON.stringify({ files: ["dist", "README.md"] }),
      "/repo/packages/agent/dist/index.js": "export {};\n",
      "/repo/packages/agent/dist/templates/x.md": "# x\n",
      "/repo/packages/agent/README.md": "# agent\n",
      "/repo/packages/agent/src/index.ts": "export {};\n"
    });

    const files = await createNpmPacklistProvider(fs).listPackageFiles("/repo", "packages/agent");

    expect([...files].sort()).toEqual(["README.md", "dist/index.js", "dist/templates/x.md"]);
  });
});
