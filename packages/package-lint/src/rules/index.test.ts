import "./bundle-self-contained.test.cases.js";
import "./bundled-transitive-npm-dep-unbundled.test.cases.js";
import "./exports-subpath-resolvable.test.cases.js";
import "./imported-workspace-dep-unresolvable.test.cases.js";
import "./lockstep-release-group-valid.test.cases.js";
import "./no-cross-package-relative-import.test.cases.js";
import "./no-import-attributes-in-shipped-source.test.cases.js";
import "./no-published-to-private-dep.test.cases.js";
import "./package-readme-required.test.cases.js";
import "./public-needs-publish-wiring.test.cases.js";
import "./published-bin-must-be-executable.test.cases.js";
import "./published-dep-needs-version-range.test.cases.js";
import "./published-license-required.test.cases.js";
import "./release-workflow-maps-to-package.test.cases.js";
import "./runtime-file-assets-collocated.test.cases.js";
import "./runtime-file-assets-packaged.test.cases.js";
import "./shipped-dist-deps-unresolvable.test.cases.js";
import { describe, expect, it } from "vitest";
import type { PackageInfo, WorkspaceModel } from "../model.js";
import { runRules } from "./index.js";
import { makeWorkspace, pkgJson } from "../fixtures.js";

const rootPackage: PackageInfo = {
  name: "root",
  dir: ".",
  isRoot: true,
  private: true,
  version: "1.0.0",
  license: undefined,
  dependencies: {},
  peerDependencies: {},
  optionalDependencies: {},
  bundledDependencies: [],
  inlinedDependencies: [],
  repositoryDirectory: undefined,
  ecosystem: "npm",
  main: undefined,
  exports: undefined,
  bin: {},
  files: [],
  scripts: {},
  runtimeAssets: [],
  hasReadme: true
};

const model: WorkspaceModel = {
  root: rootPackage,
  packages: [],
  byName: new Map(),
  byDir: new Map([[".", rootPackage]]),
  releaseWorkflows: [],
  shippedDirs: new Set(),
  binTargets: [],
  sourceImports: new Map(),
  shippedDistImports: new Map(),
  rootEntryPoints: [],
  runtimeFileAssets: new Map(),
  packageFiles: new Map()
};

describe("runRules", () => {
  it.each([undefined, false])("requires command workspaces to be private (%s)", async (privateStatus) => {
    const workspace = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root", private: true }),
      "/repo/packages/safe-bash-command-example/package.json": pkgJson({
        name: "safe-bash-command-example", private: privateStatus,
        repository: { directory: "packages/safe-bash-command-example" }
      })
    });
    expect(runRules(workspace).violations).toContainEqual(expect.objectContaining({
      rule: "safe-bash-command-private", package: "safe-bash-command-example", severity: "error"
    }));
  });

  it("allows private command workspaces and unrelated public packages", async () => {
    const workspace = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root", private: true }),
      "/repo/packages/safe-bash-command-example/package.json": pkgJson({ name: "safe-bash-command-example", private: true }),
      "/repo/packages/other/package.json": pkgJson({ name: "other" })
    });
    expect(runRules(workspace).violations.filter(violation => violation.rule === "safe-bash-command-private")).toEqual([]);
  });

  it("rejects unknown focused rule ids", () => {
    expect(() => runRules(model, undefined, ["definitely-not-a-rule"])).toThrow(
      /Unknown package-lint rule/
    );
  });
});
