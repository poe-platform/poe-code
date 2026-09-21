import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createWorkspaceTestPlan, parseWorkspaceArguments } from "./build-workspaces.mjs";

function fixture() {
  const manifests = {
    "package.json": { name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "root-tests" } },
    "turbo.json": { tasks: { build: { dependsOn: ["^build"] }, "virtual-bash#test:unit": { dependsOn: ["build"] } } },
    "packages/docx/package.json": { name: "docx", scripts: { "test:unit": "docx-tests" }, dependencies: { portable: "*" } },
    "packages/consumer/package.json": { name: "consumer", scripts: { "test:unit": "consumer-tests" }, optionalDependencies: { docx: "*" } },
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
  it("runs changed packages, their transitive consumers and root ownership", () => {
    expect(selected(["packages/docx/src/fields.ts"])).toEqual(["root", "consumer", "docx"]);
  });

  it("retains affected native suites when their dependency changes", () => {
    expect(selected(["packages/portable/src/xml.ts"])).toEqual(["root", "virtual-bash", "consumer", "docx"]);
  });

  it("does not propagate isolated test edits to consumers", () => {
    expect(selected(["packages/docx/src/fields.test.ts"])).toEqual(["root", "docx"]);
    expect(selected(["packages/docx/tests/fields.schema-test.ts"])).toEqual(["root", "docx"]);
  });

  it("falls back to the full plan for shared configuration or unknown ownership", () => {
    for (const filename of ["package.json", "package-lock.json", "vitest.config.ts", "tests/setup.ts", "scripts/build-workspaces.mjs", "packages/removed/src/file.ts", ".github/workflows/ci.yml"]) {
      expect(selected([filename]), filename).toEqual(["root", "virtual-bash", "consumer", "docx", "safe-js"]);
    }
  });

  it("keeps root test edits scoped but treats root production code as shared", () => {
    expect(selected(["src/cli/command.test.ts"])).toEqual(["root"]);
    expect(selected(["src/cli/command.ts"])).toEqual(["root", "virtual-bash", "consumer", "docx", "safe-js"]);
  });

  it("keeps root script test edits scoped and treats package test helpers as shared", () => {
    expect(selected(["scripts/build-workspaces.test.ts"])).toEqual(["root"]);
    expect(selected(["packages/docx/tests/fixtures/text.ts"])).toEqual(["root", "virtual-bash", "consumer", "docx", "safe-js"]);
  });

  it("reports no work for an unchanged checkout or documentation-only changes", () => {
    for (const files of [[], ["docs/plans/test-performance.md"], ["README.md"]]) expect(selected(files)).toEqual([]);
  });

  it("unions changes and admits new package tasks from current manifests", () => {
    const fixtureOptions = fixture();
    fixtureOptions.fileSystem.mkdirSync("/repo/packages/new", { recursive: true });
    fixtureOptions.fileSystem.writeFileSync("/repo/packages/new/package.json", JSON.stringify({ name: "new", scripts: { "test:unit": "new-tests" }, dependencies: { consumer: "*" } }));
    expect(createWorkspaceTestPlan("/repo", { ...fixtureOptions, changedFiles: ["packages/docx/src/fields.ts", "packages/js/test/case.test.ts"] }).testStages.map(stage => stage.name))
      .toEqual(["root", "consumer", "docx", "safe-js", "new"]);
  });

  it("refuses unsafe paths and ambiguous selection combinations", () => {
    for (const changedFiles of [["../outside.ts"], ["/absolute.ts"], ["a\u0000b"]]) {
      expect(() => createWorkspaceTestPlan("/repo", { ...fixture(), changedFiles })).toThrow();
    }
    for (const extra of [{ workspaces: ["docx"] }, { ciGroup: "fresh" }, { excludeWorkspace: "virtual-bash" }]) {
      expect(() => createWorkspaceTestPlan("/repo", { ...fixture(), changedFiles: [], ...extra })).toThrow();
    }
  });

  it("parses an explicit comparison reference separately from test-tool options", () => {
    expect(parseWorkspaceArguments(["--test-unit", "--changed-since=HEAD~1", "--", "--reporter=json"]))
      .toMatchObject({ changedSince: "HEAD~1", testArguments: ["--reporter=json"] });
    for (const args of [["--changed-since="], ["--changed-since=-bad"], ["--changed-since=HEAD", "--workspace=docx"], ["--changed-since=HEAD", "--changed-since=main"]]) {
      expect(() => parseWorkspaceArguments(["--test-unit", ...args])).toThrow();
    }
  });
});
