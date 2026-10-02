import { createFsFromVolume, Volume } from "memfs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createWorkspaceTestPlan, parseWorkspaceArguments } from "./build-workspaces.mjs";

function fixture() {
  const manifests = {
    "package.json": { name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "root-tests" } },
    "turbo.json": { tasks: { build: { dependsOn: ["^build"] }, "virtual-bash#test:unit": { dependsOn: ["build"] } } },
    "packages/safe-bash-docx-engine/package.json": { name: "safe-bash-docx-engine", scripts: { "test:unit": "docx-tests" }, dependencies: { portable: "*" } },
    "packages/consumer/package.json": { name: "consumer", scripts: { "test:unit": "consumer-tests" }, optionalDependencies: { "safe-bash-docx-engine": "*" } },
    "packages/portable/package.json": { name: "portable", scripts: { build: "portable-build" } },
    "packages/bash/package.json": { name: "virtual-bash", scripts: { build: "bash-build", "test:unit": "bash-tests" }, devDependencies: { portable: "*" } },
    "packages/js/package.json": { name: "safe-js", scripts: { "test:unit": "js-tests" } }
  };
  return { fileSystem: createFsFromVolume(Volume.fromJSON(Object.fromEntries(Object.entries(manifests).map(([name, value]) => ["/repo/" + name, JSON.stringify(value)])))) };
}

function selected(changedFiles: string[]) {
  return createWorkspaceTestPlan("/repo", { ...fixture(), changedFiles }).testStages.map(stage => stage.name);
}

describe("change-based unit scope", () => {
  it("retains actual Bash DOCX integration consumers for source changes only", () => {
    const root = path.resolve(import.meta.dirname, "..");
    const source = createWorkspaceTestPlan(root, { changedFiles: ["packages/safe-bash-docx-engine/src/fields.ts"] });
    const tests = createWorkspaceTestPlan(root, { changedFiles: ["packages/safe-bash-docx-engine/src/fields.test.ts"] });
    expect(source.testStages.map(stage => stage.name)).toContain("@poe-platform/safe-bash");
    expect(source.testStages.map(stage => stage.name)).toContain("toolcraft");
    expect(tests.testStages.map(stage => stage.name)).not.toContain("@poe-platform/safe-bash");
    expect(tests.testStages.map(stage => stage.name)).not.toContain("toolcraft");
    expect(tests.testStages.map(stage => stage.name)).not.toContain("@poe-code/safe-js");
    const shell = createWorkspaceTestPlan(root, { changedFiles: ["packages/safe-bash/src/shell.ts"] });
    expect(shell.testStages.map(stage => stage.name)).toContain("safe-bash-docx-engine");
  });

  it("retains declared external task inputs without creating build dependency cycles", () => {
    const options = fixture();
    options.fileSystem.writeFileSync("/repo/turbo.json", JSON.stringify({ tasks: {
      build: { dependsOn: ["^build"] },
      "virtual-bash#test:unit": { dependsOn: ["build"] },
      "safe-bash-docx-engine#test:unit": { inputs: ["$TURBO_DEFAULT$", "$TURBO_ROOT$/packages/bash/src/**"] }
    } }));
    const plan = createWorkspaceTestPlan("/repo", { ...options, changedFiles: ["packages/bash/src/shell.ts"] });
    expect(plan.testStages.map(stage => stage.name)).toEqual(["root", "virtual-bash", "safe-bash-docx-engine"]);
    expect(plan.buildStages.map(stage => stage.name)).toEqual(["portable", "virtual-bash"]);
    expect(createWorkspaceTestPlan("/repo", { ...options, changedFiles: ["packages/bash/tests/shell.test.ts"] }).testStages.map(stage => stage.name))
      .toEqual(["root", "virtual-bash"]);
  });

  it("retains live Markdown task inputs and declared global inputs", () => {
    const options = fixture();
    options.fileSystem.writeFileSync("/repo/turbo.json", JSON.stringify({
      globalDependencies: ["docs/shared/*.md"],
      tasks: { build: { dependsOn: ["^build"] }, "safe-bash-docx-engine#test:unit": { inputs: ["$TURBO_ROOT$/docs/fixtures/*.md"] } }
    }));
    expect(createWorkspaceTestPlan("/repo", { ...options, changedFiles: ["docs/fixtures/input.md"] }).testStages.map(stage => stage.name))
      .toEqual(["root", "safe-bash-docx-engine"]);
    expect(createWorkspaceTestPlan("/repo", { ...options, changedFiles: ["docs/shared/settings.md"] }).testStages.map(stage => stage.name))
      .toEqual(["root", "virtual-bash", "consumer", "safe-js", "safe-bash-docx-engine"]);
    options.fileSystem.writeFileSync("/repo/turbo.json", JSON.stringify({ tasks: {
      build: { dependsOn: ["^build"] }, "//#test:unit": { inputs: ["$TURBO_ROOT$/docs/fixtures/*.md"] }
    } }));
    expect(createWorkspaceTestPlan("/repo", { ...options, changedFiles: ["docs/fixtures/input.md"] }).testStages.map(stage => stage.name))
      .toEqual(["root"]);
  });

  it("uses the full plan when external input matching is unavailable or ambiguous", () => {
    const options = fixture();
    for (const input of ["../bash/src/**", "$TURBO_ROOT$/packages/bash/src/**"]) {
      options.fileSystem.writeFileSync("/repo/turbo.json", JSON.stringify({ tasks: {
        build: { dependsOn: ["^build"] }, "safe-bash-docx-engine#test:unit": { inputs: [input] }
      } }));
      const native = Object.getOwnPropertyDescriptor(path, "matchesGlob");
      Object.defineProperty(path, "matchesGlob", { configurable: true, value: undefined });
      try {
        expect(createWorkspaceTestPlan("/repo", { ...options, changedFiles: ["packages/bash/src/shell.ts"] }).testStages.map(stage => stage.name))
          .toEqual(["root", "virtual-bash", "consumer", "safe-js", "safe-bash-docx-engine"]);
      } finally {
        if (native) Object.defineProperty(path, "matchesGlob", native);
        else Reflect.deleteProperty(path, "matchesGlob");
      }
    }
  });

  it("runs changed packages, their transitive consumers and root ownership", () => {
    expect(selected(["packages/safe-bash-docx-engine/src/fields.ts"])).toEqual(["root", "consumer", "safe-bash-docx-engine"]);
  });

  it("retains affected native suites when their dependency changes", () => {
    expect(selected(["packages/portable/src/xml.ts"])).toEqual(["root", "virtual-bash", "consumer", "safe-bash-docx-engine"]);
  });

  it("does not propagate isolated test edits to consumers", () => {
    expect(selected(["packages/safe-bash-docx-engine/src/fields.test.ts"])).toEqual(["root", "safe-bash-docx-engine"]);
    expect(selected(["packages/safe-bash-docx-engine/tests/fields.schema-test.ts"])).toEqual(["root", "safe-bash-docx-engine"]);
  });

  it("falls back to the full plan for shared configuration or unknown ownership", () => {
    for (const filename of ["package.json", "package-lock.json", "vitest.config.ts", "tests/setup.ts", "scripts/build-workspaces.mjs", "packages/removed/src/file.ts", ".github/workflows/ci.yml"]) {
      expect(selected([filename]), filename).toEqual(["root", "virtual-bash", "consumer", "safe-js", "safe-bash-docx-engine"]);
    }
  });

  it("keeps root test edits scoped but treats root production code as shared", () => {
    expect(selected(["src/cli/command.test.ts"])).toEqual(["root"]);
    expect(selected(["src/cli/command.ts"])).toEqual(["root", "virtual-bash", "consumer", "safe-js", "safe-bash-docx-engine"]);
  });

  it("keeps root script test edits scoped and treats package test helpers as shared", () => {
    expect(selected(["scripts/build-workspaces.test.ts"])).toEqual(["root"]);
    expect(selected(["packages/safe-bash-docx-engine/tests/fixtures/text.ts"])).toEqual(["root", "virtual-bash", "consumer", "safe-js", "safe-bash-docx-engine"]);
  });

  it("reports no work for an unchanged checkout or documentation-only changes", () => {
    for (const files of [[], ["docs/plans/test-performance.md"], ["README.md"]]) expect(selected(files)).toEqual([]);
  });

  it("retains the full plan for test inputs and executable files under docs", () => {
    for (const filename of ["docs/plans/qualify-realms-and-recovery/legacy-v8.json", "docs/fixtures/input.docx", "docs/audit/check.mjs"]) {
      expect(selected([filename]), filename).toEqual(["root", "virtual-bash", "consumer", "safe-js", "safe-bash-docx-engine"]);
    }
  });

  it("unions changes and admits new package tasks from current manifests", () => {
    const fixtureOptions = fixture();
    fixtureOptions.fileSystem.mkdirSync("/repo/packages/new", { recursive: true });
    fixtureOptions.fileSystem.writeFileSync("/repo/packages/new/package.json", JSON.stringify({ name: "new", scripts: { "test:unit": "new-tests" }, dependencies: { consumer: "*" } }));
    expect(createWorkspaceTestPlan("/repo", { ...fixtureOptions, changedFiles: ["packages/safe-bash-docx-engine/src/fields.ts", "packages/js/test/case.test.ts"] }).testStages.map(stage => stage.name))
      .toEqual(["root", "consumer", "safe-js", "new", "safe-bash-docx-engine"]);
  });

  it("refuses unsafe paths and ambiguous selection combinations", () => {
    for (const changedFiles of [["../outside.ts"], ["/absolute.ts"], ["a\u0000b"]]) {
      expect(() => createWorkspaceTestPlan("/repo", { ...fixture(), changedFiles })).toThrow();
    }
    for (const extra of [{ workspaces: ["safe-bash-docx-engine"] }, { ciGroup: "fresh" }, { excludeWorkspace: "virtual-bash" }]) {
      expect(() => createWorkspaceTestPlan("/repo", { ...fixture(), changedFiles: [], ...extra })).toThrow();
    }
  });

  it("parses an explicit comparison reference separately from test-tool options", () => {
    expect(parseWorkspaceArguments(["--test-unit", "--changed-since=HEAD~1", "--", "--reporter=json"]))
      .toMatchObject({ changedSince: "HEAD~1", testArguments: ["--reporter=json"] });
    for (const args of [["--changed-since="], ["--changed-since=-bad"], ["--changed-since=HEAD", "--workspace=safe-bash-docx-engine"], ["--changed-since=HEAD", "--changed-since=main"]]) {
      expect(() => parseWorkspaceArguments(["--test-unit", ...args])).toThrow();
    }
  });
});
