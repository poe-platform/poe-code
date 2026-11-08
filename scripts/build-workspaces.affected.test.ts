import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { affectedWorkspaceNames, createWorkspaceTestPlan, parseWorkspaceArguments } from "./build-workspaces.mjs";

const plan = { root: "/repo", workspaces: [{ name: "leaf", path: "packages/leaf" }, { name: "consumer", path: "packages/consumer" }, { name: "other", path: "packages/other" }], edges: [{ from: "consumer", to: "leaf" }] };

describe("affected workspace selection", () => {
  it("selects changed packages and all declared consumers", () => {
    expect(affectedWorkspaceNames(plan, "HEAD", ["packages/leaf/src/index.ts"])).toEqual(new Set(["leaf", "consumer"]));
    expect(affectedWorkspaceNames(plan, "HEAD", ["packages/consumer/package.json"])).toEqual(new Set(["consumer"]));
    expect(affectedWorkspaceNames(plan, "HEAD", [])).toHaveProperty("size", 0);
  });
  it("selects every workspace when shared or unowned inputs change", () => {
    for (const file of ["package-lock.json", "tests/setup.ts", "scripts/build-workspaces.mjs", "packages/new/package.json"]) {
      expect(affectedWorkspaceNames(plan, "HEAD", [file])).toEqual(new Set(["leaf", "consumer", "other"]));
    }
  });
  it("rejects invalid references and paths before executing Git", () => {
    for (const reference of ["", "--all", "HEAD\0"]) expect(() => affectedWorkspaceNames(plan, reference, [])).toThrow();
    expect(() => affectedWorkspaceNames(plan, "HEAD", ["../foreign"])).toThrow();
  });
  it("exposes explicit affected selection on maintained build and test routes", () => {
    expect(parseWorkspaceArguments(["--affected=HEAD~1"])).toEqual({ mode: "build", affected: "HEAD~1" });
    expect(parseWorkspaceArguments(["--test-unit", "--affected=HEAD~1"]).affected).toBe("HEAD~1");
    expect(() => parseWorkspaceArguments(["--affected=HEAD", "--workspace=leaf"])).toThrow();
    expect(() => parseWorkspaceArguments(["--test-unit", "--affected=HEAD", "--ci-group=fresh"])).toThrow();
  });
  it("preserves root coverage and derives prerequisites only for selected workspace tests", () => {
    const files = {
      "/repo/package.json": JSON.stringify({ name: "root", workspaces: ["packages/*"], scripts: { "test:unit": "vitest run" } }),
      "/repo/turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"] }, "test:unit": { dependsOn: ["^build"] }, "//#test:unit": { dependsOn: [] } } }),
      "/repo/packages/leaf/package.json": JSON.stringify({ name: "leaf", scripts: { build: "tsc", "test:unit": "vitest run" } }),
      "/repo/packages/consumer/package.json": JSON.stringify({ name: "consumer", dependencies: { leaf: "*" }, scripts: { "test:unit": "vitest run" } }),
      "/repo/packages/other/package.json": JSON.stringify({ name: "other", scripts: { "test:unit": "vitest run" } })
    };
    const fileSystem = createFsFromVolume(Volume.fromJSON(files));
    const selected = createWorkspaceTestPlan("/repo", { fileSystem, affected: "HEAD", affectedFiles: ["packages/consumer/src/index.ts"] });
    expect(selected.testStages.map(stage => stage.name)).toEqual(["root", "consumer"]);
    expect(selected.buildStages.map(stage => stage.name)).toEqual(["leaf"]);
  });
});
