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

  it("passes when the imported workspace package is compiled into the published entrypoint", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        repository: { directory: "packages/pub" },
        poeCode: { inlinedDependencies: ["priv"] }
      }),
      "/repo/packages/pub/src/index.ts": 'export { z } from "priv";\n',
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true }),
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub")
    });

    expect(importedWorkspaceDepUnresolvable.run(model)).toHaveLength(0);
  });

  it("errors when the imported package reaches npm but the importer does not declare it", async () => {
    // A published dependency resolves only when the importer declares it —
    // otherwise the import works solely through hoisting luck (the
    // toolcraft-openapi → toolcraft-schema breakage).
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": PUB,
      "/repo/packages/pub/src/index.ts": 'export { z } from "shared";\n',
      "/repo/packages/shared/package.json": pkgJson({
        name: "shared",
        repository: { directory: "packages/shared" }
      }),
      "/repo/packages/shared/src/index.ts": "export const z = 1;\n",
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub"),
      "/repo/.github/workflows/release-shared.yml": releaseWorkflow("packages/shared")
    });

    const violations = importedWorkspaceDepUnresolvable.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      severity: "error",
      detail: { unresolvable: [{ dependency: "shared", files: ["packages/pub/src/index.ts"] }] }
    });
  });

  it("passes when the imported package reaches npm and the importer declares it", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        repository: { directory: "packages/pub" },
        dependencies: { shared: "*" }
      }),
      "/repo/packages/pub/src/index.ts": 'export { z } from "shared";\n',
      "/repo/packages/shared/package.json": pkgJson({
        name: "shared",
        repository: { directory: "packages/shared" }
      }),
      "/repo/packages/shared/src/index.ts": "export const z = 1;\n",
      "/repo/.github/workflows/release-pub.yml": releaseWorkflow("packages/pub"),
      "/repo/.github/workflows/release-shared.yml": releaseWorkflow("packages/shared")
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
