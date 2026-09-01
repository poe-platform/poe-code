import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { workspaceTestExclusions } from "./workspace-test-ownership.mjs";

function fixture(script?: string, files: Record<string, string> = {}) {
  return createFsFromVolume(Volume.fromJSON({
    "/repo/packages/example/package.json": JSON.stringify({ scripts: { "test:unit": script } }),
    "/repo/packages/example/src/unit.test.ts": "",
    "/repo/packages/example/src/nested/unit.spec.ts": "",
    "/repo/packages/example/scripts/build.test.ts": "",
    ...files
  }));
}

describe("workspace test ownership", () => {
  it("excludes only a declared literal directory, keeping sibling tests in root", () => {
    expect(workspaceTestExclusions("/repo", fixture("cd ../.. && vitest run packages/example/src/")))
      .toEqual(["packages/example/src/**"]);
  });

  it("recognizes the shared config and exact file selectors", () => {
    expect(workspaceTestExclusions("/repo", fixture("cd ../.. && vitest run --config vitest.config.ts packages/example/src/unit.test.ts")))
      .toEqual(["packages/example/src/unit.test.ts"]);
  });

  it("supports multiple owned directories and harmless no-tests option", () => {
    expect(workspaceTestExclusions("/repo", fixture("cd ../.. && vitest run --passWithNoTests packages/example/src packages/example/scripts")))
      .toEqual(["packages/example/src/**", "packages/example/scripts/**"]);
  });

  it("recognizes a whole-package literal selector", () => {
    expect(workspaceTestExclusions("/repo", fixture("cd ../.. && vitest run packages/example")))
      .toEqual(["packages/example/**"]);
  });

  for (const script of [
    undefined,
    "node --test",
    "vitest run --config vitest.config.ts",
    "cd ../.. && vitest run --config custom.config.ts packages/example/src",
    "cd ../.. && vitest run packages/example/src -t selected",
    "cd ../.. && vitest run packages/example/src && echo done",
    "cd ../.. && vitest run packages/example/src/*.test.ts",
    "cd ../.. && vitest run packages/example/src/**/*.test.ts",
    "cd ../.. && vitest run packages/example/missing",
    "cd ../.. && vitest run packages/other/src",
    "cd ../.. && vitest run packages/example/../other/src",
    "cd ../.. && vitest run $TEST_PATH",
    "cd ../.. && vitest run $(echo packages/example/src)"
  ]) {
    it(`keeps root coverage when ownership is not proven: ${script}`, () => {
      expect(workspaceTestExclusions("/repo", fixture(script, {
        "/repo/packages/other/src/other.test.ts": ""
      }))).toEqual([]);
    });
  }

  it("retains tests when a package stops declaring its unit task", () => {
    const fileSystem = fixture("cd ../.. && vitest run packages/example/src");
    expect(workspaceTestExclusions("/repo", fileSystem)).toHaveLength(1);
    fileSystem.writeFileSync("/repo/packages/example/package.json", "{}");
    expect(workspaceTestExclusions("/repo", fileSystem)).toEqual([]);
  });

  it("ignores directories without manifests", () => {
    expect(workspaceTestExclusions("/repo", fixture(undefined, {
      "/repo/packages/not-a-workspace/test.test.ts": ""
    }))).toEqual([]);
  });

  it("does not reinterpret quoted literal filenames as exclusion globs", () => {
    expect(workspaceTestExclusions("/repo", fixture('cd ../.. && vitest run "packages/example/src/[ab].test.ts"', {
      "/repo/packages/example/src/[ab].test.ts": "",
      "/repo/packages/example/src/a.test.ts": ""
    }))).toEqual([]);
  });
});
