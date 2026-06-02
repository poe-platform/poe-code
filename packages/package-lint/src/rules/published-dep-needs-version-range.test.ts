import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { publishedDepNeedsVersionRange } from "./published-dep-needs-version-range.js";

describe("published-dep-needs-version-range", () => {
  it("flags a published -> published workspace dep with a `*` range", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({ name: "a", dependencies: { b: "*" } }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" })
    });

    const violations = publishedDepNeedsVersionRange.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "a",
      severity: "error",
      detail: { dependency: "b", range: "*" }
    });
  });

  it("passes with a concrete range and ignores edges to private packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({
        name: "a",
        dependencies: { b: "^0.0.1", c: "*" }
      }),
      "/repo/packages/b/package.json": pkgJson({ name: "b" }),
      "/repo/packages/c/package.json": pkgJson({ name: "c", private: true })
    });

    expect(publishedDepNeedsVersionRange.run(model)).toHaveLength(0);
  });
});
