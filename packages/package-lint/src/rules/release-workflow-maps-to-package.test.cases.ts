import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { releaseWorkflowMapsToPackage } from "./release-workflow-maps-to-package.js";

function publishWorkflow(dir: string): string {
  return [
    "name: Release",
    "on:",
    "  push:",
    "    branches: [main]",
    "jobs:",
    "  publish:",
    "    steps:",
    `      - working-directory: ${dir}`,
    "        run: npm publish --provenance --access public",
    ""
  ].join("\n");
}

describe("release-workflow-maps-to-package", () => {
  it("flags a workflow targeting a directory that is not a workspace package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/real/package.json": pkgJson({ name: "real" }),
      "/repo/.github/workflows/release-ghost.yml": publishWorkflow("packages/ghost")
    });

    const violations = releaseWorkflowMapsToPackage.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      severity: "error",
      detail: { workflow: "release-ghost.yml", targetDir: "packages/ghost", resolved: null }
    });
  });

  it("flags a workflow targeting a private npm package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/secret/package.json": pkgJson({ name: "secret", private: true }),
      "/repo/.github/workflows/release-secret.yml": publishWorkflow("packages/secret")
    });

    const violations = releaseWorkflowMapsToPackage.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({ package: "secret", severity: "error" });
  });

  it("passes when every workflow targets an existing public package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({ name: "pub" }),
      "/repo/.github/workflows/release-pub.yml": publishWorkflow("packages/pub")
    });

    expect(releaseWorkflowMapsToPackage.run(model)).toHaveLength(0);
  });

  it("does not count similarly prefixed PyPI publish actions", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root", private: true }),
      "/repo/packages/py/package.json": pkgJson({ name: "py", private: true }),
      "/repo/packages/py/pyproject.toml": '[project]\nname = "py"\n',
      "/repo/.github/workflows/release-py.yml": [
        "name: Release py",
        "jobs:",
        "  publish:",
        "    steps:",
        "      - uses: pypa/gh-action-pypi-publish-fake@v1",
        "        with:",
        "          packages-dir: packages/py/dist",
        ""
      ].join("\n")
    });

    expect(model.releaseWorkflows[0]?.targetDirs).toEqual([]);
    expect(releaseWorkflowMapsToPackage.run(model)).toHaveLength(0);
  });
});
