import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { createWorkspaceTestPlan, parseWorkspaceArguments } from "./build-workspaces.mjs";

function fixture() {
  return createFsFromVolume(Volume.fromJSON({
    "/repo/package.json": JSON.stringify({ name: "root", version: "1.0.0", workspaces: ["packages/*"], scripts: { "test:unit": "vitest run --config vitest.root.config.ts" } }),
    "/repo/turbo.json": JSON.stringify({ tasks: { build: { dependsOn: ["^build"] }, "virtual-bash#test:unit": { dependsOn: ["build"], cache: false } } }),
    "/repo/scripts/ci-unit-cache.json": JSON.stringify({ workspaces: ["alpha"] }),
    "/repo/packages/alpha/package.json": JSON.stringify({ name: "alpha", version: "1.0.0", scripts: { "test:unit": "cd ../.. && vitest run packages/alpha/src" } }),
    "/repo/packages/alpha/src/unit.test.ts": "",
    "/repo/packages/beta/package.json": JSON.stringify({ name: "beta", version: "1.0.0", scripts: { "test:unit": "node --test" } }),
    "/repo/packages/bash/package.json": JSON.stringify({ name: "virtual-bash", version: "1.0.0", scripts: { build: "build", "test:unit": "node --test" } })
  })) as unknown as typeof import("node:fs");
}

describe("opt-in CI unit groups", () => {
  it("partitions current tasks without changing the default native plan", () => {
    const fileSystem = fixture();
    const all = createWorkspaceTestPlan("/repo", { fileSystem });
    const cached = createWorkspaceTestPlan("/repo", { fileSystem, ciGroup: "cached" });
    const fresh = createWorkspaceTestPlan("/repo", { fileSystem, ciGroup: "fresh" });
    expect(cached.testStages.map(stage => stage.name)).toEqual(["alpha"]);
    expect(fresh.testStages.map(stage => stage.name)).toEqual(["root", "beta"]);
    expect([...cached.testStages, ...fresh.testStages].map(stage => stage.id).sort())
      .toEqual(all.testStages.filter(stage => stage.name !== "virtual-bash").map(stage => stage.id).sort());
    expect(cached.buildStages).toEqual([]);
    expect(fresh.buildStages).toEqual([]);
    expect(all.buildStages.map(stage => stage.name)).toEqual(["virtual-bash"]);
  });

  it("automatically admits new tasks to fresh execution", () => {
    const fileSystem = fixture();
    fileSystem.mkdirSync("/repo/packages/new", { recursive: true });
    fileSystem.writeFileSync("/repo/packages/new/package.json", JSON.stringify({ name: "new", version: "1.0.0", scripts: { "test:unit": "node --test" } }));
    expect(createWorkspaceTestPlan("/repo", { fileSystem, ciGroup: "fresh" }).testStages.map(stage => stage.name)).toContain("new");
  });

  for (const scripts of [
    { "test:unit": "node --test" },
    { "test:unit": "cd ../.. && vitest run packages/alpha/src", "pretest:unit": "check" },
    { "test:unit": "cd ../.. && vitest run packages/alpha/src", "posttest:unit": "check" }
  ]) it("refuses to cache a changed native command or lifecycle", () => {
    const fileSystem = fixture();
    fileSystem.writeFileSync("/repo/packages/alpha/package.json", JSON.stringify({ name: "alpha", version: "1.0.0", scripts }));
    expect(() => createWorkspaceTestPlan("/repo", { fileSystem, ciGroup: "cached" })).toThrow(/cacheable/);
    expect(() => createWorkspaceTestPlan("/repo", { fileSystem, ciGroup: "fresh" })).toThrow(/cacheable/);
  });

  for (const workspaces of [["missing"], ["virtual-bash"], ["root"], ["alpha", "alpha"], []]) {
    it(`rejects invalid cache admission ${JSON.stringify(workspaces)}`, () => {
      const fileSystem = fixture();
      fileSystem.writeFileSync("/repo/scripts/ci-unit-cache.json", JSON.stringify({ workspaces }));
      expect(() => createWorkspaceTestPlan("/repo", { fileSystem, ciGroup: "cached" })).toThrow();
    });
  }

  it("parses only explicit CI groups without forwarded test options", () => {
    expect(parseWorkspaceArguments(["--test-unit", "--ci-group=cached"]).ciGroup).toBe("cached");
    for (const args of [
      ["--ci-group=other"], ["--ci-group=fresh", "--ci-group=cached"],
      ["--ci-group=cached", "--", "--update"], ["--ci-group=fresh", "--exclude-workspace=virtual-bash"]
    ]) expect(() => parseWorkspaceArguments(["--test-unit", ...args])).toThrow();
  });
});
