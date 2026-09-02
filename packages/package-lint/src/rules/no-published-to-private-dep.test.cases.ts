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

  it("flags private workspace runtime deps inside a bundled workspace dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        private: true,
        dependencies: { priv: "*" }
      }),
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true })
    });

    const violations = noPublishedToPrivateDep.run(model);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      via: "dependencies",
      severity: "error",
      detail: {
        dependency: "priv",
        field: "dependencies",
        bundledVia: ["bundled"]
      }
    });
  });

  it("flags private workspace runtime deps inside a bundled public workspace dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "^1.0.0" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        dependencies: { priv: "*" }
      }),
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true })
    });

    const violations = noPublishedToPrivateDep.run(model);

    expect(violations).toHaveLength(2);
    expect(violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          package: "pub",
          via: "dependencies",
          severity: "error",
          detail: {
            dependency: "priv",
            field: "dependencies",
            bundledVia: ["bundled"]
          }
        })
      ])
    );
  });

  it("passes when the consumer bundle includes the nested private workspace dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*" },
        optionalDependencies: { priv: "*" },
        bundledDependencies: ["bundled", "priv"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        private: true,
        dependencies: { priv: "*" }
      }),
      "/repo/packages/priv/package.json": pkgJson({ name: "priv", private: true })
    });

    expect(noPublishedToPrivateDep.run(model)).toHaveLength(0);
  });

  it("flags external runtime deps inside a bundled workspace dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: { bundled: "*" },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        private: true,
        dependencies: { "fast-string-width": "^3.0.2" }
      })
    });

    const violations = noPublishedToPrivateDep.run(model);

    expect(violations).toHaveLength(1);
    expect(violations[0]).toMatchObject({
      package: "pub",
      via: "dependencies",
      severity: "error",
      detail: {
        dependency: "fast-string-width",
        field: "dependencies",
        bundledVia: ["bundled"]
      }
    });
  });

  it("passes when the consumer declares external runtime deps for a bundled workspace dependency", async () => {
    const model = await makeWorkspace({
      "/repo/package.json": pkgJson({ name: "root" }),
      "/repo/packages/pub/package.json": pkgJson({
        name: "pub",
        dependencies: {
          bundled: "*",
          "fast-string-width": "^3.0.2"
        },
        bundledDependencies: ["bundled"]
      }),
      "/repo/packages/bundled/package.json": pkgJson({
        name: "bundled",
        private: true,
        dependencies: { "fast-string-width": "^3.0.2" }
      })
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
