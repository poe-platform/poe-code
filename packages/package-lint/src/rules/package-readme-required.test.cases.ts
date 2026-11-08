import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { packageReadmeRequired } from "./package-readme-required.js";

describe("package-readme-required", () => {
  it("errors for workspace packages missing README.md", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent", private: true })
    });

    const violations = packageReadmeRequired.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      rule: "package-readme-required",
      package: "agent",
      severity: "error",
      detail: { path: "packages/agent/README.md" }
    });
  });

  it("passes for workspace packages with README.md", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/agent/package.json": pkgJson({ name: "agent", private: true }),
      "/repo/packages/agent/README.md": "# agent\n"
    });

    expect(packageReadmeRequired.run(model)).toHaveLength(0);
  });
});
