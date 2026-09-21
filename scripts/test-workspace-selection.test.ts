import path from "node:path";
import type { SpawnOptions } from "node:child_process";
import { EventEmitter } from "node:events";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it, vi } from "vitest";
import { createWorkspaceTestPlan, parseWorkspaceArguments, testWorkspaces } from "./build-workspaces.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "GIT_DIR\n"), spawn: vi.fn() }));

function fixture() {
  const files = {
    "package.json": { name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "root-tests" } },
    "turbo.json": { tasks: { build: { dependsOn: ["^build"] }, "docx#test:unit": { dependsOn: ["build"] }, "virtual-bash#test:unit": { dependsOn: ["build"] } } },
    "packages/docx/package.json": { name: "docx", scripts: { build: "docx-build", "test:unit": "docx-tests" }, dependencies: { portable: "*" }, poeCode: { build: { dependencies: { portable: "build:portable" } } } },
    "packages/portable/package.json": { name: "portable", scripts: { build: "full-build", "build:portable": "portable-build" }, dependencies: { leaf: "*" } },
    "packages/leaf/package.json": { name: "leaf", scripts: { build: "leaf-build" } },
    "packages/bash/package.json": { name: "virtual-bash", scripts: { build: "bash-build", "test:unit": "bash-tests" } },
    "packages/js/package.json": { name: "safe-js", scripts: { "pretest:unit": "prepare-js", "test:unit": "js-tests", "posttest:unit": "verify-js" } }
  };
  const fileSystem = createFsFromVolume(Volume.fromJSON(Object.fromEntries(Object.entries(files).map(([name, value]) => ["/repo/" + name, JSON.stringify(value)]))));
  return { fileSystem };
}

describe("explicit maintained unit selection", () => {
  it("runs DOCX and its portable build closure without unrelated suites", () => {
    const plan = createWorkspaceTestPlan("/repo", { ...fixture(), workspaces: ["docx"] });
    expect(plan.testStages.map(stage => stage.name)).toEqual(["docx"]);
    expect(plan.buildStages.map(stage => [stage.name, stage.event ?? "build"])).toEqual([["leaf", "build"], ["portable", "build:portable"], ["docx", "build"]]);
    expect(plan.selectedWorkspaces).toEqual(["docx"]);
  });

  it("rebuilds the actual DOCX public package used by child-process consumer tests", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const plan = createWorkspaceTestPlan(root, { workspaces: ["docx"] });
    expect(plan.buildStages.some(stage => stage.name === "docx")).toBe(true);
    expect(plan.buildStages.find(stage => stage.name === "@poe-code/safe-fs")?.event).toBe("build:portable");
    expect(plan.buildStages.map(stage => stage.name)).not.toContain("virtual-bash");
    expect(plan.buildStages.map(stage => stage.name)).not.toContain("@poe-code/safe-js");
  });

  it("keeps the complete suite when selection is omitted", () => {
    const plan = createWorkspaceTestPlan("/repo", fixture());
    expect(plan.testStages.map(stage => stage.name)).toEqual(["root", "virtual-bash", "docx", "safe-js"]);
  });

  it("selects root explicitly and deduplicates repeated workspace roots", () => {
    const plan = createWorkspaceTestPlan("/repo", { ...fixture(), workspaces: ["safe-js", ".", "safe-js"] });
    expect(plan.testStages.map(stage => stage.name)).toEqual(["root", "safe-js"]);
    expect(plan.buildStages).toEqual([]);
  });

  for (const workspaces of [[], ["unknown"], ["leaf"], ["packages/docx"], ["*"]]) {
    it(`refuses invalid or testless selection ${JSON.stringify(workspaces)}`, () => {
      expect(() => createWorkspaceTestPlan("/repo", { ...fixture(), workspaces })).toThrow();
    });
  }

  it("rejects selections combined with CI partitions or exclusions", () => {
    for (const extra of [{ ciGroup: "fresh" }, { excludeWorkspace: "virtual-bash" }]) {
      expect(() => createWorkspaceTestPlan("/repo", { ...fixture(), workspaces: ["docx"], ...extra })).toThrow();
    }
  });

  it("parses repeated exact names and reserves the argument boundary for child options", () => {
    expect(parseWorkspaceArguments(["--test-unit", "--workspace=docx", "--workspace=@poe-code/safe-js", "--", "--reporter=json"]))
      .toMatchObject({ workspaces: ["docx", "@poe-code/safe-js"], testArguments: ["--reporter=json"] });
    expect(parseWorkspaceArguments(["--test-unit", "--", "--workspace=child"]).testArguments).toEqual(["--workspace=child"]);
    for (const selector of ["", "*", "../docx", "docx?", "docx\u0000"]) {
      expect(() => parseWorkspaceArguments(["--test-unit", "--workspace=" + selector])).toThrow();
    }
  });

  it("previews selected tasks without executing or counting them as passes", async () => {
    const spawn = vi.fn();
    const result = await testWorkspaces("/repo", { ...fixture(), workspaces: ["docx"], dryRun: true, spawn, environment: { npm_execpath: "/npm-cli.js" } });
    expect(spawn).not.toHaveBeenCalled();
    expect(result).toMatchObject({ dryRun: true, plannedTests: 1, plannedBuilds: 3 });
    expect(result).not.toHaveProperty("tests");
    expect(result).not.toHaveProperty("builds");
    expect(result.testStages.map(stage => stage.name)).toEqual(["docx"]);
    expect(parseWorkspaceArguments(["--test-unit", "--workspace=docx", "--dry-run"]).dryRun).toBe(true);
  });

  it("parses exact focused files without broadening native workspace filters", () => {
    expect(parseWorkspaceArguments(["--test-unit", "--workspace=docx", "--test-file=packages/docx/src/fields.test.ts"]))
      .toMatchObject({ workspaces: ["docx"], testFiles: ["packages/docx/src/fields.test.ts"] });
    for (const file of ["../outside.test.ts", "/absolute.test.ts", "packages/*/test.ts", "bad\\path.test.ts"]) {
      expect(() => parseWorkspaceArguments(["--test-unit", "--workspace=docx", "--test-file=" + file])).toThrow();
    }
    for (const options of [{ testFiles: ["packages/docx/src/fields.test.ts"] }, { workspaces: ["docx", "safe-js"], testFiles: ["packages/docx/src/fields.test.ts"] }]) {
      expect(() => createWorkspaceTestPlan("/repo", { ...fixture(), ...options })).toThrow();
    }
  });

  it("uses native npm lifecycles, forwards filters and keeps caller environment unchanged", async () => {
    const host = Object.assign(new EventEmitter(), { platform: "linux", execPath: "/node", kill: vi.fn() });
    const spawn = vi.fn((_command: string, _args: string[], _options: SpawnOptions) => {
      const child = new EventEmitter();
      queueMicrotask(() => child.emit("close", 0, null));
      return child;
    });
    const environment = Object.freeze({ npm_execpath: "/npm-cli.js", GIT_DIR: "/foreign", SAFEJS_LOCAL_ROOT: "/optional" });
    const result = await testWorkspaces("/repo", { ...fixture(), workspaces: ["safe-js"], testArguments: ["--testNamePattern=focused"], host, spawn, environment });
    expect(spawn.mock.calls).toHaveLength(1);
    expect(spawn.mock.calls[0]?.[1]).toEqual(["/npm-cli.js", "--prefix", "/repo", "run", "test:unit", "--workspace=packages/js", "--include-workspace-root=false", "--if-present=false", "--", "--testNamePattern=focused"]);
    expect(spawn.mock.calls[0]?.[2].env).not.toHaveProperty("GIT_DIR");
    expect(environment.GIT_DIR).toBe("/foreign");
    expect(result).toMatchObject({ tests: 1, builds: 0, cache: "UNCACHED", selectedWorkspaces: ["safe-js"] });
  });
});
