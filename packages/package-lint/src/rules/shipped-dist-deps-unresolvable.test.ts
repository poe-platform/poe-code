import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { shippedDistDepsUnresolvable } from "./shipped-dist-deps-unresolvable.js";

describe("shipped-dist-deps-unresolvable", () => {
  it("flags a bin whose dependency is neither a root dep nor a shipped package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({
        name: "root",
        dependencies: { jose: "^6.0.0" },
        bin: { "foo-bin": "packages/foo/dist/cli.js" },
        files: ["dist", "packages/bar/dist"]
      }),
      "/repo/packages/foo/package.json": pkgJson({
        name: "foo",
        dependencies: { jose: "^6.0.0", bar: "*", toolcraft: "*" }
      }),
      "/repo/packages/bar/package.json": pkgJson({ name: "bar" }),
      "/repo/packages/toolcraft/package.json": pkgJson({ name: "toolcraft" })
    });

    const violations = shippedDistDepsUnresolvable.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "foo",
      via: "bin:foo-bin",
      severity: "error",
      detail: { unresolved: ["toolcraft"] }
    });
  });

  it("passes when every bin dependency resolves from root deps or shipped packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({
        name: "root",
        dependencies: { jose: "^6.0.0" },
        bin: { "foo-bin": "packages/foo/dist/cli.js" },
        files: ["dist", "packages/bar/dist"]
      }),
      "/repo/packages/foo/package.json": pkgJson({
        name: "foo",
        dependencies: { jose: "^6.0.0", bar: "*", path: "*" }
      }),
      "/repo/packages/bar/package.json": pkgJson({ name: "bar" })
    });

    expect(shippedDistDepsUnresolvable.run(model)).toHaveLength(0);
  });
});
