import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { importedWorkspaceDepUnresolvable } from "./imported-workspace-dep-unresolvable.js";

function releaseWorkflow(dir: string): string {
  return [
    "name: Release",
    "on:",
    `  push: { paths: ['${dir}/**'] }`,
    "jobs:",
    "  publish:",
    "    steps:",
    `      - working-directory: ${dir}`,
    "        run: npm publish --provenance --access public",
    ""
  ].join("\n");
}

const PUB = pkgJson({ name: "pub", repository: { directory: "packages/pub" } });

describe("imported-workspace-dep-unresolvable", () => {
  it("errors when published code imports a private workspace package it does not bundle", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": PUB,
      "/repo/packages/pub/src/index.ts": 'export { z } from "priv";\n',
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true }),
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    const violations = importedWorkspaceDepUnresolvable.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      severity: "error",
      detail: { unresolvable: [{ dependency: "priv", files: ["packages/pub/src/index.ts"] }] }
    });
  });

  it("passes when the imported workspace package is vendored via bundledDependencies", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        repository: { directory: "packages/pub" },
        bundledDependencies: ["priv"]
      }),
      "/repo/packages/pub/src/index.ts": 'export { z } from "priv";\n',
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true }),
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    expect(importedWorkspaceDepUnresolvable.run(model)).toHaveLength(0);
  });

  it("ignores type-only and test imports", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": PUB,
      "/repo/packages/pub/src/index.ts": 'import type { T } from "priv";\nexport type U = T;\n',
      "/repo/packages/pub/src/index.test.ts": 'import { z } from "priv";\nexport { z };\n',
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true }),
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    expect(importedWorkspaceDepUnresolvable.run(model)).toHaveLength(0);
  });

  it("scans .mts and .cts source files", async () => {
    for (const extension of ["mts", "cts"]) {
      const model = await makeWorkspace({
        "/repo/package.json": pkgJson({ name: "root" }),
        "/repo/packages/pub/package.json": PUB,
        [`/repo/packages/pub/src/index.${extension}`]: 'export { z } from "priv";\n',
        "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true }),
        "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
      });

      expect(importedWorkspaceDepUnresolvable.run(model)).toHaveLength(1);
    }
  });

  it("ignores import type queries", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": PUB,
      "/repo/packages/pub/src/index.ts": 'type Client = import("priv").Client;\n',
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true }),
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    expect(importedWorkspaceDepUnresolvable.run(model)).toHaveLength(0);
  });
});
