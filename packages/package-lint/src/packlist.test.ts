import { describe, expect, it } from "vitest";
import type { PackageInfo, WorkspaceModel } from "./model.js";
import { loadPackageFileView } from "./packlist.js";

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
