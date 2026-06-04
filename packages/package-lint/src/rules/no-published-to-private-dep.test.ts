import { describe, expect, it } from "vitest";
import { makeWorkspace, pkgJson } from "../fixtures.js";
import { noPublishedToPrivateDep } from "./no-published-to-private-dep.js";

describe("no-published-to-private-dep", () => {
  it("flags a published package that optionally depends on a private workspace package", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        optionalDependencies: { priv: "*" }
      }),
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true })
    });

    const violations = noPublishedToPrivateDep.run(model);
    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      via: "optionalDependencies",
      severity: "error",
      detail: { dependency: "priv", field: "optionalDependencies" }
    });
  });

  it("passes when the depended-on workspace package is public", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { dep: "^1.0.0" }
      }),
      "/repo/packages/dep/package.json": pkgJson({ name: "dep" })
    });

    expect(noPublishedToPrivateDep.run(model)).toHaveLength(0);
  });

  it("passes when the private workspace dependency is bundled", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        optionalDependencies: { priv: "*" },
        bundledDependencies: ["priv"]
      }),
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true })
    });

    expect(noPublishedToPrivateDep.run(model)).toHaveLength(0);
  });

  it("ignores private consumers depending on private packages", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/a/package.json": pkgJson({
        name: "a",
        private: true,
        dependencies: { b: "*" }
      }),
      "/repo/packages/b/package.json": pkgJson({ name: "b", private: true })
    });

    expect(noPublishedToPrivateDep.run(model)).toHaveLength(0);
  });
});
