import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { publicNeedsPublishWiring } from "./public-needs-publish-wiring.js";

function releaseWorkflow(dir: string): string {
  return [
    "name: Release",
    "on:",
    "  push:",
    `    paths: ['${dir}/**']`,
    "jobs:",
    "  publish:",
    "    steps:",
    `      - working-directory: ${dir}`,
    "        run: npm publish --provenance --access public",
    ""
  ].join("\n");
}

describe("public-needs-publish-wiring", () => {
  it("warns for a public package with no release workflow", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/leaf/package.json": pkgJson({
        name: "leaf",
        repository: { directory: "packages/leaf" }
      })
    });

    const violations = publicNeedsPublishWiring.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "leaf",
      severity: "warning",
      detail: { missing: ["release-workflow"] }
    });
  });

  it("passes for a public package with a release workflow and repository.directory", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/dep/package.json": pkgJson({
        name: "dep",
        repository: { directory: "packages/dep" }
      }),
      "/repo/.github/workflows/release-dep.yml": releaseWorkflow("packages/dep")
    });

    expect(publicNeedsPublishWiring.run(model)).toHaveLength(0);
  });

  it("uses job default working directories for publish steps", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/dep/package.json": pkgJson({
        name: "dep",
        repository: { directory: "packages/dep" }
      }),
      "/repo/.github/workflows/release-dep.yml": [
        "name: Release",
        "jobs:",
        "  publish:",
        "    defaults:",
        "      run:",
        "        working-directory: packages/dep",
        "    steps:",
        "      - run: npm publish --provenance --access public",
        ""
      ].join("\n")
    });

    expect(publicNeedsPublishWiring.run(model)).toHaveLength(0);
  });

  it("loads release workflows with the .yaml extension", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/dep/package.json": pkgJson({
        name: "dep",
        repository: { directory: "packages/dep" }
      }),
      "/repo/.github/workflows/release-dep.yaml": releaseWorkflow("packages/dep")
    });

    expect(model.releaseWorkflows).toHaveLength(1);
    expect(publicNeedsPublishWiring.run(model)).toHaveLength(0);
  });

  it("ignores commented npm publish text", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/dep/package.json": pkgJson({
        name: "dep",
        repository: { directory: "packages/dep" }
      }),
      "/repo/.github/workflows/release-dep.yml": [
        "name: Release",
        "jobs:",
        "  publish:",
        "    steps:",
        "      - working-directory: packages/dep",
        "        run: |",
        "          # npm publish",
        "          echo skipped",
        ""
      ].join("\n")
    });

    expect(publicNeedsPublishWiring.run(model)).toHaveLength(1);
  });

  it("ignores private packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/secret/package.json": pkgJson({ name: "secret", private: true })
    });

    expect(publicNeedsPublishWiring.run(model)).toHaveLength(0);
  });
});
