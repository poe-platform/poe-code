import { describe, expect, it } from "vitest";
import type { PackageInfo, WorkspaceModel } from "../model.js";
import { runRules } from "./index.js";

const rootPackage: PackageInfo = {
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
  scripts: {}
};

const model: WorkspaceModel = {
  root: rootPackage,
  packages: [],
  byName: new Map(),
  byDir: new Map([[".", rootPackage]]),
  releaseWorkflows: [],
  shippedDirs: new Set(),
  binTargets: [],
  sourceImports: new Map()
};

describe("runRules", () => {
  it("rejects unknown focused rule ids", () => {
    expect(() => runRules(model, undefined, ["definitely-not-a-rule"])).toThrow(
      /Unknown package-lint rule/
    );
  });
});
